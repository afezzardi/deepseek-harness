"""Prove lowercase SSE headers deliver bytes before upstream completion."""
import http.client
import http.server
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest


class StreamingHeaders(unittest.TestCase):
    def test_lowercase_content_type_preserves_streaming(self):
        spec = importlib.util.spec_from_file_location('recording_proxy_test', Path(__file__).resolve().parents[3]/'recproxy.py')
        proxy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(proxy)
        release = threading.Event()
        upstream_done = threading.Event()
        recorded = threading.Event()
        payload = b'data: first\n\ndata: [DONE]\n\n'

        class Upstream(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header('content-type', 'text/event-stream')
                self.end_headers()
                self.wfile.write(payload[:1])
                self.wfile.flush()
                release.wait(5)
                self.wfile.write(payload[1:])
                self.wfile.flush()
                upstream_done.set()

        class Recording(proxy.H):
            def _log(self, record):
                super()._log(record)
                if record['event'] == 'released':
                    recorded.set()

        with tempfile.TemporaryDirectory() as directory:
            proxy.LOG = str(Path(directory)/'requests.jsonl')
            upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            proxy.UPSTREAM = f'http://127.0.0.1:{upstream.server_port}'
            server = proxy.S(('127.0.0.1', 0), Recording)
            threads = [threading.Thread(target=s.serve_forever) for s in [upstream, server]]
            for thread in threads:
                thread.start()
            client = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                client.request('GET', '/')
                response = client.getresponse()
                first = response.read(1)
                self.assertEqual(first, b'd')
                self.assertFalse(upstream_done.is_set())
                release.set()
                self.assertEqual(first+response.read(), payload)
                self.assertTrue(recorded.wait(5))
            finally:
                release.set()
                client.close()
                for service in [server, upstream]:
                    service.shutdown()
                    service.server_close()
                for thread in threads:
                    thread.join(5)
                    self.assertFalse(thread.is_alive())
            records = [json.loads(line) for line in Path(proxy.LOG).read_text().splitlines()]
            result = next(row for row in records if row['event'] == 'response')
            self.assertTrue(result['sse'])
            self.assertEqual(result['response_head'], payload.decode())
            self.assertGreaterEqual(result['first_byte_seconds'], 0)
            self.assertEqual(len([row for row in records if row['event'] == 'released']), 1)


if __name__ == '__main__':
    unittest.main()
