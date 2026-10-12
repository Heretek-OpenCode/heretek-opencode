@tool
extends RefCounted
## Main-thread frame budgeter and command dispatcher.
##
## The connection drains inbound packets into this queue; `tick()` executes
## them FIFO inside a per-frame millisecond budget so one burst can never
## stall the editor. Packets beyond PACKET_DRAIN_CAP_PER_TICK stay queued
## for later ticks; the cumulative spill counter makes floods observable.

const PACKET_DRAIN_CAP_PER_TICK := 32
const DEFAULT_BUDGET_MS := 4.0

var _command_queue: Array[Dictionary] = []
var _handlers: Dictionary = {}
var _spillover_total := 0


## Register a command handler. Callable receives (params: Dictionary).
func register(command_name: String, handler: Callable) -> void:
	_handlers[command_name] = handler


func unregister(command_name: String) -> void:
	_handlers.erase(command_name)


func has_command(command_name: String) -> bool:
	return _handlers.has(command_name)


## Enqueue one decoded command frame. Never blocks, never drops: overflow
## is handled at drain time by the per-tick cap (queue excess, FIFO).
func enqueue(cmd: Dictionary) -> void:
	_command_queue.append(cmd)


func queue_size() -> int:
	return _command_queue.size()


func spillover_total() -> int:
	return _spillover_total


func clear_queue() -> void:
	_command_queue.clear()


## Execute queued commands within `budget_ms`. Returns response dicts for
## the commands actually executed this tick; unexecuted commands keep
## their exact queue positions for the next tick (deterministic order).
func tick(budget_ms: float = DEFAULT_BUDGET_MS) -> Array[Dictionary]:
	var responses: Array[Dictionary] = []
	var start_msec := Time.get_ticks_msec()
	var executed := 0
	while (
		not _command_queue.is_empty()
		and executed < PACKET_DRAIN_CAP_PER_TICK
		and float(Time.get_ticks_msec() - start_msec) < budget_ms
	):
		var cmd: Dictionary = _command_queue[0]
		_command_queue.remove_at(0)
		responses.append(_dispatch(cmd))
		executed += 1
	if executed >= PACKET_DRAIN_CAP_PER_TICK and not _command_queue.is_empty():
		_spillover_total += _command_queue.size()
	return responses


## Direct synchronous dispatch (used by batch and tests). No budget.
func dispatch_direct(command: String, params: Dictionary) -> Dictionary:
	if not has_command(command):
		return {"status": "error", "error": {"code": "UNKNOWN_COMMAND", "message": "Unknown command: %s" % command}}
	return _call_handler(command, params)


func _dispatch(cmd: Dictionary) -> Dictionary:
	var request_id := str(cmd.get("request_id", ""))
	var command := str(cmd.get("command", ""))
	var params: Dictionary = cmd.get("params", {})
	var result: Dictionary
	if has_command(command):
		result = _call_handler(command, params)
	else:
		result = {"error": {"code": "UNKNOWN_COMMAND", "message": "Unknown command: %s" % command}}
	result["request_id"] = request_id
	if not result.has("status"):
		result["status"] = "error" if result.has("error") else "ok"
	return result


func _call_handler(command: String, params: Dictionary) -> Dictionary:
	var outcome: Variant = _handlers[command].call(params)
	if outcome == null or not (outcome is Dictionary):
		return {"error": {"code": "INTERNAL_ERROR", "message": "Handler '%s' returned malformed result" % command}}
	var result: Dictionary = outcome
	if not (result.has("data") or result.has("error")):
		return {"error": {"code": "INTERNAL_ERROR", "message": "Handler '%s' returned malformed result" % command}}
	return result
