extends Node3D

# Parity with web/src/script.js:
# - Remote players with name tags and trails (Line3D)
# - Items (trash/turtle/power-ups) rendering + bobbing/AI/spin
# - Collisions -> Net.items_collision; apply power-ups locally
# - Freeze effect when hitting other players' trails
# - Countdown handled by Countdown3D + HUD; spawns align to server "game.on"

@onready var boat: Node3D = $Boat
@onready var boat_spawn: Marker3D = $BoatSpawn
@onready var hud: CanvasItem = $HUD
@onready var countdown_anchor: Node3D = $Anchors/CountdownAnchor
@onready var particles_anchor: Node3D = $Anchors/ParticlesAnchor

var _have_spawned := false

# Containers created at runtime
var _remote_container: Node3D
var _trail_container: Node3D
var _items_container: Node3D

# Assets
var _boat_ps: PackedScene
var _box_ps: PackedScene
var _turtle_ps: PackedScene

# World/server info
var _world_x: int = 88
var _world_z: int = 22
var _server_auth: bool = false
var _server_phys: Dictionary = {}
const AUTH_FRESH_MS := 300
var _auth_last_ms: int = 0
var _auth_state_self: Dictionary = {}
var _boat_prev_pos: Vector3 = Vector3.ZERO

# Remote players and trails
var _remote_boats: Dictionary = {}      # id -> Node3D
var _remote_names: Dictionary = {}      # id -> Label3D
var _trails: Dictionary = {}            # id -> { line: Line3D, points: PackedVector3Array, last_ms: int }

# Items cache
var _items: Dictionary = {}             # id -> Node3D

# Local score (display optional)
var _local_score: int = 0

# Spawn deferral and water
var _pending_spawn: Variant = null
var _water: MeshInstance3D
var _water_mat: Material

# Water wave sources and params (kept in sync with shader for CPU buoyancy)
var _wave_noise_a: FastNoiseLite
var _wave_noise_b: FastNoiseLite
var _wave_params: Dictionary = {
	"scale_a": 15.0,
	"scale_b": 15.0,
	"move_a": Vector2(-1, 0),
	"move_b": Vector2(0, 1),
	"time_a": 0.15,
	"time_b": 0.15,
	"height": 1.0,
	"normal_flat": 50.0
}

# Navigation region covering the water surface (rectangle)
var _water_nav: NavigationRegion3D
var _water_half_extents: Vector2 = Vector2.ZERO

# Badges above local boat (power-ups, freeze/status)
var _powerup_badge: Label3D
var _status_badge: Label3D
var _camera_forced: bool = false

