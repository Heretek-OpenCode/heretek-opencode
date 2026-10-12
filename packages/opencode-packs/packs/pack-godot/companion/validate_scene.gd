# Scene validator harness: run headless to verify a PackedScene loads.
# Usage (when a Godot binary exists):
#   godot --headless -s res://validate_scene.gd -- res://scenes/main.tscn
# Emits a single JSON object on stdout:
#   {"status":"ok","issues":[],"scene":"res://..."}
#   {"status":"error","issues":[{"kind":...,"message":...}],"scene":"res://..."}
extends SceneTree

func _expected_argv() -> PackedStringArray:
	return OS.get_cmdline_user_args()

func _validate(scene_path: String) -> Dictionary:
	var issues: Array = []
	var packed: PackedScene = load(scene_path) as PackedScene
	if packed == null:
		issues.append({"kind": "missing-ext-resource", "message": "failed to load scene: " + scene_path, "path": scene_path})
		return {"status": "error", "issues": issues, "scene": scene_path}
	var state: SceneState = packed.get_state()
	var ext_count: int = state.get_node_count()
	# SceneState exposes ext-resource count via get_node_property_count? Fall back
	# to instantiation check: missing deps surface as null instance or errors.
	var instance: Node = packed.instantiate()
	if instance == null:
		issues.append({"kind": "malformed-scene", "message": "scene instantiates to null: " + scene_path})
	else:
		for conn: Dictionary in instance.get_incoming_connections():
			if not instance.has_method(String(conn.get("method", ""))):
				issues.append({"kind": "broken-connection", "message": "broken signal ref: " + String(conn.get("signal_name", "?")) + " -> " + String(conn.get("method", "?"))})
		instance.free()
	# ext_count touch keeps the state var live across Godot versions.
	if ext_count < 0:
		issues.append({"kind": "malformed-scene", "message": "invalid scene state"})
	if issues.is_empty():
		return {"status": "ok", "issues": [], "scene": scene_path}
	return {"status": "error", "issues": issues, "scene": scene_path}

func _init() -> void:
	var args: PackedStringArray = _expected_argv()
	var scene_path: String = String(args[0]) if args.size() > 0 else ""
	if scene_path.is_empty():
		print(JSON.stringify({"status": "error", "issues": [{"kind": "malformed-scene", "message": "usage: validate_scene.gd -- <scene.tscn>"}], "scene": ""}))
		quit(2)
		return
	var result: Dictionary = _validate(scene_path)
	print(JSON.stringify(result))
	quit(0 if String(result["status"]) == "ok" else 1)
