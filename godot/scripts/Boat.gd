extends Node3D

# Local boat controller with server parity features:
# - Sends player.input every physics tick (seq monotonic)
# - Sends player.trace.change at ~20 Hz for non-authoritative visualization
# - Local integration when SERVER_AUTH_ENABLED is false (server may still reconcile)
# - Power-ups: speed multiplier (10s), shield (5s)
# - Freeze effect: disables motion for N ms
# - Respects STARTING phase (no movement during synchronized countdown)

@export var accel: float = 6.0
@export var brake_accel: float = 3.0
@export var friction: float = 1.5
@export var turn_speed: float = 0.523599 # ~30 deg/s
@export var max_speed: float = 3.0
@export var plane_y: float = 0.0
@export var heading_offset_rad: float = 0.0

@onready var spring_arm: SpringArm3D = $"Pivot/SpringArm3D"
@onready var cam: Camera3D = $"Pivot/SpringArm3D/Camera3D"
var cam_yaw: float = 0.0
var cam_pitch: float = 0.0
var cam_sens: float = 0.005
var cam_min_pitch: float = -1.0471976 # -60 deg
var cam_max_pitch: float = -0.1745329 # -10 deg
var cam_min_len: float = 6.0
var cam_max_len: float = 18.0
var cam_pitch_base: float = -0.3490659 # ~-20 deg
var cam_auto_tilt: bool = true
var cam_auto_zoom: bool = true

var _vel: float = 0.0
var _rot_y: float = 0.0
var _trace_accum: float = 0.0
var _send_trace_hz: float = 20.0

# Debug previous values for change-logging
var _dbg_prev_throttle: float = 0.0
var _dbg_prev_steer: float = 0.0
var _dbg_prev_cam_len: float = 0.0
var _dbg_prev_speed: float = 0.0
var _dbg_prev_cam_yaw: float = 0.0
var _dbg_prev_cam_pitch: float = 0.0
var _dbg_prev_brake: bool = false
var _dbg_prev_pos: Vector3 = Vector3.ZERO
var _dbg_prev_heading: float = 0.0
var _dbg_move_accum: float = 0.0
var _dbg_move_hz: float = 4.0
var _dbg_prev_starting: bool = false
var _dbg_prev_frozen: bool = false

# Power-up / status runtime
var speed_multiplier: float = 1.0
var _speed_until_ms: int = 0
var _shield_until_ms: int = 0
var _freeze_until_ms: int = 0

func _ready() -> void:
	_ensure_input_actions()
	_rot_y = rotation.y
	set_process_unhandled_input(true)
	if spring_arm:
		# Ensure initial camera orientation aligns to world axes (XZ forward, Y up)
		# Start the camera behind the boat: spring arm yaw = current visual yaw + PI
		spring_arm.rotation = Vector3(cam_pitch_base, rotation.y + PI, 0.0)
		# Apply chase-cam parameters (distance, height)
		spring_arm.spring_length = 2.0
		spring_arm.position.y = 0.5
		cam_yaw = spring_arm.rotation.y
		cam_pitch = spring_arm.rotation.x
		# Ensure camera inherits spring arm orientation without extra local rotation
		var cam := get_node_or_null("Pivot/SpringArm3D/Camera3D")
		if cam and cam is Camera3D:
			(cam as Camera3D).transform = Transform3D.IDENTITY
	# Init debug previous pose/heading for movement logs
	_dbg_prev_pos = global_transform.origin
	_dbg_prev_heading = rad_to_deg(rotation.y)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var mm: InputEventMouseMotion = event as InputEventMouseMotion
		cam_yaw -= mm.relative.x * cam_sens
		cam_pitch = clamp(cam_pitch - mm.relative.y * cam_sens, cam_min_pitch, cam_max_pitch)
		if spring_arm:
			spring_arm.rotation = Vector3(cam_pitch, cam_yaw, 0.0)
	elif event is InputEventMouseButton:
		var mb: InputEventMouseButton = event as InputEventMouseButton
		# RMB orbit start/stop
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			if mb.pressed:
				if typeof(Debug) != TYPE_NIL:
					Debug.debug("camera.orbit_start", {"yaw": cam_yaw, "pitch": cam_pitch})
			else:
				if typeof(Debug) != TYPE_NIL:
					Debug.debug("camera.orbit_stop", {"yaw": cam_yaw, "pitch": cam_pitch})
		# Zoom in/out
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP and spring_arm:
			spring_arm.spring_length = clamp(spring_arm.spring_length - 1.0, cam_min_len, cam_max_len)
			if typeof(Debug) != TYPE_NIL:
				Debug.debug("camera.zoom", {"len": spring_arm.spring_length})
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and spring_arm:
			spring_arm.spring_length = clamp(spring_arm.spring_length + 1.0, cam_min_len, cam_max_len)
			if typeof(Debug) != TYPE_NIL:
				Debug.debug("camera.zoom", {"len": spring_arm.spring_length})

