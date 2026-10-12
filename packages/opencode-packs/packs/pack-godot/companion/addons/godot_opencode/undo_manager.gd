@tool
extends RefCounted
## Non-destructive editor mutation facade over EditorUndoRedoManager.
##
## Every mutation registers one atomic undo/redo action. Undo steps never
## use cached child indices: each undo method re-resolves its target by
## scene path at undo time, so deleting a middle sibling (or any reorder
## between do and undo) cannot drift the restore position. Nodes created
## mid-action are pinned with add_do_reference so the GC cannot collect
## them while the action is alive.

var _undo_redo: EditorUndoRedoManager


func _init(undo_redo: EditorUndoRedoManager) -> void:
	_undo_redo = undo_redo


## Add `child` under the node at `parent_path`, resolved against scene_root.
## The child's owner is set to scene_root in the same action so saving the
## scene persists it (auto-dependency bundled atomically).
func add_node_by_path(scene_root: Node, parent_path: String, child: Node) -> Dictionary:
	var parent := _resolve_by_path(scene_root, parent_path)
	if parent == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Parent not found: %s" % parent_path}}
	_undo_redo.create_action("OpenCode: Add %s" % child.name)
	_undo_redo.add_do_method(parent, "add_child", child, true)
	_undo_redo.add_do_method(child, "set_owner", scene_root)
	_undo_redo.add_do_reference(child)
	_undo_redo.add_undo_method(parent, "remove_child", child)
	_undo_redo.commit_action()
	return {"data": {"path": _path_of(scene_root, child), "undoable": true}}


## Delete the node at `node_path`. The undo step re-resolves the parent by
## path and clamps the restore index to the parent's CURRENT child count,
## which is what makes middle-child deletes drift-proof.
func delete_node_by_path(scene_root: Node, node_path: String) -> Dictionary:
	var target := _resolve_by_path(scene_root, node_path)
	if target == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % node_path}}
	if target == scene_root:
		return {"error": {"code": "INVALID_PARAMS", "message": "Refusing to delete the scene root"}}
	var parent := target.get_parent()
	var parent_path := _path_of(scene_root, parent)
	var restore_index := target.get_index()
	_undo_redo.create_action("OpenCode: Delete %s" % target.name)
	_undo_redo.add_do_method(parent, "remove_child", target)
	_undo_redo.add_undo_reference(target)
	_undo_redo.add_undo_method(self, "_undo_reinsert_by_path", scene_root, parent_path, target, restore_index)
	_undo_redo.commit_action()
	return {"data": {"path": node_path, "undoable": true}}


## Undo-time reinsertion: resolve the parent fresh by path, then clamp the
## recorded index into the live child range before restoring ownership.
func _undo_reinsert_by_path(scene_root: Node, parent_path: String, node: Node, index: int) -> void:
	var parent := _resolve_by_path(scene_root, parent_path)
	if parent == null:
		return
	var clamped := clampi(index, 0, parent.get_child_count())
	parent.add_child(node, true)
	parent.move_child(node, clamped)
	node.set_owner(scene_root)


## Rename the node at `node_path`. Undo resolves the node by its NEW path
## (post-rename) so a rename-then-reorder sequence still finds it.
## Node-name rule (verified against Godot 4.7): non-empty, and none of the
## characters the engine silently rewrites on add_child (":", "/", ".",
## "@", '"', "%"). Rejected names fail closed with INVALID_PARAMS instead
## of being stored mangled.
static func is_valid_node_name(value: String) -> bool:
	if value.is_empty():
		return false
	for ch in [":", "/", ".", "@", "\"", "%"]:
		if ch in value:
			return false
	return true


func rename_node_by_path(scene_root: Node, node_path: String, new_name: String) -> Dictionary:
	if not is_valid_node_name(new_name):
		return {"error": {"code": "INVALID_PARAMS", "message": "Invalid node name: %s" % new_name}}
	var target := _resolve_by_path(scene_root, node_path)
	if target == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % node_path}}
	var old_name := target.name
	var parent_path := _path_of(scene_root, target.get_parent())
	_undo_redo.create_action("OpenCode: Rename %s" % old_name)
	_undo_redo.add_do_method(target, "set_name", new_name)
	_undo_redo.add_undo_method(self, "_undo_rename_by_path", scene_root, parent_path, new_name, old_name)
	_undo_redo.commit_action()
	return {"data": {"path": _path_of(scene_root, target), "undoable": true}}


func _undo_rename_by_path(scene_root: Node, parent_path: String, current_name: String, old_name: String) -> void:
	var parent := _resolve_by_path(scene_root, parent_path)
	if parent == null or not parent.has_node(String(current_name)):
		return
	var node := parent.get_node(String(current_name))
	node.set_name(old_name)


## Set one property on the node at `node_path`, recording the prior value
## for an exact restore (including prior-null, which clears the override).
func set_property_by_path(scene_root: Node, node_path: String, property: String, value: Variant) -> Dictionary:
	var target := _resolve_by_path(scene_root, node_path)
	if target == null:
		return {"error": {"code": "NODE_NOT_FOUND", "message": "Node not found: %s" % node_path}}
	var prior: Variant = target.get(property)
	_undo_redo.create_action("OpenCode: Set %s.%s" % [target.name, property])
	_undo_redo.add_do_property(target, property, value)
	if prior == null:
		_undo_redo.add_undo_method(self, "_undo_clear_property_by_path", scene_root, node_path, property)
	else:
		_undo_redo.add_undo_property(target, property, prior)
	_undo_redo.commit_action()
	return {"data": {"path": node_path, "property": property, "undoable": true}}


func _undo_clear_property_by_path(scene_root: Node, node_path: String, property: String) -> void:
	var target := _resolve_by_path(scene_root, node_path)
	if target == null:
		return
	target.set(property, null)


## Resolve a clean scene path ("/A/B" or "" for the root) at call time.
## Callers must invoke this at undo time, never reuse a cached Node for
## position-sensitive restores.
static func _resolve_by_path(scene_root: Node, path: String) -> Node:
	if scene_root == null:
		return null
	if path.is_empty() or path == "/":
		return scene_root
	var clean := path.trim_prefix("/")
	if not scene_root.has_node(clean):
		return null
	return scene_root.get_node(clean)


static func _path_of(scene_root: Node, node: Node) -> String:
	if node == null or node == scene_root:
		return "/"
	var rel := scene_root.get_path_to(node)
	return "/" + str(rel)
