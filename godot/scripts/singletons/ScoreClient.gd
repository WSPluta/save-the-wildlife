extends Node

# Simple HTTP client for the score service.
# Endpoints (from score/rest.http):
# - GET     /api/score
# - GET     /api/score/{uuid}
# - PUT     /api/score/{uuid}  body: { "name": string, "score": number }
# - DELETE  /api/score

signal http_ok(endpoint, payload)
signal http_error(endpoint, message, code)

const _HEADERS = ["Content-Type: application/json"]

func _base() -> String:
	if Engine.has_singleton("Config"):
		return Config.score_base_url.rstrip("/")
	return "http://localhost:8080"

func _emit_ok(ep: String, data) -> void:
	emit_signal("http_ok", ep, data)

func _emit_err(ep: String, msg: String, code: int) -> void:
	emit_signal("http_error", ep, msg, code)

# GET /api/score
func get_all() -> void:
	var url := "%s/api/score" % _base()
	_request_json("GET", url, {}, "GET_ALL")

# GET /api/score/{uuid}
func get_user(uuid: String) -> void:
	var url := "%s/api/score/%s" % [_base(), uuid]
	_request_json("GET", url, {}, "GET_ONE")

# PUT /api/score/{uuid}
func put_user(uuid: String, name: String, score: int) -> void:
	var url := "%s/api/score/%s" % [_base(), uuid]
	var body := {"name": name, "score": score}
	_request_json("PUT", url, body, "PUT_ONE")

# DELETE /api/score
func delete_all() -> void:
	var url := "%s/api/score" % _base()
	_request_json("DELETE", url, {}, "DELETE_ALL")

func _request_json(method: String, url: String, body: Dictionary, tag: String) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result: int, response_code: int, headers: PackedStringArray, body_bytes: PackedByteArray):
		remove_child(http)
		http.queue_free()
		if result != OK:
			_emit_err(tag, "transport_error:%s" % str(result), response_code)
			return
		var txt := body_bytes.get_string_from_utf8()
		var data: Variant = null
		var trimmed: String = txt.strip_edges()
		if trimmed != "":
			var looks_json: bool = trimmed.begins_with("{") or trimmed.begins_with("[") or trimmed.begins_with("\"")
			if looks_json:
				var jp := JSON.new()
				var jerr: int = jp.parse(trimmed)
				if jerr == OK:
					data = jp.get_data()
		if response_code >= 200 and response_code < 300:
			_emit_ok(tag, (data if data != null else trimmed))
		else:
			_emit_err(tag, "http_%s:%s" % [str(response_code), trimmed], response_code)
	)
	var json_body := body if body != null else {}
	var body_str := JSON.stringify(json_body)
	var err: int = OK
	match method:
		"GET":
			err = http.request(url, PackedStringArray(_HEADERS), HTTPClient.METHOD_GET)
		"PUT":
			err = http.request(url, PackedStringArray(_HEADERS), HTTPClient.METHOD_PUT, body_str)
		"DELETE":
			err = http.request(url, PackedStringArray(_HEADERS), HTTPClient.METHOD_DELETE)
		_:
			err = ERR_INVALID_PARAMETER
	if err != OK:
		remove_child(http)
		http.queue_free()
		_emit_err(tag, "request_error:%s" % str(err), 0)