func _physics_process(delta: float) -> void:
	# Expire timed effects
	var now_ms: int = Time.get_ticks_msec()
	if _speed_until_ms > 0 and now_ms > _speed_until_ms:
		speed_multiplier = 1.0
		_speed_until_ms = 0
	if _shield_until_ms > 0 and now_ms > _shield_until_ms:
		_shield_until_ms = 0
	# Sync internal yaw with any external rotation changes (e.g., server reconciliation/tilt)
	var desired_internal := rotation.y - heading_offset_rad
	if absf(desired_internal - _rot_y) > 0.001:
		_rot_y = desired_internal

	# Input sampling (direct throttle/steer per spec)
	var brake: bool = Input.is_action_pressed("brake")
	var throttle_i: int = int(Input.is_action_pressed("move_forward")) - int(Input.is_action_pressed("move_backward"))
	if throttle_i == 0:
		throttle_i = int(Input.is_action_pressed("move_up") or Input.is_action_pressed("ui_up")) - int(Input.is_action_pressed("move_down") or Input.is_action_pressed("ui_down"))
	var steer_i: int = int(Input.is_action_pressed("turn_left")) - int(Input.is_action_pressed("turn_right"))
	if steer_i == 0:
		steer_i = int(Input.is_action_pressed("move_left") or Input.is_action_pressed("ui_left")) - int(Input.is_action_pressed("move_right") or Input.is_action_pressed("ui_right"))
	var throttle: float = clamp(float(throttle_i), -1.0, 1.0)
	var steer: float = clamp(float(steer_i), -1.0, 1.0)

	# Clamp inputs
	throttle = clamp(throttle, -1.0, 1.0)
	steer = clamp(steer, -1.0, 1.0)

	# Debug: input changes (log only on meaningful deltas)
	if absf(throttle - _dbg_prev_throttle) >= 0.5:
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("control.throttle", {"throttle": throttle})
		print("[CTRL] throttle=%.2f" % throttle)
	if absf(steer - _dbg_prev_steer) >= 0.5:
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("control.steer", {"steer": steer})
		print("[CTRL] steer=%.2f" % steer)
	if brake != _dbg_prev_brake:
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("control.brake", {"brake": brake})
		print("[CTRL] brake=%s" % str(brake))
	_dbg_prev_throttle = throttle
	_dbg_prev_steer = steer
	_dbg_prev_brake = brake



	# Send input to server
	var seq: int = GameState.next_input_seq()
	Net.player_input(Config.player_id, seq, throttle, steer, brake or (throttle < 0.0))

	# Respect synchronized countdown and freeze
	var starting: bool = (GameState.phase == GameState.PHASE_STARTING)
	var frozen: bool = now_ms < _freeze_until_ms
	# State transition logs
	if starting != _dbg_prev_starting:
		print("[STATE] starting=%s" % str(starting))
		_dbg_prev_starting = starting
	if frozen != _dbg_prev_frozen:
		print("[STATE] frozen=%s until_ms=%d" % [str(frozen), _freeze_until_ms])
		_dbg_prev_frozen = frozen

	# Local integration (non-authoritative visual)
	if not starting and not frozen:
		# Turn
		var yaw_before: float = _rot_y
		_rot_y += steer * turn_speed * delta
		var yaw_after: float = _rot_y
		print("[TURN] yaw=%.2f° -> %.2f° steer=%.2f" % [rad_to_deg(yaw_before + heading_offset_rad), rad_to_deg(yaw_after + heading_offset_rad), steer])
		# Apply power-up multiplier only (no prediction boosts)
		var use_accel: float = accel * max(0.0, speed_multiplier)
		var use_max_speed: float = max_speed * max(0.0, speed_multiplier)

		var v_prev: float = _vel
		var dv_acc: float = (use_accel * delta) if throttle > 0.0 else 0.0
		var dv_throttle_brk: float = (-brake_accel * delta) if throttle < 0.0 else 0.0
		var dv_brk: float = (-brake_accel * delta) if brake else 0.0
		var v_raw: float = v_prev + dv_acc + dv_throttle_brk + dv_brk
		var v_fric: float = v_raw * pow(2.7182818, -friction * delta) # exp(-f*dt)
		var v_new: float = clamp(v_fric, -use_max_speed, use_max_speed)
		_vel = v_new
		print("[INT] v0=%.2f dv_acc=%.2f dv_thrbrk=%.2f dv_brk=%.2f v_raw=%.2f v_fric=%.2f v=%.2f thr=%.2f brake=%s" % [v_prev, dv_acc, dv_throttle_brk, dv_brk, v_raw, v_fric, _vel, throttle, str(brake)])

		# Debug: movement speed change
		if absf(_vel - _dbg_prev_speed) >= 0.25:
			if typeof(Debug) != TYPE_NIL:
				Debug.debug("movement.speed", {"speed": _vel})
			print("[MOVE] speed=%.2f" % _vel)
		_dbg_prev_speed = _vel
		# Heading is updated above by combined camera/steer logic

		var heading: float = _rot_y + heading_offset_rad
		# Move along local +Z per spec (translate in local space)
		translate_object_local(Vector3(0.0, 0.0, _vel * delta))
		rotation.y = _rot_y + heading_offset_rad

		# Movement step logging: control outputs -> delta pose and direction of travel
		_dbg_move_accum += delta
		var log_due: bool = false
		if _dbg_move_accum >= 1.0 / max(0.1, _dbg_move_hz):
			log_due = true

		var p_now: Vector3 = global_transform.origin
		var dvec: Vector3 = p_now - _dbg_prev_pos
		var dist: float = dvec.length()
		var heading_rad: float = atan2(global_transform.basis.z.x, global_transform.basis.z.z)
		var heading_deg: float = rad_to_deg(heading_rad)
		var dh: float = absf(heading_deg - _dbg_prev_heading)
		if dh > 180.0:
			dh = 360.0 - dh
		if dist >= 0.25 or dh >= 5.0:
			log_due = true

		if typeof(Debug) != TYPE_NIL and log_due:
			# Desired yaw from camera + steer bias for traceability
			var desired_deg: float = heading_deg
			if cam:
				var f_dbg := -cam.global_transform.basis.z
				f_dbg.y = 0.0
				if f_dbg.length() > 0.0:
					f_dbg = f_dbg.normalized()
				var cam_forward_yaw_dbg := atan2(f_dbg.x, f_dbg.z)
				desired_deg = rad_to_deg(cam_forward_yaw_dbg - heading_offset_rad + steer * 0.5)
			# Camera yaw in degrees (from spring arm)
			var cam_yaw_deg: float = 0.0
			if spring_arm:
				cam_yaw_deg = rad_to_deg(spring_arm.rotation.y)
			# Unit forward vector in XZ (from local +Z basis)
			var fwd_x: float = global_transform.basis.z.x
			var fwd_z: float = global_transform.basis.z.z
			# Actual travel bearing and drift vs heading
			var bearing_rad: float = atan2(dvec.x, dvec.z)
			var bearing_deg: float = rad_to_deg(bearing_rad)
			var drift_rad: float = fposmod(heading_rad - bearing_rad + PI, TAU) - PI
			var drift_deg: float = rad_to_deg(drift_rad)
			Debug.info("movement.step", {
				"from": _dbg_prev_pos,
				"to": p_now,
				"step": Vector3(dvec.x, 0.0, dvec.z),
				"dist": dist,
				"forward": Vector2(fwd_x, fwd_z),
				"actual_step": Vector2(dvec.x, dvec.z),
				"speed": _vel,
				"heading_deg": heading_deg,
				"desired_deg": desired_deg,
				"bearing_deg": bearing_deg,
				"drift_deg": drift_deg,
				"cam_yaw_deg": cam_yaw_deg,
				"throttle": throttle,
				"steer": steer
			})
			print("[STEP] from(%.2f,%.2f)->to(%.2f,%.2f) dist=%.2f heading=%.1f° bearing=%.1f° drift=%.1f° v=%.2f thr=%.2f steer=%.2f" % [
				_dbg_prev_pos.x, _dbg_prev_pos.z, p_now.x, p_now.z, dist, heading_deg, bearing_deg, drift_deg, _vel, throttle, steer
			])
			print("[POSE] x=%.2f z=%.2f yaw=%.1f° v=%.2f thr=%.2f steer=%.2f" % [p_now.x, p_now.z, rad_to_deg(rotation.y), _vel, throttle, steer])
			_dbg_move_accum = 0.0
			_dbg_prev_pos = p_now
			_dbg_prev_heading = heading_deg

		# Buoyancy and tilt are applied in World.gd; don't override y/x/z here.

	else:
		# Keep facing/camera stable; do not integrate motion
		_vel = 0.0

	# Chase camera (spec: distance 2.0, height 0.5, azimuth +PI), smooth follow
	if spring_arm and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var desired_yaw_cam: float = rotation.y + PI
		# smoothing_lerp ~0.1 per spec
		spring_arm.rotation.y = lerp_angle(spring_arm.rotation.y, desired_yaw_cam, 0.1)
		# Maintain fixed pitch and distances
		spring_arm.rotation.x = cam_pitch_base
		spring_arm.spring_length = 2.0
		spring_arm.position.y = 0.5
		# Log camera follow similar to THREE.js example
		if cam:
			var cam_pos := cam.global_transform.origin
			var player_pos := global_transform.origin
			print("[CAM] yaw=%.1f° pos=(%.2f,%.2f,%.2f) target=(%.2f,%.2f,%.2f)" % [
				rad_to_deg(spring_arm.rotation.y), cam_pos.x, cam_pos.y, cam_pos.z, player_pos.x, player_pos.y, player_pos.z
			])

	# Periodic trace update
	_trace_accum += delta
	var trace_interval: float = 1.0 / float(max(0.1, _send_trace_hz))
	if _trace_accum >= trace_interval:
		_trace_accum = 0.0
		_send_trace()

	# Debug snapshot (controls, camera, movement)
	var effects := ""
	if has_shield():
		effects += "🛡️"
	if speed_multiplier > 1.0:
		effects = "⚡" + effects

	# Compute camera/motion debug values
	var cam_len: float = 0.0
	var cam_yaw_now: float = 0.0
	var cam_pitch_now: float = 0.0
	if spring_arm:
		cam_len = spring_arm.spring_length
		cam_yaw_now = spring_arm.rotation.y
		cam_pitch_now = spring_arm.rotation.x

	var heading: float = _rot_y + heading_offset_rad
	var desired_debug: float = heading
	var gain_dbg: float = turn_speed

	if typeof(Debug) != TYPE_NIL and Debug.has_method("observe_boat_state"):
		Debug.observe_boat_state({
			# pose/speed
			"x": global_transform.origin.x,
			"y": global_transform.origin.y,
			"z": global_transform.origin.z,
			"yaw": rotation.y,
			"heading": heading,
			"desired_yaw": desired_debug,
			"speed": _vel,
			# inputs/effects
			"throttle": throttle,
			"steer": steer,
			"brake": brake,
			"speed_mul": speed_multiplier,
			"effects": effects,
			# camera
			"cam_yaw": cam_yaw_now,
			"cam_pitch": cam_pitch_now,
			"cam_len": cam_len,
			# control gains
			"gain": gain_dbg
		})

