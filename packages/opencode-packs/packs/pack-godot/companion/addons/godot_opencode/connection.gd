@tool
extends Node
## Authenticated WebSocket server for the godot-opencode editor bridge.
##
## Listens loopback-only on port 9500 via TCPServer and upgrades each
## accepted stream with WebSocketPeer. The first frame on every peer must
## be an `auth_hello` proving possession of the per-port loopback
## capability token; anything else fails closed with a generic reason that
## never echoes credential material.
##
## Capability record layout (written by the OpenCode plugin side):
##   <capability_dir>/9500.json  ->  {"http": "<bearer>", "websocket": "<64 hex>"}
## The `websocket` token signs the canonical transcript "nonce:port:role"
## with HMAC-SHA256, role "server" (mirrors the TS handshake module).

const BRIDGE_PORT := 9500
const NONCE_RE := "^[0-9a-fA-F]{32}$"
const PROOF_RE := "^[0-9a-f]{64}$"
const MAX_HANDSHAKE_FRAME_BYTES := 8 * 1024
const CLOSE_CODE_AUTH_FAILED := 4403

## Generic reject reasons. Deliberately coarse: no token, file path, or
## proof excerpt may cross into logs or wire errors.
const REJECT_AUTH_FAILED := "authentication failed"
const REJECT_MALFORMED := "malformed challenge"

var _server := TCPServer.new()
var _ws_capability := ""
var _peers: Array = []
var _authenticated: Dictionary = {}
## request_id -> peer instance id, so dispatcher responses route back to
## the peer that sent the command.
var _request_peers: Dictionary = {}
## Set by plugin.gd. Authenticated command frames are enqueued here and
## executed by dispatcher.tick() under the per-frame budget (ticket 2.2).
var dispatcher = null


func _ready() -> void:
	# NOTE: _ready runs AFTER the parent plugin's _enter_tree (which calls
	# startup()), so this must not force processing off — derive it from the
	# actual listen state instead.
	set_process(_server.is_listening())


## Start listening. `capability_path` points at the 9500.json record.
## Returns OK on listen, ERR_FILE_NOT_FOUND / ERR_FILE_CORRUPT when the
## capability record is missing or malformed (fail closed, no serving).
func startup(capability_path: String) -> int:
	var caps := _read_capability_record(capability_path)
	if caps.is_empty():
		return ERR_FILE_CORRUPT
	_ws_capability = str(caps.get("websocket", ""))
	if not _is_ws_token(_ws_capability):
		_ws_capability = ""
		return ERR_FILE_CORRUPT
	var err: int = _server.listen(BRIDGE_PORT, "127.0.0.1")
	if err != OK:
		return err
	set_process(true)
	return OK


func shutdown() -> void:
	set_process(false)
	for peer in _peers:
		if peer is WebSocketPeer:
			peer.close(1000, "addon unloading")
	_peers.clear()
	_authenticated.clear()
	_ws_capability = ""
	if _server.is_listening():
		_server.stop()


func is_listening() -> bool:
	return _server.is_listening()


func is_peer_authenticated(peer_id: int) -> bool:
	return bool(_authenticated.get(peer_id, false))


func _process(_delta: float) -> void:
	if _server.is_connection_available():
		var stream := _server.take_connection()
		if stream != null:
			_accept_stream(stream)
	_poll_peers()


func _accept_stream(stream: StreamPeerTCP) -> void:
	var peer := WebSocketPeer.new()
	peer.accept_stream(stream)
	_peers.append(peer)


func _poll_peers() -> void:
	var live: Array = []
	for peer in _peers:
		if not (peer is WebSocketPeer):
			continue
		peer.poll()
		var state: int = peer.get_ready_state()
		if state == WebSocketPeer.STATE_CLOSED:
			_authenticated.erase(peer.get_instance_id())
			continue
		if state == WebSocketPeer.STATE_OPEN:
			_drain_peer(peer)
		live.append(peer)
	_peers = live


func _drain_peer(peer: WebSocketPeer) -> void:
	var peer_id := peer.get_instance_id()
	while peer.get_available_packet_count() > 0:
		var raw := peer.get_packet().get_string_from_utf8()
		if not bool(_authenticated.get(peer_id, false)):
			_handle_handshake_frame(peer, peer_id, raw)
		else:
			_forward_command_frame(peer_id, raw)