func _ready() -> void:
	# Containers
	_remote_container = Node3D.new()
	_remote_container.name = "RemotePlayers"
	add_child(_remote_container)
	_trail_container = Node3D.new()
	_trail_container.name = "Trails"
	add_child(_trail_container)
	_items_container = Node3D.new()
	_items_container.name = "Items"
	add_child(_items_container)

	# Load assets
	_boat_ps = load("res://scenes/Boat.tscn")
	_box_ps = null
	_turtle_ps = null

	# Local badges
	_powerup_badge = Label3D.new()
	_powerup_badge.position = Vector3(0, 1.8, 0)
	_powerup_badge.text = ""
	_powerup_badge.visible = false
	if boat:
		boat.add_child(_powerup_badge)

	_status_badge = Label3D.new()
	_status_badge.position = Vector3(0, 2.15, 0)
	_status_badge.text = ""
	_status_badge.visible = false
	if boat:
		boat.add_child(_status_badge)

	# Signals
	Net.server_event.connect(_on_server_event)
	Net.server_info.connect(_on_server_info)
	Net.game_on.connect(_on_game_on)
	Net.game_time.connect(func(sec): if hud and hud.has_method("set_time_left"): hud.call("set_time_left", sec))
	Net.starting_game.connect(func(data): if hud and hud.has_method("on_starting_game"): hud.call("on_starting_game", data))

	# Score service hooks (autoload singleton)
	ScoreClient.http_ok.connect(_on_score_http_ok)
	ScoreClient.http_error.connect(_on_score_http_err)

	# Place boat at spawn initially
	_spawn_boat()
	_update_score_ui()
	_refresh_server_score(0)

	# Add SSR water plane (ShaderMaterial with procedural wave/normal textures)
	var water_size := Vector2(1000, 1000)
	var hx := water_size.x * 0.5
	var hz := water_size.y * 0.5
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([
		Vector3(-hx, 0.0, -hz),
		Vector3(hx, 0.0, -hz),
		Vector3(hx, 0.0, hz),
		Vector3(-hx, 0.0, hz)
	])
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 2, 0, 2, 3])
	var plane := ArrayMesh.new()
	plane.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/water.gdshader")

	# Wave height textures (grayscale)
	_wave_noise_a = FastNoiseLite.new()
	_wave_noise_a.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_wave_noise_a.frequency = 0.0005
	_wave_noise_a.fractal_type = FastNoiseLite.FRACTAL_FBM
	var wave_a_tex := NoiseTexture2D.new()
	wave_a_tex.noise = _wave_noise_a
	wave_a_tex.seamless = true

	_wave_noise_b = FastNoiseLite.new()
	_wave_noise_b.noise_type = FastNoiseLite.TYPE_PERLIN
	_wave_noise_b.frequency = 0.0225
	var wave_b_tex := NoiseTexture2D.new()
	wave_b_tex.noise = _wave_noise_b
	wave_b_tex.seamless = true

	# Surface normals textures (as normal maps)
	var surf_noise_a := FastNoiseLite.new()
	surf_noise_a.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	surf_noise_a.frequency = 0.007
	var surf_a_tex := NoiseTexture2D.new()
	surf_a_tex.noise = surf_noise_a
	surf_a_tex.seamless = true
	surf_a_tex.as_normal_map = true

	var surf_noise_b := FastNoiseLite.new()
	surf_noise_b.noise_type = FastNoiseLite.TYPE_SIMPLEX
	surf_noise_b.frequency = 0.02
	var surf_b_tex := NoiseTexture2D.new()
	surf_b_tex.noise = surf_noise_b
	surf_b_tex.seamless = true
	surf_b_tex.as_normal_map = true

	# Assign shader parameters
	mat.set_shader_parameter("wave_a", wave_a_tex)
	mat.set_shader_parameter("wave_b", wave_b_tex)
	mat.set_shader_parameter("surface_normals_a", surf_a_tex)
	mat.set_shader_parameter("surface_normals_b", surf_b_tex)
	mat.set_shader_parameter("wave_move_direction_a", Vector2(-1, 0))
	mat.set_shader_parameter("wave_move_direction_b", Vector2(0, 1))
	mat.set_shader_parameter("wave_noise_scale_a", 15.0)
	mat.set_shader_parameter("wave_noise_scale_b", 15.0)
	mat.set_shader_parameter("wave_time_scale_a", 0.15)
	mat.set_shader_parameter("wave_time_scale_b", 0.15)
	mat.set_shader_parameter("wave_height_scale", 1.0)
	mat.set_shader_parameter("wave_normal_flatness", 50.0)
	mat.set_shader_parameter("surface_normals_move_direction_a", Vector2(-1.0, 0.2))
	mat.set_shader_parameter("surface_normals_move_direction_b", Vector2(0.2, 1.0))
	mat.set_shader_parameter("surface_texture_roughness", 0.15)
	mat.set_shader_parameter("surface_texture_scale", 0.1)
	mat.set_shader_parameter("surface_texture_time_scale", 0.06)
	mat.set_shader_parameter("ssr_resolution", 1.0)
	mat.set_shader_parameter("ssr_max_travel", 0.0)
	mat.set_shader_parameter("ssr_max_diff", 4.0)
	mat.set_shader_parameter("ssr_mix_strength", 0.7)
	mat.set_shader_parameter("ssr_screen_border_fadeout", 0.3)
	mat.set_shader_parameter("refraction_intensity", 0.0)
	mat.set_shader_parameter("color_shallow", Color(0.01, 0.2, 0.3))
	mat.set_shader_parameter("color_deep", Color(0.3, 0.5, 0.6))
	mat.set_shader_parameter("border_color", Color(1, 1, 1))
	mat.set_shader_parameter("border_scale", 2.0)
	mat.set_shader_parameter("border_near", 0.5)
	mat.set_shader_parameter("border_far", 300.0)

	var water := MeshInstance3D.new()
	water.mesh = plane
	water.material_override = mat
	water.rotation_degrees = Vector3(0, 0, 0)
	water.position = Vector3(0, 0, 0)
	add_child(water)
	_water = water
	_water_mat = mat

	# Navigation region covering water plane for spawn sampling
	var nav := NavigationRegion3D.new()
	nav.name = "WaterNav"
	var nmesh := NavigationMesh.new()
	# use hx/hz computed from water_size above
	nmesh.vertices = PackedVector3Array([
		Vector3(-hx, 0.0, -hz),
		Vector3(hx, 0.0, -hz),
		Vector3(hx, 0.0, hz),
		Vector3(-hx, 0.0, hz)
	])
	nmesh.polygons = PackedInt32Array([0, 1, 2, 0, 2, 3])
	_water_half_extents = Vector2(hx, hz)
	nav.navigation_mesh = nmesh
	add_child(nav)
	_water_nav = nav

	# Ground collision for spring arm and bounds
	var ground_body := StaticBody3D.new()
	ground_body.name = "Ground"
	ground_body.collision_layer = 1
	ground_body.collision_mask = 1
	var ground_shape := WorldBoundaryShape3D.new()
	ground_shape.plane = Plane(0, 1, 0, 0.0) # y = 0
	var ground_cs := CollisionShape3D.new()
	ground_cs.shape = ground_shape
	ground_body.add_child(ground_cs)
	ground_body.position = Vector3(0, 0, 0)
	add_child(ground_body)

	# Ensure a basic environment for ambient lighting
	var world_env := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.35, 0.55, 0.85)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.6, 0.7)
	env.ambient_light_energy = 1.2
	world_env.environment = env
	add_child(world_env)

	# Ensure boat camera is active
	var cam: Camera3D = null
	if boat:
		cam = boat.get_node_or_null("Pivot/SpringArm3D/Camera3D") as Camera3D
	if cam:
		cam.current = true

	set_process(true)
	set_physics_process(true)

