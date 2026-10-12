@tool
extends RefCounted
## Shader domain handler: spatial / canvas-item generation with uniform
## injection. Runtime compilation stays engine-side; this handler validates
## shader_type headers and merges uniform declarations idempotently.

const VALID_TYPES := ["spatial", "canvas_item", "particles", "sky", "fog"]


func generate_shader(params: Dictionary) -> Dictionary:
	var mode := str(params.get("mode", "spatial"))
	if not mode in VALID_TYPES:
		return {"error": {"code": "INVALID_PARAMS", "message": "Unknown shader_type: %s" % mode}}
	var uniforms: Array = params.get("uniforms", [])
	var lines: Array[String] = ["shader_type %s;" % mode]
	for entry in uniforms:
		var decl := _uniform_decl(entry)
		if decl.is_empty():
			return {"error": {"code": "INVALID_PARAMS", "message": "Uniform needs name + type"}}
		lines.append(decl)
	var body := str(params.get("body", ""))
	if body.is_empty():
		body = "void fragment() {\n\tALBEDO = vec3(1.0);\n}" if mode == "spatial" else "void fragment() {\n\tCOLOR = vec4(1.0);\n}"
	lines.append(body)
	return {"data": {"source": "\n".join(lines) + "\n", "mode": mode}}


func inject_uniform(params: Dictionary) -> Dictionary:
	var source := str(params.get("source", ""))
	if not source.contains("shader_type"):
		return {"error": {"code": "INVALID_PARAMS", "message": "Source has no shader_type header"}}
	var entry: Dictionary = params.get("uniform", {})
	var decl := _uniform_decl(entry)
	if decl.is_empty():
		return {"error": {"code": "INVALID_PARAMS", "message": "Uniform needs name + type"}}
	var uname := str(entry.get("name", ""))
	var pattern := RegEx.new()
	pattern.compile("^\\s*uniform\\s+\\S+\\s+" + uname + "\\b")
	var out: Array[String] = []
	for line in source.split("\n"):
		if pattern.search(line) != null:
			continue
		out.append(line)
		if line.contains("shader_type"):
			out.append(decl)
	return {"data": {"source": "\n".join(out)}}


func list_uniforms(params: Dictionary) -> Dictionary:
	var source := str(params.get("source", ""))
	var found: Array = []
	for line in source.split("\n"):
		var stripped := line.strip_edges()
		if not stripped.begins_with("uniform "):
			continue
		var rest := stripped.trim_prefix("uniform ").strip_edges()
		var parts := rest.split(" ", false)
		if parts.size() >= 2:
			found.append({"type": parts[0], "name": parts[1].trim_suffix(";").split(":")[0].split("=")[0].strip_edges()})
	return {"data": {"uniforms": found}}


func _uniform_decl(entry: Variant) -> String:
	if not (entry is Dictionary):
		return ""
	var d: Dictionary = entry
	var uname := str(d.get("name", ""))
	var utype := str(d.get("type", ""))
	if uname.is_empty() or utype.is_empty():
		return ""
	var decl := "uniform %s %s" % [utype, uname]
	if not str(d.get("hint", "")).is_empty():
		decl += " : %s" % str(d.get("hint", ""))
	if not str(d.get("default", "")).is_empty():
		decl += " = %s" % str(d.get("default", ""))
	return decl + ";"