func _send_trace() -> void:
	var body := {
		"x": global_transform.origin.x,
		"y": global_transform.origin.y,
		"z": global_transform.origin.z,
		"rotY": rotation.y,
		"speed": _vel
	}
	Net.player_trace_change(Config.player_id, body)

# Power-ups and status API (used by World.gd)

func apply_speed_for_ms(duration_ms: int, mul: float = 2.0) -> void:
	speed_multiplier = max(0.1, mul)
	_speed_until_ms = Time.get_ticks_msec() + max(0, duration_ms)
	print("[POWERUP] speed mul=%.2f duration_ms=%d" % [speed_multiplier, duration_ms])

func apply_shield_for_ms(duration_ms: int) -> void:
	_shield_until_ms = Time.get_ticks_msec() + max(0, duration_ms)
	print("[POWERUP] shield duration_ms=%d" % duration_ms)

func has_shield() -> bool:
	return Time.get_ticks_msec() < _shield_until_ms

func freeze_for_ms(duration_ms: int) -> void:
	var new_until: int = Time.get_ticks_msec() + max(0, duration_ms)
	_freeze_until_ms = max(_freeze_until_ms, new_until)
	print("[EFFECT] freeze applied for %d ms (until %d)" % [duration_ms, _freeze_until_ms])

