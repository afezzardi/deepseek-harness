#!/usr/bin/env python3
"""Recording reverse proxy: logs each request body to JSONL, forwards upstream.

SSE responses stream through with chunked framing so the client's streaming path
is exercised; every other response is buffered and sent with a Content-Length.
"""
import http.server, json, os, socketserver, threading, urllib.error, urllib.request

UPSTREAM = os.environ.get("UPSTREAM", "http://100.108.76.12:4000")
LOG = os.environ.get("RECLOG", "/tmp/recproxy.jsonl")
PORT = int(os.environ.get("RECPORT", "4100"))
HOP = ("content-length", "transfer-encoding", "connection", "content-encoding")
lock = threading.Lock()


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _log(self, rec):
        with lock, open(LOG, "a") as f:
            f.write(json.dumps(rec) + "\n")

    def _proxy(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        rec = {"path": self.path, "method": method}
        try:
            rec["body"] = json.loads(raw)
        except Exception:
            if raw:
                rec["body_raw"] = raw[:2000].decode("utf-8", "replace")

        hdrs = {k: v for k, v in self.headers.items() if k.lower() not in ("host",) + HOP}
        req = urllib.request.Request(UPSTREAM + self.path, data=raw or None, headers=hdrs, method=method)
        try:
            r = urllib.request.urlopen(req, timeout=3000)
        except urllib.error.HTTPError as e:
            r = e
        except Exception as e:
            body = json.dumps({"error": {"message": f"recproxy: {e}"}}).encode()
            rec.update(status=502, response_bytes=len(body), response_head=body.decode())
            self._log(rec)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        status = getattr(r, "status", None) or r.code
        rhdrs = dict(r.headers)
        is_sse = "text/event-stream" in (rhdrs.get("Content-Type") or "")
        collected = bytearray()

        if is_sse:
            self.send_response(status)
            for k, v in rhdrs.items():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                while True:
                    chunk = r.read(4096)
                    if not chunk:
                        break
                    collected.extend(chunk)
                    self.wfile.write(b"%X\r\n" % len(chunk) + chunk + b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except Exception as e:
                rec["proxy_write_error"] = str(e)
        else:
            collected.extend(r.read())
            self.send_response(status)
            for k, v in rhdrs.items():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(collected)))
            self.end_headers()
            self.wfile.write(bytes(collected))

        rec.update(status=status, sse=is_sse, response_bytes=len(collected),
                   response_head=bytes(collected[:6000]).decode("utf-8", "replace"))
        self._log(rec)

    def do_POST(self):
        self._proxy("POST")

    def do_GET(self):
        self._proxy("GET")


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


print(f"recproxy :{PORT} -> {UPSTREAM}, log={LOG}", flush=True)
S(("127.0.0.1", PORT), H).serve_forever()
