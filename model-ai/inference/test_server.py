import importlib.util
import json
from pathlib import Path
import unittest


SERVER_PATH = Path(__file__).with_name("server.py")


def load_server():
    spec = importlib.util.spec_from_file_location("stwl_model_ai_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class UpstreamPayloadTests(unittest.TestCase):
    def setUp(self):
        self.server = load_server()
        self.request = {
            "trace_id": "TRACE-123",
            "system": "System prompt",
            "prompt": "Write commentary from evidence.",
            "evidence": {
                "summary": {
                    "player_name": "Ada",
                    "score": 42,
                },
                "citations": ["STWL_GAME_EVENTS:1"],
            },
            "max_tokens": 96,
            "temperature": 0.15,
            "route_context": {
                "primary_provider": "oci-base",
                "candidate_provider": "oci-fine-tuned",
            },
        }

    def test_openai_payload_includes_runtime_evidence_packet(self):
        self.server.UPSTREAM_FORMAT = "openai"

        payload = self.server._upstream_payload(self.request)

        self.assertEqual(payload["model"], self.server.MODEL_ID)
        self.assertEqual(payload["max_tokens"], 96)
        self.assertEqual(payload["temperature"], 0.15)
        self.assertEqual(payload["messages"][0]["content"], "System prompt")
        user_message = payload["messages"][1]["content"]
        self.assertIn("Write commentary from evidence.", user_message)
        self.assertIn("Runtime evidence packet", user_message)
        self.assertIn("STWL_GAME_EVENTS:1", user_message)
        self.assertIn("facts-in-memory-behavior-in-weights", user_message)

        packet = json.loads(user_message.split("\n")[-1])
        self.assertEqual(packet["trace_id"], "TRACE-123")
        self.assertEqual(packet["evidence"]["summary"]["score"], 42)
        self.assertEqual(packet["route_context"]["candidate_provider"], "oci-fine-tuned")

    def test_internal_payload_preserves_paf_contract(self):
        self.server.UPSTREAM_FORMAT = "internal"

        payload = self.server._upstream_payload(self.request)

        self.assertEqual(payload["trace_id"], "TRACE-123")
        self.assertEqual(payload["system"], "System prompt")
        self.assertEqual(payload["prompt"], "Write commentary from evidence.")
        self.assertEqual(payload["evidence"]["summary"]["player_name"], "Ada")
        self.assertEqual(payload["route_context"]["primary_provider"], "oci-base")
        self.assertEqual(payload["max_tokens"], 96)
        self.assertEqual(payload["temperature"], 0.15)

    def test_ollama_payload_uses_native_chat_contract(self):
        self.server.UPSTREAM_FORMAT = "ollama"
        self.server.MODEL_ID = "llama3.1:8b-stwl"

        payload = self.server._upstream_payload(self.request)

        self.assertEqual(payload["model"], "llama3.1:8b-stwl")
        self.assertEqual(payload["stream"], False)
        self.assertEqual(payload["options"]["temperature"], 0.15)
        self.assertEqual(payload["options"]["num_predict"], 96)
        self.assertEqual(payload["messages"][0]["role"], "system")
        user_message = payload["messages"][1]["content"]
        self.assertIn("Runtime evidence packet", user_message)
        self.assertIn("facts-in-memory-behavior-in-weights", user_message)

    def test_extracts_native_ollama_text_and_token_counts(self):
        self.server.UPSTREAM_FORMAT = "ollama"
        payload = {
            "message": {"content": "Ada kept the line grounded."},
            "prompt_eval_count": 12,
            "eval_count": 7,
        }

        self.assertEqual(self.server._extract_upstream_text(payload), "Ada kept the line grounded.")
        self.assertEqual(self.server._usage_tokens(payload, "fallback"), 19)

    def test_shallow_health_does_not_claim_generation_probe(self):
        self.server.UPSTREAM_URL = ""
        self.server.RUNTIME_MODE = "behavior-adapter"

        payload = self.server._health_payload()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["runtime_mode"], "behavior-adapter")
        self.assertNotIn("generation_ready", payload)

    def test_deep_health_requires_configured_upstream(self):
        self.server.UPSTREAM_URL = ""

        payload = self.server._deep_health_payload()

        self.assertTrue(payload["ok"])
        self.assertFalse(payload["generation_ready"])
        self.assertEqual(payload["probe_error"], "upstream_not_configured")

    def test_deep_health_marks_generation_ready_only_after_text(self):
        self.server.UPSTREAM_URL = "http://model.example.test/api/chat"
        original_call = self.server._call_upstream
        try:
            self.server._call_upstream = lambda request, timeout_seconds=None: {
                "message": {"content": "ready"},
                "prompt_eval_count": 4,
                "eval_count": 1,
            }

            payload = self.server._deep_health_payload()
        finally:
            self.server._call_upstream = original_call

        self.assertTrue(payload["generation_ready"])
        self.assertIsNone(payload["probe_error"])
        self.assertGreaterEqual(payload["probe_latency_ms"], 0)


if __name__ == "__main__":
    unittest.main()