func _ensure_boat_camera_current_once() -> void:
	if _camera_forced:
		return
	var cam: Camera3D = null
	if boat:
		cam = boat.get_node_or_null("Pivot/SpringArm3D/Camera3D") as Camera3D
	if cam:
		cam.current = true
		# Disable any other cameras that might be current (ensure Boat camera is main)
		var root: Node = get_tree().root
		var stack: Array = [root]
		while stack.size() > 0:
			var n: Node = stack.pop_back() as Node
			for child in n.get_children():
				stack.push_back(child)
				if child is Camera3D and child != cam:
					(child as Camera3D).current = false
	_camera_forced = true

func _spawn_boat() -> void:
	if boat and boat_spawn:
		boat.global_transform.origin = boat_spawn.global_transform.origin
		_have_spawned = true

func _on_server_info(data: Dictionary) -> void:
	if typeof(data) != TYPE_DICTIONARY:
		return
	_world_x = int(data.get("worldSizeX", _world_x))
	_world_z = int(data.get("worldSizeZ", _world_z))
	_server_auth = bool(data.get("serverAuthEnabled", false))
	_server_phys = data.get("physics", {}) as Dictionary
	# Apply physics params to local boat if provided
	if boat and typeof(_server_phys) == TYPE_DICTIONARY:
		if _server_phys.has("acceleration"):
			boat.set("accel", float(_server_phys["acceleration"]))
		if _server_phys.has("brake"):
			boat.set("brake_accel", float(_server_phys["brake"]))
		if _server_phys.has("friction"):
			boat.set("friction", float(_server_phys["friction"]))
		if _server_phys.has("maxSpeed"):
			boat.set("max_speed", float(_server_phys["maxSpeed"]))
		if _server_phys.has("turnSpeed"):
			boat.set("turn_speed", float(_server_phys["turnSpeed"]))

func _on_game_on(data: Dictionary) -> void:
	# Server provided a room-shared start position; apply safely when inside tree
	if typeof(data) == TYPE_DICTIONARY and data.has("startPosition"):
		var p: Variant = data.get("startPosition", null)
		if typeof(p) == TYPE_DICTIONARY:
			var x := float(p.get("x", 0.0))
			var y := float(p.get("y", 0.0))
			var z := float(p.get("z", 0.0))
			var target := Vector3(x, y, z)
			if boat and boat.is_inside_tree() and is_inside_tree():
				var t := boat.global_transform
				t.origin = target
				boat.global_transform = t
			else:
				_pending_spawn = target

func _on_server_event(event: String, data) -> void:
	match event:
		"player.info.joined":
			if typeof(data) == TYPE_DICTIONARY:
				var id: String = String(data.get("id", ""))
				var name: String = String(data.get("name", id))
				_spawn_remote_if_needed(id, name)
		"player.info.left":
			var id: String = ""
			if typeof(data) == TYPE_STRING:
				id = data
			elif typeof(data) == TYPE_DICTIONARY and data.has("id"):
				id = String(data["id"])
			if id != "":
				_remove_remote(id)
		"player.info.all":
			if typeof(data) == TYPE_DICTIONARY:
				for id in data.keys():
					if String(id) == Config.player_id:
						continue
					var name := ""
					var rec: Variant = data[id]
					if typeof(rec) == TYPE_DICTIONARY:
						name = String(rec.get("name", String(id)))
					_spawn_remote_if_needed(String(id), name)
		"player.state":
			# Authoritative states: { t, states: { id: { x, z, rotY, speed } } }
			if typeof(data) == TYPE_DICTIONARY and data.has("states"):
				var states: Dictionary = data["states"] as Dictionary
				if typeof(states) == TYPE_DICTIONARY:
					# record snapshot timestamp for freshness
					_auth_last_ms = int(data.get("t", _auth_last_ms))
					for id in states.keys():
						var sid := String(id)
						if sid == Config.player_id:
							_auth_state_self = states[id] as Dictionary
						else:
							_update_remote_state(sid, states[id])
		"player.trace.all":
			# Fallback for non-authoritative mode
			if typeof(data) == TYPE_DICTIONARY:
				for id in data.keys():
					_update_remote_trace(String(id), data[id])
		"items.all":
			if typeof(data) == TYPE_DICTIONARY:
				for id in data.keys():
					_create_or_update_item(String(id), data[id])
		"item.new":
			if typeof(data) == TYPE_DICTIONARY and data.has("id"):
				var nid := String(data["id"])
				var obj: Dictionary = data.get("data", {}) as Dictionary
				_create_or_update_item(nid, obj)
		"item.destroy":
			var rid := ""
			if typeof(data) == TYPE_STRING:
				rid = data
			elif typeof(data) == TYPE_DICTIONARY and data.has("id"):
				rid = String(data["id"])
			if rid != "":
				_remove_item(rid)
		_:
			pass

