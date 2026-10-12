@tool
extends RefCounted
## Resource domain handler: search/load/assign for loadable resources,
## with first-class support for .tres materials and collision shapes.

const UndoManager := preload("res://addons/godot_opencode/undo_manager.gd")

var _undo: RefCounted


func _init(undo_manager: RefCounted) -> void:
	_undo = undo_manager


func search_resources(params: Dictionary) -> Dictionary:
	var pattern := str(params.get("pattern", ""))
	var type_hint := str(params.get("type", ""))
	if pattern.is_empty():
		return {"error": {"code": "MISSING_REQUIRED_PARAM", "message": "Missing required param: pattern"}}
	var matches: Array = []
	var queue: Array[String] = ["res://"]
	var seen := 0
	while not queue.is_empty() and seen < 500:
		var directory := queue.pop_back()
		seen += 1
		for entry in DirAccess.get_files_at(directory):
			var full: String = directory.path_join(entry)
			if not full.match("*" + pattern + "*"):
				continue
			if not type_hint.is_empty() and not _type_matches(full, type_hint):
				continue
			matches.append(full)
			if matches.size() >= 50:
				break
		for sub in DirAccess.get_directories_at(directory):
			if not sub.begins_with("."):
				queue.append(directory.path_join(sub))
	return {"data": {"matches": matches}}


func load_resource(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	var check := _require_loadable(path)
	if not check.is_empty():
		return check
	var resource: Resource = ResourceLoader.load(path)
	if resource == null:
		return {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Failed to load resource: %s" % path}}
	return {"data": {"path": path, "type": resource.get_class()}}


func inspect_resource(params: Dictionary) -> Dictionary:
	var loaded := load_resource(params)
	if loaded.has("error"):
		return loaded
	var data: Dictionary = loaded["data"]
	var resource: Resource = ResourceLoader.load(str(data["path"]))
	var properties: Array = []
	for info in resource.get_property_list():
		if str(info.get("name", "")).begins_with("_"):
			continue
		properties.append({"name": str(info.get("name", "")), "type": str(info.get("class_name", info.get("type", "")))})
	data["properties"] = properties
	return {"data": data}


func assign_resource(params: Dictionary) -> Dictionary:
	var scene_root := EditorInterface.get_edited_scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var resource_path := str(params.get("resource_path", ""))
	var check := _require_loadable(resource_path)
	if not check.is_empty():
		return check
	if not ResourceLoader.exists(resource_path):
		return {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Resource not found: %s" % resource_path}}
	return _undo.set_property_by_path(
		scene_root,
		str(params.get("path", "")),
		str(params.get("property", "")),
		ResourceLoader.load(resource_path)
	)


func _require_loadable(path: String) -> Dictionary:
	if path.is_empty():
		return {"error": {"code": "MISSING_REQUIRED_PARAM", "message": "Missing required param: path"}}
	if not (path.ends_with(".tres") or path.ends_with(".res") or path.begins_with("uid://")):
		return {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Invalid resource reference (want .tres/.res/uid): %s" % path}}
	return {}


func _type_matches(path: String, type_hint: String) -> bool:
	if type_hint == "Material" and path.ends_with(".tres"):
		return true
	if type_hint == "Shape" and (path.ends_with(".tres") or path.ends_with(".res")):
		return true
	return path.ends_with(".tres") or path.ends_with(".res")
