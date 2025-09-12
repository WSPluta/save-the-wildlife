extends Control

@onready var boat_lbl: Label = $Panel/VBox/Boat
@onready var world_lbl: Label = $Panel/VBox/World
@onready var logs: RichTextLabel = $Panel/VBox/Logs

var _accum: float = 0.0
var _update_hz: float = 5.0 # 5 fps UI refresh

func _ready() -> void:
	# Style logs for readability
	if logs:
		logs.bbcode_enabled = true
		logs.scroll_active = true
		logs.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART

func _process(delta: float) -> void:
	_accum += delta
	if _accum < (1.0 / max(0.1, _update_hz)):
		return
	_accum = 0.0

	# Pull snapshots from Debug singleton if available
	if Engine.has_singleton("Debug"):
		_update_boat(Debug.boat_state if Debug.boat_state != null else {})
		_update_world(Debug.world_state if Debug.world_state != null else {})

func _update_boat(st: Dictionary) -> void:
	if not boat_lbl:
		return
	var x := _num(st.get("x", 0.0), 2)
	var y := _num(st.get("y", 0.0), 2)
	var z := _num(st.get("z", 0.0), 2)
	var sp := _num(st.get("speed", 0.0), 2)
	var yaw := _num(rad_to_deg(float(st.get("yaw", 0.0))), 1)
	var thr := _num(st.get("throttle", 0.0), 2)
	var ste := _num(st.get("steer", 0.0), 2)
	var eff := String(st.get("effects", ""))

	# Extended debug: movement heading, input, camera, and control gain
	var heading := _num(rad_to_deg(float(st.get("heading", 0.0))), 1)
	var desired := _num(rad_to_deg(float(st.get("desired_yaw", 0.0))), 1)
	var brake := bool(st.get("brake", false))
	var smul := _num(st.get("speed_mul", 1.0), 2)
	var cam_yaw := _num(rad_to_deg(float(st.get("cam_yaw", 0.0))), 1)
	var cam_pitch := _num(rad_to_deg(float(st.get("cam_pitch", 0.0))), 1)
	var cam_len := _num(st.get("cam_len", 0.0), 2)
	var gain := _num(st.get("gain", 0.0), 2)

	boat_lbl.text = "Boat pos(%.2f, %.2f, %.2f)  yaw: %.1f°  hdg: %.1f°  des: %.1f°  gain: %.2f\nctrl  thr: %.2f  steer: %.2f  brake: %s  mul: %.2f  %s\ncam   yaw: %.1f°  pitch: %.1f°  len: %.2f" % [
		x, y, z, yaw, heading, desired, gain,
		thr, ste, str(brake), smul, eff,
		cam_yaw, cam_pitch, cam_len
	]

func _update_world(st: Dictionary) -> void:
	if not world_lbl:
		return
	var score := int(st.get("score", 0))
	var auth_fresh := bool(st.get("authFresh", false))
	var items := int(st.get("items", 0))
	var players := int(st.get("players", 0))
	var bounds: String = String(st.get("bounds", ""))
	world_lbl.text = "World  score: %d  authFresh: %s  items: %d  players: %d  bounds: %s" % [score, str(auth_fresh), items, players, bounds]

func _on_log(entry: Dictionary) -> void:
	# Called by Debug singleton when a new log arrives
	if not logs:
		return
	var t := int(entry.get("t", Time.get_ticks_msec()))
	var lvl := int(entry.get("lvl", 1))
	var msg := String(entry.get("msg", ""))
	var ctx := entry.get("ctx", {}) as Dictionary
	var hh := _time_fmt(t)
	var col := _level_color(lvl)
	var lvl_s := _level_name(lvl)
	var ctx_txt := _ctx_to_text(ctx)
	logs.append_bbcode("[color=%s][%s %-5s][/color] %s %s\n" % [col, hh, lvl_s, msg, ctx_txt])
	logs.scroll_to_line(logs.get_line_count())

func _level_name(l: int) -> String:
	match l:
		0: return "TRACE"
		1: return "DEBUG"
		2: return "INFO"
		3: return "WARN"
		4: return "ERROR"
		_: return "LOG"

func _level_color(l: int) -> String:
	match l:
		0: return "#7f8c8d"
		1: return "#3498db"
		2: return "#2ecc71"
		3: return "#f39c12"
		4: return "#e74c3c"
		_: return "#bdc3c7"

func _time_fmt(ms: int) -> String:
	var s := int(floor(ms / 1000.0))
	var m := int(floor(s / 60.0))
	var sec := s % 60
	var ms3 := ms % 1000
	return "%02d:%02d.%03d" % [m, sec, ms3]

func _num(v: Variant, dp: int) -> float:
	var f: float = 0.0
	if typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT:
		f = float(v)
	return float(snappedf(f, pow(10.0, -dp)))

func _ctx_to_text(ctx: Dictionary) -> String:
	if ctx.is_empty():
		return ""
	var parts: Array[String] = []
	for k in ctx.keys():
		var v: Variant = ctx[k]
		parts.push_back("%s=%s" % [str(k), _short(v)])
	return "{ %s }" % String(", ").join(parts)

func _short(v: Variant) -> String:
	match typeof(v):
		TYPE_DICTIONARY:
			return "[dict]"
		TYPE_ARRAY:
			return "[%d]" % int((v as Array).size())
		_:
			return str(v)
