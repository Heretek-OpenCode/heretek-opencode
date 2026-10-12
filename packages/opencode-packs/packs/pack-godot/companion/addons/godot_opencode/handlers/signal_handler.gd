@tool
extends RefCounted
## Signal domain handler: list/connect/disconnect with editor-internal
## signals filtered out so automation only sees game-relevant signals.

const UndoManager := preload("res://addons/godot_opencode/undo_manager.gd")

## Engine-lifecycle signals that automation must never bind to.
const EDITOR_INTERNAL_SIGNALS := ["tree_exited", "tree_entered", "ready", "renamed", "replacing_by"]

var _undo: RefCounted


func _init(undo_manager: RefCounted) -> void:
	_undo = undo_manager


func _scene_root() -> Node:
	return EditorInterface.get_edited_scene_root()


func list_signals(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var node: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if node == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % str(params.get("path", ""))}}
	var names: Array = []
	for entry in node.get_signal_list():
		var signal_name := str(entry.get("name", ""))
		if signal_name.is_empty() or signal_name in EDITOR_INTERNAL_SIGNALS:
			continue
		names.append(signal_name)
	return {"data": {"signals": names}}


func connect_signal(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var signal_name := str(params.get("signal", ""))
	if signal_name in EDITOR_INTERNAL_SIGNALS:
		return {"error": {"code": "INVALID_PARAMS", "message": "Refusing to bind editor-internal signal: %s" % signal_name}}
	var source: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if source == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Source node not found"}}
	var target: Node = UndoManager._resolve_by_path(scene_root, str(params.get("target_path", "")))
	if target == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Target node not found"}}
	var method := StringName(str(params.get("method", "")))
	if not target.has_method(method):
		return {"error": {"code": "INVALID_PARAMS", "message": "Target has no method: %s" % method}}
	var undo_redo: EditorUndoRedoManager = _undo.get("_undo_redo")
	undo_redo.create_action("OpenCode: Connect %s" % signal_name)
	undo_redo.add_do_method(source, "connect", StringName(signal_name), Callable(target, method))
	undo_redo.add_undo_method(source, "disconnect", StringName(signal_name), Callable(target, method))
	undo_redo.commit_action()
	return {"data": {"signal": signal_name, "undoable": true}}


func disconnect_signal(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var signal_name := str(params.get("signal", ""))
	var source: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if source == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Source node not found"}}
	var target: Node = UndoManager._resolve_by_path(scene_root, str(params.get("target_path", "")))
	if target == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Target node not found"}}
	var callable := Callable(target, StringName(str(params.get("method", ""))))
	if not source.is_connected(StringName(signal_name), callable):
		return {"error": {"code": "INVALID_PARAMS", "message": "Signal not connected: %s" % signal_name}}
	var undo_redo: EditorUndoRedoManager = _undo.get("_undo_redo")
	undo_redo.create_action("OpenCode: Disconnect %s" % signal_name)
	undo_redo.add_do_method(source, "disconnect", StringName(signal_name), callable)
	undo_redo.add_undo_method(source, "connect", StringName(signal_name), callable)
	undo_redo.commit_action()
	return {"data": {"signal": signal_name, "undoable": true}}
