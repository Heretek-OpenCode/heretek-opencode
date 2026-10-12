@tool
extends RefCounted
## Viewport domain handler: 2D/3D runtime capture via the debugger bridge.
## Returns a base64 PNG plus capture timestamp; callers compare the frame
## age against MAIN_LOOP_STALL_MSEC (1000ms) and treat older frames as
## stale fallbacks instead of blocking the pipeline.

const STALL_MSEC := 1000

var _last_png_base64 := ""
var _last_capture_msec := 0


func capture_viewport(params: Dictionary) -> Dictionary:
	var mode := str(params.get("mode", "2d"))
	var width := int(params.get("width", 1280))
	var height := int(params.get("height", 720))
	var viewport := EditorInterface.get_editor_viewport_2d() if mode == "2d" else EditorInterface.get_editor_viewport_3d()
	if viewport == null:
		return _stale_fallback("No editor viewport available", width, height)
	var img := viewport.get_texture().get_image() if viewport.has_method("get_texture") else null
	if img == null:
		return _stale_fallback("Viewport texture unavailable", width, height)
	if img.get_width() != width or img.get_height() != height:
		img.resize(width, height)
	var png := img.save_png_to_buffer()
	if png == null or png.is_empty():
		return _stale_fallback("PNG encode failed", width, height)
	_last_png_base64 = Marshalls.raw_to_base64(png)
	_last_capture_msec = Time.get_ticks_msec()
	return {
		"data": {
			"png_base64": _last_png_base64,
			"width": width,
			"height": height,
			"captured_at_msec": _last_capture_msec,
			"stale": false,
			"mode": mode,
		}
	}


func frame_aabb(params: Dictionary) -> Dictionary:
	var min_v: Vector3 = params.get("min", Vector3.ZERO)
	var max_v: Vector3 = params.get("max", Vector3.ONE)
	var fov_deg := float(params.get("fov_deg", 70.0))
	var padding := float(params.get("padding", 1.2))
	var center := (min_v + max_v) * 0.5
	var size := (max_v - min_v).abs()
	var radius := size.length() * 0.5
	var distance := radius * padding / maxf(tan(deg_to_rad(fov_deg) * 0.5), 0.000001)
	return {
		"data": {
			"center": {"x": center.x, "y": center.y, "z": center.z},
			"distance": distance,
			"camera_pos": {"x": center.x, "y": center.y, "z": center.z + distance},
		}
	}


func capture_status(_params: Dictionary) -> Dictionary:
	var age := Time.get_ticks_msec() - _last_capture_msec
	return {
		"data": {
			"has_frame": not _last_png_base64.is_empty(),
			"age_msec": age,
			"stale": age >= STALL_MSEC or _last_png_base64.is_empty(),
			"stall_msec": STALL_MSEC,
		}
	}


func _stale_fallback(reason: String, width: int, height: int) -> Dictionary:
	var age := Time.get_ticks_msec() - _last_capture_msec
	return {
		"data": {
			"png_base64": _last_png_base64,
			"width": width,
			"height": height,
			"captured_at_msec": _last_capture_msec,
			"stale": true,
			"age_msec": age,
			"reason": reason,
		}
	}
