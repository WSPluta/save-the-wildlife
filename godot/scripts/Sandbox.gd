extends Node3D

# Offline single-player sandbox to validate core mechanics (controls, items, score, bounds)
# - No networking required
# - Flat water plane in XZ at y = 0
# - Boat clamped to rectangular bounds
# - Spawns collectible "trash" items; increments score on pickup
# - Debug overlay integration with runtime state and dev hotkeys (F2, F3, F5, F6)

@export var water_size: Vector2 = Vector2(200, 200)
@export var initial_items: int = 20
@export var clamp_margin: float = 1.0

@onready var boat: Node3D = null
@onready var hud: CanvasItem = null

var _half_extents: Vector2 = Vector2.ZERO
var _items: Dictionary = {} # id -> Node3D
var _score: int = 0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()
	# Lighting for readability
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.5
	add_child(sun)

	# Water plane in XZ at y=0
	_half_extents = water_size * 0.5
	var plane_mesh := PlaneMesh.new()
	plane_mesh.size = water_size
	plane_mesh.subdivide_depth = 1
	plane_mesh.subdivide_width = 1
	var water := MeshInstance3D.new()
	water.mesh = plane_mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.05, 0.15, 0.25)
	mat.roughness = 0.8
	water.material_override = mat
	water.position = Vector3(0, 0, 0)
	add_child(water)

	# Boat
	var boat_ps: PackedScene = load("res://scenes/Boat.tscn")
	if boat_ps:
		boat = boat_ps.instantiate() as Node3D
		add_child(boat)
		boat.position = Vector3(0, 0, 0)

	# HUD (for score)
	var hud_ps: PackedScene = load("res://scenes/HUD.tscn")
	if hud_ps:
		hud = hud_ps.instantiate() as CanvasItem
		add_child(hud)
		_call_hud_set_score()

	# Spawn initial items
	for i in initial_items:
		_spawn_item()

	# Log / Debug overlay
	if typeof(Debug) != TYPE_NIL:
		Debug.info("sandbox.ready", {"items": initial_items, "size": str(water_size)})

	set_process_input(true)
	set_physics_process(true)
	set_process(true)

func _process(_delta: float) -> void:
	# Update Debug overlay world snapshot
	if typeof(Debug) != TYPE_NIL and Debug.has_method("observe_world_state"):
		var bounds_s := "±(%.1f, %.1f)" % [_half_extents.x, _half_extents.y]
		Debug.observe_world_state({
			"score": _score,
			"items": _items.size(),
			"players": 1,
			"bounds": bounds_s,
			"authFresh": false
		})

func _physics_process(_delta: float) -> void:
	# Clamp boat within bounds (XZ)
	if boat:
		var p := boat.position
		var halfW := _half_extents.x - clamp_margin
		var halfZ := _half_extents.y - clamp_margin
		p.x = clamp(p.x, -halfW, halfW)
		p.z = clamp(p.z, -halfZ, halfZ)
		# Keep on water plane y=0; let Boat.gd tilt/camera handle orientation
		p.y = 0.0
		boat.position = p

	# Items: bob and spin
	var t := Time.get_ticks_msec() / 1000.0
	for id in _items.keys():
		var n: Node3D = _items[id] as Node3D
		if n == null:
			continue
		# Bobbing
		var base_y := float(n.get_meta("base_y"))
		n.position.y = base_y + 0.07 + 0.08 * sin(t * 2.0 + n.position.x * 0.5 + n.position.z * 0.3)
		# Spin
		n.rotation.y += 0.01

	# Collision against boat
	if boat:
		var bp := boat.global_transform.origin
		var to_remove: Array = []
		for id in _items.keys():
			var n: Node3D = _items[id]
			if n == null:
				to_remove.push_back(id)
				continue
			var dist := bp.distance_to(n.global_transform.origin)
			var radius := 0.75 * float(max(0.6, n.scale.x))
			if dist <= radius:
				# Picked up: score++
				_score += 1
				_call_hud_set_score()
				to_remove.push_back(id)
		for id in to_remove:
			_remove_item(id)

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("debug_spawn10"):
		for i in 10:
			_spawn_item()
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("sandbox.spawn10", {"items": _items.size()})
	elif event.is_action_pressed("debug_clear_items"):
		_clear_items()
		if typeof(Debug) != TYPE_NIL:
			Debug.debug("sandbox.clear_items")
	elif event.is_action_pressed("debug_speed"):
		if boat and boat.has_method("apply_speed_for_ms"):
			boat.call("apply_speed_for_ms", 6000, 2.0)
			if typeof(Debug) != TYPE_NIL:
				Debug.info("sandbox.effect_speed", {"ms": 6000, "mul": 2.0})
	elif event.is_action_pressed("debug_freeze"):
		if boat and boat.has_method("freeze_for_ms"):
			boat.call("freeze_for_ms", 3000)
			if typeof(Debug) != TYPE_NIL:
				Debug.info("sandbox.effect_freeze", {"ms": 3000})

func _spawn_item() -> void:
	var id := _new_id()
	var n := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(1, 1, 1)
	n.mesh = box
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.55, 0.35, 0.2)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	n.material_override = m
	var hx := _half_extents.x - clamp_margin
	var hz := _half_extents.y - clamp_margin
	var px := _rng.randf_range(-hx, hx)
	var pz := _rng.randf_range(-hz, hz)
	n.position = Vector3(px, 0.0, pz)
	n.rotation.y = _rng.randf_range(0.0, TAU)
	var s := _rng.randf_range(0.7, 1.3)
	n.scale = Vector3(s, s, s)
	n.set_meta("base_y", n.position.y)
	add_child(n)
	_items[id] = n

func _remove_item(id: String) -> void:
	if _items.has(id):
		var n: Node3D = _items[id]
		if n and n.get_parent():
			n.get_parent().remove_child(n)
			n.queue_free()
		_items.erase(id)

func _clear_items() -> void:
	for id in _items.keys():
		var n: Node3D = _items[id]
		if n and n.get_parent():
			n.get_parent().remove_child(n)
			n.queue_free()
	_items.clear()

func _new_id() -> String:
	return "%08x" % _rng.randi()

func _call_hud_set_score() -> void:
	if hud and hud.has_method("set_score"):
		hud.call("set_score", _score)