func _physics_process(delta: float) -> void:
	# Animate items (bobbing/spin) + simple turtle AI
	_animate_items(delta)
	# Trails: cleanup stale
	_cleanup_trails()
	# Local trail point (leave a visible trail for own boat too)
	if boat:
		var halfW := _water_half_extents.x - 1.0
		var halfZ := _water_half_extents.y - 1.0

		# Bounds enforcement: revert on exit (use last valid position)
		var p := boat.position
		var outside := (p.x < -halfW or p.x > halfW or p.z < -halfZ or p.z > halfZ)
		if outside:
			boat.position.x = _boat_prev_pos.x
			boat.position.z = _boat_prev_pos.z
		else:
			_boat_prev_pos = boat.position

		# Server-authoritative correction for local player if fresh snapshot
		var now_ms := Time.get_ticks_msec()
		if _server_auth and _auth_last_ms > 0 and now_ms - _auth_last_ms <= AUTH_FRESH_MS and _auth_state_self.size() > 0:
			var tx := float((_auth_state_self.get("x", boat.position.x)))
			var tz := float((_auth_state_self.get("z", boat.position.z)))
			var ry := float((_auth_state_self.get("rotY", boat.rotation.y)))
			boat.position.x = lerp(boat.position.x, tx, 0.2)
			boat.position.z = lerp(boat.position.z, tz, 0.2)
			# Apply model heading offset when reconciling yaw so visual matches motion
			var rv: Variant = boat.get("heading_offset_rad")
			var hoff: float = 0.0
			if typeof(rv) == TYPE_INT or typeof(rv) == TYPE_FLOAT:
				hoff = float(rv)
			var ry_v := ry + hoff
			var dy := fposmod(ry_v - boat.rotation.y + PI, TAU) - PI
			boat.rotation.y += dy * 0.2
			if _auth_state_self.has("speed"):
				boat.set_meta("auth_speed", float(_auth_state_self["speed"]))

		# Prediction boost toggles based on snapshot freshness
		if _server_auth:
			if _auth_last_ms > 0 and now_ms - _auth_last_ms <= AUTH_FRESH_MS:
				boat.set_meta("pred_boost_a", 1.0)
				boat.set_meta("pred_boost_s", 1.0)
			else:
				boat.set_meta("pred_boost_a", 1.15)
				boat.set_meta("pred_boost_s", 1.2)
		else:
			boat.set_meta("pred_boost_a", 1.0)
			boat.set_meta("pred_boost_s", 1.0)

		# Buoyancy: align boat to water height and tilt to water normal
		var h := _water_height_at(boat.position.x, boat.position.z)
		boat.position.y = h
		var up := _water_normal_at(boat.position.x, boat.position.z)
		var yaw := boat.rotation.y
		var dir := Vector3(-sin(yaw), 0.0, -cos(yaw))
		boat.basis = Basis().looking_at(boat.global_transform.origin + dir, up)

		_add_trail_point(Config.player_id, boat.global_transform.origin)
	# Trail collision -> freeze
	_check_trail_collisions()
	# Item collision
	_check_item_collisions()

func _process(_delta: float) -> void:
	# Ensure Boat camera is main on first frame after everything is ready
	_ensure_boat_camera_current_once()
	# Apply deferred spawn if needed (avoid is_inside_tree errors)
	if _pending_spawn != null and boat and boat.is_inside_tree() and is_inside_tree():
		var t := boat.global_transform
		t.origin = _pending_spawn
		boat.global_transform = t
		_pending_spawn = null

	# Water shader animates via TIME; no manual UV offset needed

	# Update in-world badges over the local boat
	_update_badges()

	# Debug overlay: publish world snapshot
	if typeof(Debug) != TYPE_NIL and Debug.has_method("observe_world_state"):
		var bounds_s := "±(%.1f, %.1f)" % [_water_half_extents.x, _water_half_extents.y]
		var fresh := false
		if _server_auth and _auth_last_ms > 0:
			fresh = (Time.get_ticks_msec() - _auth_last_ms) <= AUTH_FRESH_MS
		var players := _remote_boats.size() + (1 if boat != null else 0)
		Debug.observe_world_state({
			"score": _local_score,
			"items": _items.size(),
			"players": players,
			"bounds": bounds_s,
			"authFresh": fresh
		})

