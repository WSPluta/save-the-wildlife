extends Node

# Lightweight runtime debugging singleton.
# - Autoloaded (add to project.godot) to provide logging, simple overlay, and input toggles.
# - Press F1 to toggle overlay, F4 to dump state, F9 to reload current scene.
# - Other systems can push state snapshots via observe_boat_state / observe_world_state.

enum Level { TRACE, DEBUG, INFO, WARN, ERROR }

var enabled: bool = true
var level: int = Level.DEBUG
const MAX_LOGS := 500

var _logs: Array = []
var overlay: Node = null
var _overlay_ps: PackedScene = preload("res://scenes/DebugOverlay.tscn")

# Public observed state pulled by overlay
var boat_state: Dictionary = {}     # e.g. { x,y,z, speed, yaw, throttle, steer }
var world_state: Dictionary = {}    # e.g. { score, authFresh }

func _ready() -> void:
	_ensure_actions()
	if Engine.is_editor_hint():
		return

	# Try to attach overlay when a scene becomes current
	get_tree().node_added.connect(_on_node_added)

	# Hook to networking/score for observability if present
	if Engine.has_singleton("Net"):
		Net.server_event.connect(func(ev, data): debug("net.server_event", {"event": str(ev) }))
		Net.server_info.connect(func(info): info("net.server_info"))
		Net.game_on.connect(func(d): info("net.game_on"))
		Net.game_time.connect(func(sec): trace("net.game_time", {"sec": int(sec) }))
		Net.starting_game.connect(func(d): info("net.starting_game"))
	if Engine.has_singleton("ScoreClient"):
		ScoreClient.http_ok.connect(func(ep, payload): info("score.http_ok", {"ep": str(ep) }))
		ScoreClient.http_error.connect(func(ep, msg, code): warn("score.http_err", {"ep": str(ep), "code": int(code), "msg": str(msg) }))

	call_deferred("_ensure_overlay")

func _ensure_actions() -> void:
	var acts := {
		"debug_toggle": [KEY_F1],
		"debug_dump": [KEY_F4],
		"debug_reload": [KEY_F9],
		# Dev/testing shortcuts
		"debug_spawn10": [KEY_F2],
		"debug_clear_items": [KEY_F3],
		"debug_speed": [KEY_F5],
		"debug_freeze": [KEY_F6],
	}
	for a in acts.keys():
		if not InputMap.has_action(a):
			InputMap.add_action(a)
		for k in acts[a]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(a, ev)

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("debug_toggle"):
		toggle_overlay()
	elif event.is_action_pressed("debug_dump"):
		dump_state()
	elif event.is_action_pressed("debug_reload"):
		_reload_current_scene()

func _reload_current_scene() -> void:
	var tree := get_tree()
	if tree and tree.current_scene:
		var path := tree.current_scene.scene_file_path
		if path != "":
			warn("debug.reload_scene", {"path": path})
			tree.change_scene_to_file(path)

func _on_node_added(n: Node) -> void:
	# When a new current scene appears, ensure overlay is present
	if n == get_tree().current_scene:
		call_deferred("_ensure_overlay")

func _ensure_overlay() -> void:
	if overlay != null:
		return
	if _overlay_ps == null:
		return
	var root := get_tree().current_scene
	if root == null:
		return
	overlay = _overlay_ps.instantiate()
	# Ensure it renders on top and doesn't affect scene transforms
	root.add_child(overlay)
	overlay.set_owner(root)

# ----------------
# Logging API
# ----------------

func log_msg(l: int, msg: String, ctx: Dictionary = {}) -> void:
	if not enabled:
		return
	if l < level:
		return
	var entry := {
		"t": Time.get_ticks_msec(),
		"lvl": l,
		"msg": msg,
		"ctx": ctx,
	}
	_logs.push_back(entry)
	while _logs.size() > MAX_LOGS:
		_logs.remove_at(0)
	if overlay and overlay.has_method("_on_log"):
		overlay.call("_on_log", entry)

func trace(msg: String, ctx: Dictionary = {}) -> void:
	log_msg(Level.TRACE, msg, ctx)

func debug(msg: String, ctx: Dictionary = {}) -> void:
	log_msg(Level.DEBUG, msg, ctx)

func info(msg: String, ctx: Dictionary = {}) -> void:
	log_msg(Level.INFO, msg, ctx)

func warn(msg: String, ctx: Dictionary = {}) -> void:
	log_msg(Level.WARN, msg, ctx)

func error(msg: String, ctx: Dictionary = {}) -> void:
	log_msg(Level.ERROR, msg, ctx)

func get_recent_logs() -> Array:
	return _logs.duplicate()

# ----------------
# State snapshots
# ----------------

func observe_boat_state(s: Dictionary) -> void:
	boat_state = s

func observe_world_state(s: Dictionary) -> void:
	world_state = s

func dump_state() -> void:
	info("debug.dump", {"boat": boat_state, "world": world_state, "logs": _logs.size()})

# ----------------
# Overlay control
# ----------------

func toggle_overlay() -> void:
	_ensure_overlay()
	if overlay:
		overlay.visible = not overlay.visible
