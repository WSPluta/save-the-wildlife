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
REQUIRED_BEARER = os.environ.get("STWL_REQUIRED_BEARER", "")
FACTS_POLICY = os.environ.get("STWL_FACTS_POLICY", "facts-in-memory-behavior-in-weights")
TIMEOUT_SECONDS = float(os.environ.get("STWL_UPSTREAM_TIMEOUT_SECONDS", "7.5"))


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


def _fallback_commentary(request):
    evidence = request.get("evidence") or {}
    summary = (evidence.get("summary") or request.get("route_context", {}).get("summary") or {})
    name = summary.get("player_name") or summary.get("player_id") or "Player"
    score = summary.get("score", 0)
    provider_label = "fine-tuned" if PROVIDER == "oci-fine-tuned" else "base"
    return f"{name} closed on {score} points; {provider_label} behavior stayed grounded in DB evidence."


def _call_upstream(request):
    if not UPSTREAM_URL:
        return None
    prompt = request.get("prompt", "")
    payload = {
        "model": MODEL_ID,
        "messages": [
            {
                "role": "system",
                "content": request.get("system", "Save the Wildlife commentary model."),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "max_tokens": request.get("max_tokens", 120),
        "temperature": request.get("temperature", 0.2),
    }
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
                "facts_policy": FACTS_POLICY,
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
            text = _extract_openai_text(upstream) if upstream else _fallback_commentary(request)
            usage = (upstream or {}).get("usage") or {}
            latency_ms = int((time.time() - started) * 1000)
            _json_response(self, 200, {
                "ok": True,
                "text": text,
                "model_id": MODEL_ID,
                "provider": PROVIDER,
                "tokens": usage.get("total_tokens") or max(1, len(text.split())),
                "latency_ms": latency_ms,
                "finish_reason": "stop",
                "warnings": [] if upstream else ["adapter_fallback_no_upstream"],
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