# ------------------------
# Dev input (spawn/clear/effects)
# ------------------------

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("debug_spawn10"):
		for i in range(10):
			_debug_spawn_item()
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("world.debug_spawn10", {"count": 10})
	elif event.is_action_pressed("debug_clear_items"):
		_debug_clear_items()
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("world.debug_clear_items")
	elif event.is_action_pressed("debug_speed"):
		if boat and boat.has_method("apply_speed_for_ms"):
			boat.call("apply_speed_for_ms", 6000, 2.0)
			if typeof(Debug) != TYPE_NIL:
				Debug.info("world.effect_speed", {"ms": 6000, "mul": 2.0})
	elif event.is_action_pressed("debug_freeze"):
		if boat and boat.has_method("freeze_for_ms"):
			boat.call("freeze_for_ms", 3000)
			if typeof(Debug) != TYPE_NIL:
				Debug.info("world.effect_freeze", {"ms": 3000})

func _debug_spawn_item() -> void:
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(1, 1, 1)
	mesh.mesh = box
	var mat_b := StandardMaterial3D.new()
	mat_b.albedo_color = Color(0.55, 0.35, 0.2)
	mat_b.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	mesh.material_override = mat_b
	var hx := _water_half_extents.x - 1.0
	var hz := _water_half_extents.y - 1.0
	var px := randf_range(-hx, hx)
	var pz := randf_range(-hz, hz)
	var wy := _water_height_at(px, pz)
	mesh.position = Vector3(px, wy, pz)
	mesh.rotation.y = randf_range(0.0, TAU)
	var s := randf_range(0.7, 1.3)
	mesh.scale = Vector3(s, s, s)
	mesh.set_meta("type", "trash")
	mesh.set_meta("size", s)
	mesh.set_meta("base_y", mesh.position.y)
	mesh.set_meta("spin", randf() * TAU)
	_items_container.add_child(mesh)
	var id := "dbg_%08x" % randi()
	_items[id] = mesh

func _debug_clear_items() -> void:
	var ids := _items.keys()
	for id in ids:
		_remove_item(String(id))

# ------------------------
# Remote players & trails
# ------------------------

func _spawn_remote_if_needed(id: String, name: String) -> void:
	if id == "" or id == Config.player_id:
		return
	if _remote_boats.has(id):
		return
	if _boat_ps == null:
		return
	var inst: Node3D = _boat_ps.instantiate() as Node3D
	if inst == null:
		return
	_remote_container.add_child(inst)
	_remote_boats[id] = inst
	# Name tag
	var lbl := Label3D.new()
	lbl.text = (name if name != "" else id.left(4))
	lbl.position = Vector3(0, 1.4, 0)
	inst.add_child(lbl)
	_remote_names[id] = lbl

func _remove_remote(id: String) -> void:
	if _remote_boats.has(id):
		var node: Node3D = _remote_boats[id] as Node3D
		if node and node.get_parent():
			node.get_parent().remove_child(node)
			node.queue_free()
		_remote_boats.erase(id)
	if _remote_names.has(id):
		_remote_names.erase(id)
	if _trails.has(id):
		var td: Dictionary = _trails[id]
		if td and td.has("mi"):
			var mi: MeshInstance3D = td["mi"]
			if mi and mi.get_parent():
				mi.get_parent().remove_child(mi)
				mi.queue_free()
		_trails.erase(id)

func _update_remote_state(id: String, st: Variant) -> void:
	if not _remote_boats.has(id):
		# lack of join/left ordering shouldn't block rendering
		_spawn_remote_if_needed(id, id.left(4))
	if not _remote_boats.has(id):
		return
	if typeof(st) != TYPE_DICTIONARY:
		return
	var m: Node3D = _remote_boats[id] as Node3D
	var tx := float(st.get("x", m.position.x))
	var tz := float(st.get("z", m.position.z))
	var ry := float(st.get("rotY", m.rotation.y))
	# Smoothly approach authoritative state
	m.position.x = lerp(m.position.x, tx, 0.35)
	m.position.z = lerp(m.position.z, tz, 0.35)
	# shortest-angle lerp for yaw (include per-boat heading offset if present)
	var rv: Variant = m.get("heading_offset_rad")
	var hoff: float = 0.0
	if typeof(rv) == TYPE_INT or typeof(rv) == TYPE_FLOAT:
		hoff = float(rv)
	var ry_v := ry + hoff
	var delta := fposmod(ry_v - m.rotation.y + PI, TAU) - PI
	m.rotation.y += delta * 0.35
	_add_trail_point(id, m.global_transform.origin)

func _update_remote_trace(id: String, tr: Variant) -> void:
	if not _remote_boats.has(id):
		_spawn_remote_if_needed(id, id.left(4))
	if not _remote_boats.has(id):
		return
	if typeof(tr) != TYPE_DICTIONARY:
		return
	var m: Node3D = _remote_boats[id]
	m.position.x = float(tr.get("x", m.position.x))
	m.position.z = float(tr.get("z", m.position.z))
	var rv: Variant = m.get("heading_offset_rad")
	var hoff: float = 0.0
	if typeof(rv) == TYPE_INT or typeof(rv) == TYPE_FLOAT:
		hoff = float(rv)
	m.rotation.y = float(tr.get("rotY", m.rotation.y)) + hoff
	_add_trail_point(id, m.global_transform.origin)