func get_freeze_remaining_ms() -> int:
	return max(0, _freeze_until_ms - Time.get_ticks_msec())

func get_speed() -> float:
	return absf(_vel)

func _ensure_input_actions() -> void:
	var defs := {
		"move_up": [KEY_W],
		"move_down": [KEY_S],
		"move_left": [KEY_A],
		"move_right": [KEY_D],
		"brake": [KEY_SPACE]
	}
	for action in defs.keys():
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for sc in defs[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = sc
			InputMap.action_add_event(action, ev)
	# New movement actions per spec
	var defs2 := {
		"move_forward": [KEY_W, KEY_UP],
		"move_backward": [KEY_S, KEY_DOWN],
		"turn_left": [KEY_A, KEY_LEFT],
		"turn_right": [KEY_D, KEY_RIGHT],
	}
	for action in defs2.keys():
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for sc in defs2[action]:
			var ev2 := InputEventKey.new()
			ev2.physical_keycode = sc
			InputMap.action_add_event(action, ev2)
	# Also ensure arrow keys for ui_* exist (usually default in Godot projects)
	if not InputMap.has_action("ui_up"):
		InputMap.add_action("ui_up")
		var ev_up := InputEventKey.new()
		ev_up.physical_keycode = KEY_UP
		InputMap.action_add_event("ui_up", ev_up)
	if not InputMap.has_action("ui_down"):
		InputMap.add_action("ui_down")
		var ev_dn := InputEventKey.new()
		ev_dn.physical_keycode = KEY_DOWN
		InputMap.action_add_event("ui_down", ev_dn)
	if not InputMap.has_action("ui_left"):
		InputMap.add_action("ui_left")
		var ev_l := InputEventKey.new()
		ev_l.physical_keycode = KEY_LEFT
		InputMap.action_add_event("ui_left", ev_l)
	if not InputMap.has_action("ui_right"):
		InputMap.add_action("ui_right")
		var ev_r := InputEventKey.new()
		ev_r.physical_keycode = KEY_RIGHT
		InputMap.action_add_event("ui_right", ev_r)
