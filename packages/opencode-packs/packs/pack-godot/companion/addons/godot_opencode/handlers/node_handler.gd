@tool
extends RefCounted
## Node domain handler: create/delete/reparent/set-property plus scene
## instancing. All mutations route through the UndoManager so every write
## is one atomic undoable action; scene instancing uses
## PackedScene.GEN_EDIT_STATE_INSTANCE so the editor keeps a live link to
## the sub-scene instead of an exploded subtree.

const UndoManager := preload("res://addons/godot_opencode/undo_manager.gd")

var _undo: RefCounted


func _init(undo_manager: RefCounted) -> void:
	_undo = undo_manager


func _scene_root() -> Node:
	return EditorInterface.get_edited_scene_root()


func create_node(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var scene_path := str(params.get("scene_path", ""))
	if not scene_path.is_empty():
		return instantiate_scene(params)
	var node_type := str(params.get("type", ""))
	if node_type.is_empty():
		return {"error": {"code": "MISSING_REQUIRED_PARAM", "message": "Missing required param: type (or provide scene_path)"}}
	if not ClassDB.class_exists(node_type):
		return {"error": {"code": "VALUE_OUT_OF_RANGE", "message": "Unknown node type: %s" % node_type}}
	if not ClassDB.is_parent_class(node_type, "Node"):
		return {"error": {"code": "WRONG_TYPE", "message": "%s is not a Node type" % node_type}}
	var child: Node = ClassDB.instantiate(node_type)
	if child == null:
		return {"error": {"code": "INTERNAL_ERROR", "message": "Failed to instantiate %s" % node_type}}
	var node_name := str(params.get("name", ""))
	if not node_name.is_empty():
		child.name = node_name
	return _undo.add_node_by_path(scene_root, str(params.get("parent_path", "/")), child)


func instantiate_scene(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var scene_path := str(params.get("scene_path", ""))
	if scene_path.is_empty():
		return {"error": {"code": "MISSING_REQUIRED_PARAM", "message": "Missing required param: scene_path"}}
	if not (scene_path.ends_with(".tscn") or scene_path.ends_with(".scn") or scene_path.begins_with("uid://")):
		return {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Invalid scene reference: %s" % scene_path}}
	if not ResourceLoader.exists(scene_path):
		return {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Scene not found: %s" % scene_path}}
	var packed := ResourceLoader.load(scene_path)
	if packed == null or not (packed is PackedScene):
		return {"error": {"code": "WRONG_TYPE", "message": "Resource at %s is not a PackedScene" % scene_path}}
	var instance: Node = (packed as PackedScene).instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
	if instance == null:
		return {"error": {"code": "INTERNAL_ERROR", "message": "Failed to instantiate scene: %s" % scene_path}}
	var node_name := str(params.get("name", ""))
	if not node_name.is_empty():
		instance.name = node_name
	var result: Dictionary = _undo.add_node_by_path(scene_root, str(params.get("parent_path", "/")), instance)
	if result.has("data"):
		result["data"]["scene_path"] = scene_path
	return result


func delete_node(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	return _undo.delete_node_by_path(scene_root, str(params.get("path", "")))


func reparent_node(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var node_path := str(params.get("path", ""))
	var new_parent_path := str(params.get("new_parent_path", ""))
	var node: Node = UndoManager._resolve_by_path(scene_root, node_path)
	if node == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % node_path}}
	var new_parent: Node = UndoManager._resolve_by_path(scene_root, new_parent_path)
	if new_parent == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "New parent not found: %s" % new_parent_path}}
	if node == scene_root:
		return {"error": {"code": "INVALID_PARAMS", "message": "Cannot reparent the scene root"}}
	var old_parent := node.get_parent()
	var old_index := node.get_index()
	var undo_redo: EditorUndoRedoManager = _undo.get("_undo_redo")
	undo_redo.create_action("OpenCode: Reparent %s" % node.name)
	undo_redo.add_do_method(old_parent, "remove_child", node)
	undo_redo.add_do_method(new_parent, "add_child", node, true)
	undo_redo.add_do_method(node, "set_owner", scene_root)
	undo_redo.add_do_reference(node)
	undo_redo.add_undo_method(new_parent, "remove_child", node)
	undo_redo.add_undo_method(_undo, "_undo_reinsert_by_path", scene_root, UndoManager._path_of(scene_root, old_parent), node, old_index)
	undo_redo.commit_action()
	return {"data": {"path": UndoManager._path_of(scene_root, node), "undoable": true}}


func set_property(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	return _undo.set_property_by_path(scene_root, str(params.get("path", "")), str(params.get("property", "")), params.get("value"))