func _ensure_trail(id: String) -> Dictionary:
	if _trails.has(id):
		return _trails[id]
	var im := ImmediateMesh.new()
	var mi := MeshInstance3D.new()
	mi.mesh = im
	# Unshaded colored line material
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = _color_from_id(id)
	mi.material_override = mat
	_trail_container.add_child(mi)
	var td: Dictionary = {
		"mesh": im,
		"mi": mi,
		"points": PackedVector3Array(),
		"last_ms": Time.get_ticks_msec()
	}
	_trails[id] = td
	return td

func _add_trail_point(id: String, p: Vector3) -> void:
	var td: Dictionary = _ensure_trail(id)
	var pts: PackedVector3Array = td["points"] as PackedVector3Array
	# Only add if far enough from last (to limit point count)
	if pts.size() == 0 or pts[pts.size() - 1].distance_to(p) > 0.5:
		pts.push_back(p)
		# clamp to last 11 points
		while pts.size() > 11:
			pts.remove_at(0)
		td["points"] = pts
		td["last_ms"] = Time.get_ticks_msec()
		var im: ImmediateMesh = td["mesh"] as ImmediateMesh
		if im:
			im.clear_surfaces()
			# Only draw when we have at least 2 vertices to avoid render pipeline errors
			if pts.size() >= 2:
				im.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
				for v in pts:
					im.surface_add_vertex(v)
				im.surface_end()

func _cleanup_trails() -> void:
	var now_ms := Time.get_ticks_msec()
	var to_remove: Array = []
	for id in _trails.keys():
		var td: Dictionary = _trails[id] as Dictionary
		if td and td.has("last_ms"):
			if now_ms - int(td["last_ms"]) > 5000: # 5s TTL
				var mi: MeshInstance3D = td["mi"] as MeshInstance3D
				if mi and mi.get_parent():
					mi.get_parent().remove_child(mi)
					mi.queue_free()
				to_remove.push_back(id)
	for id in to_remove:
		_trails.erase(id)

# ------------------------
# Items
# ------------------------

func _create_or_update_item(id: String, obj: Variant) -> void:
	if typeof(obj) != TYPE_DICTIONARY:
		return
	var tname: String = String(obj.get("type", "trash"))
	var posd: Dictionary = obj.get("position", {}) as Dictionary
	var x := float(posd.get("x", 0.0))
	var y := float(posd.get("y", 0.0))
	var z := float(posd.get("z", 0.0))
	var size := float(obj.get("size", 1.0))

	if _items.has(id):
		var node: Node3D = _items[id] as Node3D
		var wy := _water_height_at(x, z)
		node.position = Vector3(x, wy, z)
		node.scale = Vector3(size, size, size)
		node.set_meta("type", tname)
		node.set_meta("size", size)
		return

	var node: Node3D = null
	if tname == "turtle":
		if _turtle_ps:
			node = _turtle_ps.instantiate() as Node3D
		else:
			var mesh := MeshInstance3D.new()
			var cap := CapsuleMesh.new()
			cap.radius = 0.35
			cap.height = 0.9
			mesh.mesh = cap
			var mat_t := StandardMaterial3D.new()
			mat_t.albedo_color = Color(0.2, 0.8, 0.25)
			mat_t.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
			mesh.material_override = mat_t
			node = mesh
		# Init simple AI
		node.set_meta("ai_target", _rand_target_within())
		node.set_meta("ai_speed", 0.7 + randf() * 0.3)
	elif tname.begins_with("powerup_"):
		# Power-up: cone-like mesh via CylinderMesh with top_radius=0
		var mesh := MeshInstance3D.new()
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.6
		cone.height = 1.6
		cone.radial_segments = 24
		mesh.mesh = cone
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.2, 0.53, 1.0)
		mat.emission_enabled = true
		mat.emission = Color(0.07, 0.13, 0.3)
		mat.metallic = 0.1
		mat.roughness = 0.25
		mesh.material_override = mat
		node = mesh
	else:
		if _box_ps:
			node = _box_ps.instantiate() as Node3D
		else:
			var mesh := MeshInstance3D.new()
			var box := BoxMesh.new()
			box.size = Vector3(1, 1, 1)
			mesh.mesh = box
			var mat_b := StandardMaterial3D.new()
			mat_b.albedo_color = Color(0.55, 0.35, 0.2)
			mat_b.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
			mesh.material_override = mat_b
			node = mesh

	if node == null:
		return
	var wy := _water_height_at(x, z)
	node.position = Vector3(x, wy, z)
	node.scale = Vector3(size, size, size)
	node.set_meta("type", tname)
	node.set_meta("size", size)
	node.set_meta("base_y", node.position.y)
	node.set_meta("spin", randf() * TAU)
	_items_container.add_child(node)
	_items[id] = node

func _remove_item(id: String) -> void:
	if _items.has(id):
		var node: Node3D = _items[id] as Node3D
		if node and node.get_parent():
			node.get_parent().remove_child(node)
			node.queue_free()
		_items.erase(id)

