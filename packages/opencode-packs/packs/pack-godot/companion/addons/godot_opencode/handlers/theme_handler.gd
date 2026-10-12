@tool
extends RefCounted
## Theme domain handler: inspect Theme/StyleBoxFlat/font/color overrides
## and apply style overrides as single undoable actions.

const UndoManager := preload("res://addons/godot_opencode/undo_manager.gd")

var _undo: RefCounted


func _init(undo_manager: RefCounted) -> void:
	_undo = undo_manager


func _scene_root() -> Node:
	return EditorInterface.get_edited_scene_root()


func inspect_theme(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var node: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if node == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % str(params.get("path", ""))}}
	if not (node is Control):
		return {"error": {"code": "WRONG_TYPE", "message": "Node is not a Control: %s" % str(params.get("path", ""))}}
	var control := node as Control
	var overrides: Array = []
	for name in ["normal", "hover", "pressed", "disabled", "focus"]:
		if control.has_theme_stylebox_override(name):
			var sb := control.get_theme_stylebox(name)
			overrides.append({"name": name, "type": sb.get_class() if sb != null else "null"})
	var colors: Array = []
	for cname in ["font_color", "font_hover_color", "font_pressed_color"]:
		if control.has_theme_color_override(cname):
			colors.append({"name": cname, "value": str(control.get_theme_color(cname))})
	return {
		"data": {
			"path": str(params.get("path", "")),
			"stylebox_overrides": overrides,
			"color_overrides": colors,
			"font_size": control.get_theme_font_size("font_size") if control.has_theme_font_size_override("font_size") else -1,
		}
	}


func apply_stylebox(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var node: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if node == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % str(params.get("path", ""))}}
	if not (node is Control):
		return {"error": {"code": "WRONG_TYPE", "message": "Node is not a Control"}}
	var control := node as Control
	var override_name := str(params.get("override", "normal"))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(str(params.get("bg_color", "#1a1d29")))
	sb.set_corner_radius_all(int(params.get("corner_radius", 8)))
	sb.set_border_width_all(int(params.get("border_width", 0)))
	sb.border_color = Color(str(params.get("border_color", "#00000000")))
	sb.content_margin_left = float(params.get("content_margin", 12.0))
	sb.content_margin_right = float(params.get("content_margin", 12.0))
	sb.content_margin_top = float(params.get("content_margin", 12.0))
	sb.content_margin_bottom = float(params.get("content_margin", 12.0))
	var undo_redo: EditorUndoRedoManager = _undo.get("_undo_redo")
	undo_redo.create_action("OpenCode: Style %s" % override_name)
	undo_redo.add_do_method(control, "add_theme_stylebox_override", override_name, sb)
	undo_redo.add_undo_method(control, "remove_theme_stylebox_override", override_name)
	undo_redo.commit_action()
	return {"data": {"path": str(params.get("path", "")), "override": override_name, "undoable": true}}


func apply_font_override(params: Dictionary) -> Dictionary:
	var scene_root := _scene_root()
	if scene_root == null:
		return {"error": {"code": "EDITOR_NOT_READY", "message": "No open scene", "data": {"sub_code": "EDITOR_NO_SCENE"}}}
	var node: Node = UndoManager._resolve_by_path(scene_root, str(params.get("path", "")))
	if node == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % str(params.get("path", ""))}}
	if not (node is Control):
		return {"error": {"code": "WRONG_TYPE", "message": "Node is not a Control"}}
	var control := node as Control
	var undo_redo: EditorUndoRedoManager = _undo.get("_undo_redo")
	undo_redo.create_action("OpenCode: Font override")
	if params.has("font_size"):
		undo_redo.add_do_method(control, "add_theme_font_size_override", "font_size", int(params.get("font_size")))
		undo_redo.add_undo_method(control, "remove_theme_font_size_override", "font_size")
	if params.has("font_color"):
		undo_redo.add_do_method(control, "add_theme_color_override", "font_color", Color(str(params.get("font_color"))))
		undo_redo.add_undo_method(control, "remove_theme_color_override", "font_color")
	undo_redo.commit_action()
	return {"data": {"path": str(params.get("path", "")), "undoable": true}}
