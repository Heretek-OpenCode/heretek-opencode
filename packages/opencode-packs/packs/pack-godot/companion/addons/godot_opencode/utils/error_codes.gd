@tool
extends Node
## Shared protocol error codes for the godot-opencode companion addon.
## The top-level `code` vocabulary is frozen; readiness sub-codes travel
## under `error.data.sub_code` and are never promoted into `code`.

const EDITOR_NOT_READY := "EDITOR_NOT_READY"
const INVALID_PARAMS := "INVALID_PARAMS"
const UNKNOWN_COMMAND := "UNKNOWN_COMMAND"
const NODE_NOT_FOUND := "NODE_NOT_FOUND"
const RESOURCE_NOT_FOUND := "RESOURCE_NOT_FOUND"
const WRONG_TYPE := "WRONG_TYPE"
const MISSING_REQUIRED_PARAM := "MISSING_REQUIRED_PARAM"
const VALUE_OUT_OF_RANGE := "VALUE_OUT_OF_RANGE"
const INTERNAL_ERROR := "INTERNAL_ERROR"

## Readiness sub-codes (live under error.data.sub_code only).
const SUB_EDITOR_TEST_RUNNING := "EDITOR_TEST_RUNNING"
const SUB_EDITOR_IMPORTING := "EDITOR_IMPORTING"
const SUB_EDITOR_PLAYING := "EDITOR_PLAYING"
const SUB_EDITOR_NO_SCENE := "EDITOR_NO_SCENE"


static func make(code: String, message: String, data: Dictionary = {}) -> Dictionary:
	return {
		"status": "error",
		"error": {
			"code": code,
			"message": message,
			"data": data,
		},
	}


static func make_not_ready(sub_code: String, message: String, retryable: bool = true) -> Dictionary:
	return make(
		EDITOR_NOT_READY,
		message,
		{"sub_code": sub_code, "retryable": retryable}
	)