func _animate_items(delta: float) -> void:
	var tsec := Time.get_ticks_msec() / 1000.0
	var halfW := _water_half_extents.x - 1.0
	var halfZ := _water_half_extents.y - 1.0
	for id in _items.keys():
		var node: Node3D = _items[id] as Node3D
		if node == null:
			continue
		var tname: String = String(node.get_meta("type"))
		if tname == "turtle":
			# Wander within bounds; face towards target
			var ai_target: Vector3 = node.get_meta("ai_target") as Vector3
			var speed: float = float(node.get_meta("ai_speed"))
			var to_target := ai_target - node.position
			var dir := Vector2(to_target.x, to_target.z)
			var dist := dir.length()
			if dist < 1.0:
				node.set_meta("ai_target", _rand_target_within())
			else:
				dir = dir.normalized()
				node.position.x += dir.x * speed * delta
				node.position.z += dir.y * speed * delta
				# Clamp
				node.position.x = clamp(node.position.x, -halfW, halfW)
				node.position.z = clamp(node.position.z, -halfZ, halfZ)
				# Yaw
				var yaw := atan2(dir.x, dir.y)
				node.rotation.y = lerp_angle(node.rotation.y, yaw, 0.15)
			# Subtle buoyancy
			var base_y := float(node.get_meta("base_y"))
			var sinv := sin(tsec * 2.0 + node.position.x * 0.5 + node.position.z * 0.3)
			node.position.y = lerp(node.position.y, base_y + sinv * 0.05, 0.05)
		else:
			# Idle bob
			var base_y := float(node.get_meta("base_y"))
			var sinv := sin(tsec * 2.0 + node.position.x * 0.5 + node.position.z * 0.3)
			node.position.y = base_y + 0.07 + sinv * 0.08
			# Power-up spin
			if tname.begins_with("powerup_"):
				node.rotation.y += 0.01

# ------------------------
# Collisions
# ------------------------

func _check_item_collisions() -> void:
	if boat == null:
		return
	var pid := Config.player_id
	var pname := Config.player_name
	# Sphere-ish distance checks
	var boat_pos := boat.global_transform.origin
	var remove_after: Array = []
	for id in _items.keys():
		var node: Node3D = _items[id] as Node3D
		if node == null:
			continue
		var tname := String(node.get_meta("type"))
		var pos := node.global_transform.origin
		var dist := boat_pos.distance_to(pos)
		var sz := 1.0
		if node.has_meta("size"):
			sz = float(node.get_meta("size"))
		else:
			sz = node.scale.x
		var base := 0.75
		if tname == "turtle":
			base = 0.6
		elif tname.begins_with("powerup_"):
			base = 0.8
		else:
			base = 0.75
		var radius: float = base * float(max(0.6, sz))
		if dist <= radius:
			# Power-ups: apply locally then notify server
			if tname == "powerup_speed":
				if boat.has_method("apply_speed_for_ms"):
					boat.call("apply_speed_for_ms", 10000, 2.0)
			elif tname == "powerup_shield":
				if boat.has_method("apply_shield_for_ms"):
					boat.call("apply_shield_for_ms", 5000)
			# Notify server (it will destroy and refill)
			Net.items_collision(id, pid, pname)
			remove_after.push_back(id)
			# Score heuristic (client-only)
			if tname == "turtle":
				# If shield active, no penalty (server also guards when authoritative)
				var penalize := true
				if boat.has_method("has_shield") and boat.call("has_shield"):
					penalize = false
				if penalize:
					_local_score -= 1
					_update_score_ui()
					_refresh_server_score(350)
			elif tname.begins_with("powerup_"):
				# no direct score change
				pass
			else:
				_local_score += 1
				_update_score_ui()
				_refresh_server_score(350)
	for id in remove_after:
		_remove_item(id)

func _check_trail_collisions() -> void:
	if boat == null:
		return
	var my_id := Config.player_id
	var p := boat.global_transform.origin
	# Skip during synchronized countdown
	if GameState.phase == GameState.PHASE_STARTING:
		return
	for id in _trails.keys():
		if id == my_id:
			continue
		var td: Dictionary = _trails[id] as Dictionary
		if not (td and td.has("points")):
			continue
		var pts: PackedVector3Array = td["points"] as PackedVector3Array
		for i in range(0, pts.size() - 1):
			var a := pts[i]
			var b := pts[i + 1]
			if _dist_point_to_segment_sq_2d(p, a, b) < 0.6 * 0.6:
				# Freeze for 5 seconds
				if boat.has_method("freeze_for_ms"):
					boat.call("freeze_for_ms", 5000)
				return

# ------------------------
# Badges (power-up icons, freeze countdown)
# ------------------------

