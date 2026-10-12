@tool
extends EditorDebuggerPlugin
## Out-of-band debugger bridge for the godot-opencode companion addon.
##
## Captures game-subprocess traffic on the "opencode" message channel:
## runtime console lines, unhandled exceptions (always with a stack), and
## query responses for engine-bridge requests the addon issues. Captured
## payloads are forwarded to the bridge connection as events; query
## responses route back by their request id.

const CAPTURE_CHANNEL := "opencode"

## Forwarding sink, set by plugin.gd (the bridge connection). Receives one
## event dictionary per captured message.
var forward_target: Node = null

var _sessions: Array = []
var _pending_queries: Dictionary = {}


func _setup_session(session_id: int) -> void:
	if not _sessions.has(session_id):
		_sessions.append(session_id)


## Engine capture entry point: the editor routes channel traffic to this
## plugin when _has_capture reports the channel as handled.
func _capture(message: String, data: Array, _session_id: int) -> bool:
	return _on_capture(message, data)


## EditorDebuggerPlugin virtual (parent: `_has_capture(String) -> bool`):
## report whether this plugin captures the given channel.
func _has_capture(capture: String) -> bool:
	return capture == CAPTURE_CHANNEL


## Engine capture callback. Returns true when the message was consumed.
func _on_capture(message: StringName, data: Array) -> bool:
	var captured := _classify(str(message), data)
	if captured.is_empty():
		return false
	_forward(captured)
	return true


## Classify one captured channel message into a forwardable envelope.
## Unknown messages yield {} (ignored, never forwarded).
static func _classify(message: String, data: Array) -> Dictionary:
	if message == "opencode:console":
		if data.is_empty() or not (data[0] is String):
			return {}
		return {"type": "event", "event": "game_console", "data": {"text": str(data[0])}}
	if message == "opencode:exception":
		if data.is_empty() or not (data[0] is Dictionary):
			return {}
		var info: Dictionary = data[0]
		if not (info.get("message") is String):
			return {}
		var stack: Array = []
		if info.get("stack") is Array:
			for frame in info["stack"]:
				stack.append(str(frame))
		return {
			"type": "event",
			"event": "game_exception",
			"data": {"message": str(info["message"]), "stack": stack},
		}
	if message == "opencode:query_response":
		if data.is_empty() or not (data[0] is Dictionary):
			return {}
		var reply: Dictionary = data[0]
		if not (reply.get("id") is String):
			return {}
		return {"type": "response", "id": str(reply["id"]), "data": reply.get("payload", {})}
	return {}


func _forward(envelope: Dictionary) -> void:
	if forward_target != null and forward_target.has_method("send_event"):
		forward_target.send_event(str(envelope.get("event", "debugger_message")), envelope.get("data", {}))
	_pending_queries.erase(str(envelope.get("id", "")))


## Issue one engine-bridge query to the running game. The game-side
## handler replies with opencode:query_response carrying the same id.
func query_game(query_id: String, method: String, params: Dictionary = {}) -> bool:
	if _sessions.is_empty():
		return false
	_pending_queries[query_id] = {"method": method, "started": Time.get_ticks_msec()}
	var session := get_session(int(_sessions[0]))
	if session == null:
		return false
	session.send_message("opencode:query_request", [query_id, method, params])
	return true


func pending_query_count() -> int:
	return _pending_queries.size()


func note_editor_play_started() -> void:
	_pending_queries.clear()


func note_editor_play_stopped() -> void:
	_pending_queries.clear()
