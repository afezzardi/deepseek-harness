#!/usr/bin/env python3
"""Recording reverse proxy: logs each request body to JSONL, forwards upstream.

SSE responses stream through with chunked framing so the client's streaming path
is exercised; every other response is buffered and sent with a Content-Length.
"""
import hashlib, http.server, json, os, socketserver, threading, time, urllib.error, urllib.request, uuid

UPSTREAM = os.environ.get("UPSTREAM", "http://100.108.76.12:4000")
LOG = os.environ.get("RECLOG", "/tmp/recproxy.jsonl")
PORT = int(os.environ.get("RECPORT", "4100"))
HOP = ("content-length", "transfer-encoding", "connection", "content-encoding")
lock = threading.Lock()
capacity = threading.BoundedSemaphore(int(os.environ.get("REC_CONCURRENCY", "4")))
active = 0
waiting = 0


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _log(self, rec):
        with lock, open(LOG, "a") as f:
            f.write(json.dumps(rec) + "\n")

    def _proxy(self, method):
        global active, waiting
        arrived = time.time()
        request_id = uuid.uuid4().hex
        with lock:
            waiting += 1
        capacity.acquire()
        admitted = time.time()
        with lock:
            waiting -= 1
            active += 1
            counts = {"active": active, "waiting": waiting}
        self.observation = dict(request_id=request_id, arrived=arrived, admitted=admitted,
                                queue_seconds=admitted-arrived, **counts)
        self._log(dict(event="admitted", **self.observation))
        try:
            self._forward(method)
        finally:
            with lock:
                active -= 1
            capacity.release()
            self._log(dict(event="released", request_id=request_id, ended=time.time()))

    def _forward(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        rec = {"path": self.path, "method": method, **self.observation, "event": "response", "request_sha256": hashlib.sha256(raw).hexdigest()}
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
            rec.update(status=502, ended=time.time(), response_bytes=len(body), response_head=body.decode())
            self._log(rec)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        status = getattr(r, "status", None) or r.code
        rhdrs = dict(r.headers)
        is_sse = "text/event-stream" in (r.headers.get("Content-Type") or "").lower()
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
                    chunk = r.read1(4096)
                    if not chunk:
                        break
                    if not collected:
                        rec["first_byte_seconds"] = time.time() - rec["admitted"]
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

        r.close()
        rec.update(status=status, sse=is_sse, ended=time.time(), response_bytes=len(collected),
                   response_head=bytes(collected[:int(os.environ.get("REC_RESPONSE_BYTES", "6000"))]).decode("utf-8", "replace"))
        self._log(rec)

    def do_POST(self):
        self._proxy("POST")

    def do_GET(self):
        self._proxy("GET")


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"recproxy :{PORT} -> {UPSTREAM}, log={LOG}", flush=True)
    S(("127.0.0.1", PORT), H).serve_forever()
