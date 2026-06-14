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


if __name__ == "__main__":
    unittest.main()