func _update_badges() -> void:
	if boat == null:
		return
	# During STARTING: hide status badge (countdown uses 3D label)
	if GameState.phase == GameState.PHASE_STARTING:
		_status_badge.visible = false
	else:
		# Freeze remaining
		var left_ms := 0
		if boat.has_method("get_freeze_remaining_ms"):
			left_ms = int(boat.call("get_freeze_remaining_ms"))
		if left_ms > 0:
			var left_s := int(ceil(left_ms / 1000.0))
			_status_badge.text = "❄️ %ss" % str(left_s)
			_status_badge.visible = true
		else:
			_status_badge.text = ""
			_status_badge.visible = false

	# Power-ups: icons for speed/shield
	var icons := ""
	if boat.has_method("has_shield") and boat.call("has_shield"):
		icons += "🛡️"
	# Speed if multiplier > 1
	var mul: float = 1.0
	var mv_raw: Variant = boat.get("speed_multiplier")
	if typeof(mv_raw) == TYPE_INT or typeof(mv_raw) == TYPE_FLOAT:
		mul = float(mv_raw)
	if mul > 1.0:
		icons = "⚡" + icons
	_powerup_badge.text = icons
	_powerup_badge.visible = icons != ""

func _update_score_ui() -> void:
	if hud and hud.has_method("set_score"):
		hud.call("set_score", _local_score)

# Score service integration (read current authoritative score for this player)
func _on_score_http_ok(endpoint, payload) -> void:
	if String(endpoint) == "GET_ONE":
		var sc: int = 0
		if typeof(payload) == TYPE_DICTIONARY:
			# Accept multiple shapes { score }, { currentScore }, or { value }
			sc = int(payload.get("score", payload.get("currentScore", payload.get("value", 0))))
		_local_score = sc
		_update_score_ui()

func _on_score_http_err(_endpoint, _message, _code) -> void:
	# Silent fail; keep local HUD score
	pass

func _refresh_server_score(delay_ms: int = 0) -> void:
	if delay_ms <= 0:
		ScoreClient.get_user(Config.player_id)
	else:
		var timer := get_tree().create_timer(float(delay_ms) / 1000.0)
		timer.timeout.connect(func(): ScoreClient.get_user(Config.player_id))


# ------------------------
# Water sampling (CPU) for buoyancy & placement
# ------------------------

func _water_height_at(x: float, z: float) -> float:
	# Mirror shader UV logic in CPU space
	var t := Time.get_ticks_msec() / 1000.0
	var s_a: float = _wave_params["scale_a"]
	var s_b: float = _wave_params["scale_b"]
	var m_a: Vector2 = _wave_params["move_a"]
	var m_b: Vector2 = _wave_params["move_b"]
	var ti_a: float = _wave_params["time_a"]
	var ti_b: float = _wave_params["time_b"]
	var hmul: float = _wave_params["height"]

	var uv_a := Vector2(x / s_a, z / s_a) + m_a * t * ti_a
	var uv_b := Vector2(x / s_b, z / s_b) + m_b * t * ti_b

	var h1 := 0.0
	var h2 := 0.0
	if _wave_noise_a:
		h1 = (_wave_noise_a.get_noise_2d(uv_a.x, uv_a.y) * 0.5) + 0.5
	if _wave_noise_b:
		h2 = (_wave_noise_b.get_noise_2d(uv_b.x, uv_b.y) * 0.5) + 0.5

	return ((h1 + h2) * 0.5) * hmul

func _water_normal_at(x: float, z: float) -> Vector3:
	var e := 0.5
	var h0 := _water_height_at(x, z)
	var hx := _water_height_at(x + e, z)
	var hz := _water_height_at(x, z + e)
	var dx := (hx - h0) / e
	var dz := (hz - h0) / e
	return Vector3(-dx, 1.0, -dz).normalized()

# ------------------------
# Utils
# ------------------------

func _color_from_id(id: String) -> Color:
	var hash := 0
	for i in id.length():
		hash = int((hash * 31 + id.unicode_at(i)) & 0x7fffffff)
	var r := float(hash & 0xFF) / 255.0
	var g := float((hash >> 8) & 0xFF) / 255.0
	var b := float((hash >> 16) & 0xFF) / 255.0
	return Color(r, g, b)

func _rand_target_within() -> Vector3:
	var halfW := _water_half_extents.x
	var halfZ := _water_half_extents.y
	return Vector3(randf_range(-halfW, halfW), 0.0, randf_range(-halfZ, halfZ))

func _dist_point_to_segment_sq_2d(p: Vector3, a: Vector3, b: Vector3) -> float:
	# 2D (XZ plane) distance squared
	var ap := Vector2(p.x - a.x, p.z - a.z)
	var ab := Vector2(b.x - a.x, b.z - a.z)
	var ab_len_sq := ab.length_squared()
	var t := 0.0
	if ab_len_sq > 0.0:
		t = clamp(ap.dot(ab) / ab_len_sq, 0.0, 1.0)
	var cx := a.x + ab.x * t
	var cz := a.z + ab.y * t
	var dx := p.x - cx
	var dz := p.z - cz
	return dx * dx + dz * dz