## First-frame authentication gate. Exactly one shape is accepted:
## {"type": "auth_hello", "nonce": "<32 hex>", "proof": "<64 hex>"}.
## Proof must equal HMAC_SHA256(ws_capability, "nonce:9500:server").
func _handle_handshake_frame(peer: WebSocketPeer, peer_id: int, raw: String) -> void:
	if raw.to_utf8_buffer().size() > MAX_HANDSHAKE_FRAME_BYTES:
		_reject(peer, peer_id, REJECT_MALFORMED)
		return
	var parsed = JSON.parse_string(raw)
	if not _is_hello_shape(parsed):
		_reject(peer, peer_id, REJECT_MALFORMED)
		return
	var nonce := str(parsed["nonce"])
	var proof := str(parsed["proof"]).to_lower()
	var expected := _handshake_proof(_ws_capability, nonce, BRIDGE_PORT)
	if expected.is_empty() or not constant_time_equal(proof, expected):
		_reject(peer, peer_id, REJECT_AUTH_FAILED)
		return
	_authenticated[peer_id] = true
	peer.send_text(JSON.stringify({"type": "handshake_ack", "ok": true}))


func _forward_command_frame(peer_id: int, raw: String) -> void:
	if dispatcher == null:
		return
	var parsed = JSON.parse_string(raw)
	if parsed is Dictionary:
		if parsed.get("request_id") is String:
			_request_peers[str(parsed["request_id"])] = peer_id
		dispatcher.enqueue(parsed)


## Route one dispatcher response to the peer that issued its request_id.
## Returns false when the peer is gone (response dropped, never requeued).
## (Multiline body: Godot 4.7 rejects a same-line suite after the colon here.)
func send_response(response: Dictionary) -> bool:
	var peer := _peer_for_request(str(response.get("request_id", "")))
	if peer == null:
		return false
	if peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	peer.send_text(JSON.stringify(response))
	_request_peers.erase(str(response.get("request_id", "")))
	return true


func _peer_for_request(request_id: String) -> WebSocketPeer:
	var peer_id := int(_request_peers.get(request_id, 0))
	for peer in _peers:
		if peer is WebSocketPeer and peer.get_instance_id() == peer_id:
			return peer
	return null


## Broadcast one event envelope to every authenticated open peer.
## Used by the debugger bridge for out-of-band game traffic.
func send_event(event_name: String, data: Dictionary = {}) -> bool:
	var envelope := {"type": "event", "event": event_name, "data": data}
	var sent := false
	for peer in _peers:
		if not (peer is WebSocketPeer):
			continue
		if peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
			continue
		if not bool(_authenticated.get(peer.get_instance_id(), false)):
			continue
		peer.send_text(JSON.stringify(envelope))
		sent = true
	return sent


func _reject(peer: WebSocketPeer, peer_id: int, reason: String) -> void:
	peer.send_text(JSON.stringify({"type": "handshake_error", "message": reason}))
	peer.close(CLOSE_CODE_AUTH_FAILED, reason)
	_authenticated.erase(peer_id)


static func _is_hello_shape(parsed: Variant) -> bool:
	if not (parsed is Dictionary):
		return false
	if parsed.size() != 3:
		return false
	if str(parsed.get("type", "")) != "auth_hello":
		return false
	var nonce = parsed.get("nonce")
	var proof = parsed.get("proof")
	if not (nonce is String) or not (proof is String):
		return false
	return nonce.match(NONCE_RE) != null and proof.to_lower().match(PROOF_RE) != null


static func _is_ws_token(value: Variant) -> bool:
	if not (value is String):
		return false
	return (value as String).match(PROOF_RE) != null


## HMAC-SHA256 over the canonical transcript "nonce:port:server".
static func _handshake_proof(secret_hex: String, nonce: String, port: int) -> String:
	if not _is_ws_token(secret_hex):
		return ""
	if nonce.match(NONCE_RE) == null:
		return ""
	var transcript := "%s:%d:server" % [nonce.to_lower(), port]
	var context := HMACContext.new()
	if context.start(HashingContext.HASH_SHA256, secret_hex.to_utf8_buffer()) != OK:
		return ""
	if context.update(transcript.to_utf8_buffer()) != OK:
		return ""
	return context.finish().hex_encode()


