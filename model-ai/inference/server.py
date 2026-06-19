import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(os.environ.get("PORT", "8080"))
PROVIDER = os.environ.get("STWL_PROVIDER", "oci-base")
MODEL_ID = os.environ.get("STWL_MODEL_ID") or PROVIDER
UPSTREAM_URL = os.environ.get("STWL_UPSTREAM_URL", "")
UPSTREAM_FORMAT = os.environ.get("STWL_UPSTREAM_FORMAT", "openai").strip().lower()
REQUIRED_BEARER = os.environ.get("STWL_REQUIRED_BEARER", "")
FACTS_POLICY = os.environ.get("STWL_FACTS_POLICY", "facts-in-memory-behavior-in-weights")
TIMEOUT_SECONDS = float(os.environ.get("STWL_UPSTREAM_TIMEOUT_SECONDS", "7.5"))
OLLAMA_KEEP_ALIVE = os.environ.get("STWL_OLLAMA_KEEP_ALIVE", "10m")
RUNTIME_MODE = os.environ.get("STWL_ADAPTER_RUNTIME_MODE") or ("upstream-llm" if UPSTREAM_URL else "behavior-adapter")
STRICT_UPSTREAM_WARNINGS = os.environ.get("STWL_STRICT_UPSTREAM_WARNINGS", "true").lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def _extract_openai_text(payload):
    choices = payload.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        return message.get("content") or choices[0].get("text") or ""
    return payload.get("text") or payload.get("output") or payload.get("message") or ""


def _extract_ollama_text(payload):
    message = payload.get("message") or {}
    if isinstance(message, dict) and message.get("content"):
        return message.get("content") or ""
    return payload.get("response") or payload.get("text") or payload.get("output") or ""


def _extract_upstream_text(payload):
    if UPSTREAM_FORMAT in {"ollama", "ollama-chat", "ollama-native"}:
        return _extract_ollama_text(payload)
    return _extract_openai_text(payload)


def _usage_tokens(payload, text):
    usage = payload.get("usage") or {}
    if usage.get("total_tokens") is not None:
        return usage.get("total_tokens")
    ollama_total = payload.get("prompt_eval_count", 0) + payload.get("eval_count", 0)
    if ollama_total:
        return ollama_total
    return max(1, len(text.split()))


def _runtime_evidence_packet(request):
    return {
        "trace_id": request.get("trace_id"),
        "evidence": request.get("evidence") or {},
        "route_context": request.get("route_context") or {},
        "facts_policy": FACTS_POLICY,
    }


def _openai_user_message(request):
    packet = json.dumps(_runtime_evidence_packet(request), sort_keys=True)
    return "\n\n".join([
        request.get("prompt", ""),
        "Runtime evidence packet. Use it for this response only; do not treat changing facts as model knowledge.",
        packet,
    ]).strip()


def _upstream_payload(request):
    if UPSTREAM_FORMAT in {"internal", "paf", "paf-internal"}:
        return {
            "trace_id": request.get("trace_id"),
            "system": request.get("system", "Save the Wildlife commentary model."),
            "prompt": request.get("prompt", ""),
            "evidence": request.get("evidence") or {},
            "max_tokens": request.get("max_tokens", 120),
            "temperature": request.get("temperature", 0.2),
            "route_context": request.get("route_context") or {},
        }
    if UPSTREAM_FORMAT in {"ollama", "ollama-chat", "ollama-native"}:
        return {
            "model": MODEL_ID,
            "messages": [
                {
                    "role": "system",
                    "content": request.get("system", "Save the Wildlife commentary model."),
                },
                {
                    "role": "user",
                    "content": _openai_user_message(request),
                },
            ],
            "stream": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": {
                "temperature": request.get("temperature", 0.2),
                "num_predict": request.get("max_tokens", 120),
            },
        }
    return {
        "model": MODEL_ID,
        "messages": [
            {
                "role": "system",
                "content": request.get("system", "Save the Wildlife commentary model."),
            },
            {
                "role": "user",
                "content": _openai_user_message(request),
            },
        ],
        "max_tokens": request.get("max_tokens", 120),
        "temperature": request.get("temperature", 0.2),
    }


def _fallback_commentary(request):
    evidence = request.get("evidence") or {}
    summary = (evidence.get("summary") or request.get("route_context", {}).get("summary") or {})
    name = summary.get("player_name") or summary.get("player_id") or "Player"
    score = summary.get("score", 0)
    if PROVIDER == "oci-fine-tuned":
        return f"{name} closed on {score} points, citing DB evidence with concise calibrated commentary."
    return f"{name} finished on {score} points with DB evidence in view; the base model stayed cautious."


def _call_upstream(request):
    if not UPSTREAM_URL:
        return None
    payload = _upstream_payload(request)
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    auth = os.environ.get("STWL_UPSTREAM_AUTH_BEARER", "")
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    req = urllib.request.Request(UPSTREAM_URL, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    server_version = "stwl-model-ai-adapter/1.0"

    def do_GET(self):
        if self.path == "/healthz":
            _json_response(self, 200, {
                "ok": True,
                "provider": PROVIDER,
                "model_id": MODEL_ID,
                "upstream_configured": bool(UPSTREAM_URL),
                "upstream_format": UPSTREAM_FORMAT,
                "facts_policy": FACTS_POLICY,
                "runtime_mode": "upstream-llm" if UPSTREAM_URL else RUNTIME_MODE,
                "strict_upstream_warnings": STRICT_UPSTREAM_WARNINGS,
            })
            return
        _json_response(self, 404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if REQUIRED_BEARER:
            expected = f"Bearer {REQUIRED_BEARER}"
            if self.headers.get("Authorization") != expected:
                _json_response(self, 401, {"ok": False, "error": "unauthorized"})
                return
        started = time.time()
        try:
            request = _read_json(self)
            upstream = _call_upstream(request)
            text = _extract_upstream_text(upstream) if upstream else _fallback_commentary(request)
            latency_ms = int((time.time() - started) * 1000)
            runtime_mode = "upstream-llm" if upstream else RUNTIME_MODE
            warnings = []
            if not upstream:
                warnings = ["adapter_fallback_no_upstream"] if STRICT_UPSTREAM_WARNINGS else ["behavior_adapter_mode"]
            _json_response(self, 200, {
                "ok": True,
                "text": text,
                "model_id": MODEL_ID,
                "provider": PROVIDER,
                "tokens": _usage_tokens(upstream or {}, text),
                "latency_ms": latency_ms,
                "finish_reason": "stop",
                "warnings": warnings,
                "runtime_mode": runtime_mode,
                "upstream_configured": bool(UPSTREAM_URL),
                "upstream_format": UPSTREAM_FORMAT,
                "facts_policy": FACTS_POLICY,
            })
        except (urllib.error.URLError, TimeoutError) as exc:
            _json_response(self, 502, {
                "ok": False,
                "provider": PROVIDER,
                "model_id": MODEL_ID,
                "error": f"upstream_error:{exc}",
            })
        except Exception as exc:
            _json_response(self, 500, {
                "ok": False,
                "provider": PROVIDER,
                "model_id": MODEL_ID,
                "error": str(exc),
            })

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
