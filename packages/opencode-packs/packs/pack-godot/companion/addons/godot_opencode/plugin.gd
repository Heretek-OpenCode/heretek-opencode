@tool
extends EditorPlugin
## Godot OpenCode companion addon entry point.
## Owns the authenticated bridge lifecycle: _enter_tree builds the
## connection, dispatcher, undo manager and domain handlers, then starts
## the loopback server; _exit_tree tears everything down synchronously so
## no socket or handler outlives the plugin.

const Connection := preload("res://addons/godot_opencode/connection.gd")
const Dispatcher := preload("res://addons/godot_opencode/dispatcher.gd")
const UndoManager := preload("res://addons/godot_opencode/undo_manager.gd")
const NodeHandler := preload("res://addons/godot_opencode/handlers/node_handler.gd")
const SignalHandler := preload("res://addons/godot_opencode/handlers/signal_handler.gd")
const ResourceHandler := preload("res://addons/godot_opencode/handlers/resource_handler.gd")
const ShaderHandler := preload("res://addons/godot_opencode/handlers/shader_handler.gd")
const ThemeHandler := preload("res://addons/godot_opencode/handlers/theme_handler.gd")
const ViewportHandler := preload("res://addons/godot_opencode/viewport_handler.gd")
const DebuggerPlugin := preload("res://addons/godot_opencode/debugger/debugger_plugin.gd")

const DEFAULT_CAPABILITY_DIR := "~/.config/opencode/godot/capabilities"
const BRIDGE_PORT := 9500

var _connection: Node = null
var _dispatcher: RefCounted = null
var _debugger_plugin: EditorDebuggerPlugin = null
## Retain every RefCounted handler for the plugin's lifetime. Callables bound
## to a RefCounted method do NOT extend its lifetime: once the constructing
## local goes out of scope the object is freed and every dispatch fails with
## `null::<method> (Callable)` (proven live on Godot 4.7). Nodes (_connection)
## are kept alive by the scene tree; RefCounteds need this explicit anchor.
var _handler_refs: Array = []


func _enter_tree() -> void:
	var undo_manager := UndoManager.new(get_undo_redo())
	_dispatcher = Dispatcher.new()
	var nodes := NodeHandler.new(undo_manager)
	var signals := SignalHandler.new(undo_manager)
	var resources := ResourceHandler.new(undo_manager)
	var shaders := ShaderHandler.new()
	var themes := ThemeHandler.new(undo_manager)
	var viewport := ViewportHandler.new()
	_handler_refs = [undo_manager, nodes, signals, resources, shaders, themes, viewport]
	_register_node_commands(nodes)
	_register_signal_commands(signals)
	_register_resource_commands(resources)
	_register_shader_commands(shaders)
	_register_theme_commands(themes)
	_register_viewport_commands(viewport)
	_connection = Connection.new()
	_connection.name = "GodotOpenCodeConnection"
	_connection.dispatcher = _dispatcher
	add_child(_connection)
	_debugger_plugin = DebuggerPlugin.new()
	_debugger_plugin.forward_target = _connection
	add_debugger_plugin(_debugger_plugin)
	var err: int = _connection.startup(_capability_record_path())
	if err != OK:
		push_warning("GodotOpenCode: bridge not listening (%s)" % error_string(err))


func _exit_tree() -> void:
	if _debugger_plugin != null and is_instance_valid(_debugger_plugin):
		remove_debugger_plugin(_debugger_plugin)
	_debugger_plugin = null
	if _connection != null and is_instance_valid(_connection):
		_connection.shutdown()
		remove_child(_connection)
		_connection.queue_free()
	_connection = null
	if _dispatcher != null:
		_dispatcher.clear_queue()
	_dispatcher = null


func _process(_delta: float) -> void:
	if _dispatcher != null and _connection != null and _connection.is_listening():
		for response in _dispatcher.tick():
			_connection.send_response(response)


func _register_node_commands(handler: RefCounted) -> void:
	_dispatcher.register("create_node", handler.create_node)
	_dispatcher.register("delete_node", handler.delete_node)
	_dispatcher.register("reparent_node", handler.reparent_node)
	_dispatcher.register("set_property", handler.set_property)
	_dispatcher.register("instantiate_scene", handler.instantiate_scene)


func _register_signal_commands(handler: RefCounted) -> void:
	_dispatcher.register("list_signals", handler.list_signals)
	_dispatcher.register("connect_signal", handler.connect_signal)
	_dispatcher.register("disconnect_signal", handler.disconnect_signal)


func _register_resource_commands(handler: RefCounted) -> void:
	_dispatcher.register("search_resources", handler.search_resources)
	_dispatcher.register("load_resource", handler.load_resource)
	_dispatcher.register("inspect_resource", handler.inspect_resource)
	_dispatcher.register("assign_resource", handler.assign_resource)


func _register_shader_commands(handler: RefCounted) -> void:
	_dispatcher.register("generate_shader", handler.generate_shader)
	_dispatcher.register("inject_uniform", handler.inject_uniform)
	_dispatcher.register("list_uniforms", handler.list_uniforms)


func _register_theme_commands(handler: RefCounted) -> void:
	_dispatcher.register("inspect_theme", handler.inspect_theme)
	_dispatcher.register("apply_stylebox", handler.apply_stylebox)
	_dispatcher.register("apply_font_override", handler.apply_font_override)


func _register_viewport_commands(handler: RefCounted) -> void:
	_dispatcher.register("capture_viewport", handler.capture_viewport)
	_dispatcher.register("frame_aabb", handler.frame_aabb)
	_dispatcher.register("capture_status", handler.capture_status)


func _capability_record_path() -> String:
	var override := OS.get_environment("GODOT_CAPABILITY_DIR").strip_edges()
	var directory := override if not override.is_empty() else DEFAULT_CAPABILITY_DIR
	return directory.path_join("%d.json" % BRIDGE_PORT)