## Constant-time string comparison: length and every code point fold into
## one accumulator so early-exit timing cannot leak the expected proof.
static func constant_time_equal(left: String, right: String) -> bool:
	var difference := left.length() ^ right.length()
	var length := maxi(left.length(), right.length())
	for index in length:
		var left_code := left.unicode_at(index) if index < left.length() else 0
		var right_code := right.unicode_at(index) if index < right.length() else 0
		difference |= left_code ^ right_code
	return difference == 0


static func _read_capability_record(path: String) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	if file.get_length() > 4096:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	if not (parsed is Dictionary):
		return {}
	if not (parsed.get("websocket") is String):
		return {}
	return {"websocket": str(parsed["websocket"])}


## Cooperative transport servicing during a blocking exclusive run.
##
## The editor main thread is busy (e.g. a test run), so _process cannot
## poll and the client's 20s keepalive would otherwise time the session
## out mid-run. This pass polls every open peer directly: heartbeat frames
## get an immediate pong, valid command frames are REJECTED (never queued,
## never dispatched) with EDITOR_NOT_READY / EDITOR_TEST_RUNNING, and
## anything else is dropped. `run_state` is caller-owned and carries the
## cumulative "packets_serviced" counter; past EXCLUSIVE_RUN_PACKET_CAP the
## peer is closed (bounded rejects, never unbounded stale buffering).
enum ServiceStatus { SERVICED, DISCONNECTED, FLOODED }

const EXCLUSIVE_RUN_PACKET_CAP := 2048
const CLOSE_CODE_EXCLUSIVE_RUN_FLOOD := 1013


func service_transport_during_exclusive_run(run_state: Dictionary) -> int:
	var any_open := false
	for peer in _peers:
		if not (peer is WebSocketPeer):
			continue
		peer.poll()
		if peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
			continue
		any_open = true
		while peer.get_available_packet_count() > 0:
			var count := int(run_state.get("packets_serviced", 0)) + 1
			run_state["packets_serviced"] = count
			if count > EXCLUSIVE_RUN_PACKET_CAP:
				peer.close(CLOSE_CODE_EXCLUSIVE_RUN_FLOOD, "command flood during exclusive run")
				return ServiceStatus.FLOODED
			_service_handle_frame(peer, peer.get_packet().get_string_from_utf8())
	if not any_open:
		return ServiceStatus.DISCONNECTED
	return ServiceStatus.SERVICED


func _service_handle_frame(peer: WebSocketPeer, raw: String) -> void:
	var kind := _classify_service_frame(raw)
	if kind == "heartbeat":
		peer.send_text(JSON.stringify({"type": "pong"}))
	elif kind == "command":
		var parsed: Dictionary = JSON.parse_string(raw)
		peer.send_text(JSON.stringify(_build_busy_reject(parsed)))
	# "other" frames are dropped without dispatch.


static func _classify_service_frame(raw: String) -> String:
	var parsed = JSON.parse_string(raw)
	if not (parsed is Dictionary):
		return "other"
	if str(parsed.get("type", "")) == "ping":
		return "heartbeat"
	if str(parsed.get("method", "")) == "ping":
		return "heartbeat"
	if parsed.get("command") is String and parsed.get("request_id") is String:
		return "command"
	return "other"


## Busy-reject envelope. The top-level code stays EDITOR_NOT_READY; the
## EDITOR_TEST_RUNNING sub-code travels under error.data and is never
## promoted into code.
static func _build_busy_reject(parsed: Dictionary) -> Dictionary:
	return {
		"request_id": str(parsed.get("request_id", "")),
		"status": "error",
		"error": {
			"code": "EDITOR_NOT_READY",
			"message": "Rejected during exclusive run: %s was not executed. Retry when the run completes." % str(parsed.get("command", "")),
			"data": {"sub_code": "EDITOR_TEST_RUNNING", "retryable": true},
		},
	}
