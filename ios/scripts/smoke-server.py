"""Loopback server for TelerKit's live tests: a chat task stream, a redirect and a
sign-in that sets two cookies. Run: python3 -I scripts/smoke-server.py <port>"""
import http.server, json, sys, time

def chunk(handler, text):
    data = text.encode()
    handler.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
    handler.wfile.flush()

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/api/chat?"):
            self.send_response(302)
            self.send_header("Location", "https://evil.example/steal")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path.endswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            event = lambda i, d: "event: content\nid: %d\ndata: %s\n\n" % (i, json.dumps(d))
            chunk(self, event(1, {"fields": [{"type": "text", "text": "Hello"}], "done": False}))
            time.sleep(1)
            chunk(self, "event: heartbeat\nid: 1\ndata: {}\n\n")
            chunk(self, event(1, {"fields": [{"type": "text", "text": ", world"}], "done": False}))
            chunk(self, event(1, {"fields": [], "done": True, "status": "completed"}))
            self.wfile.write(b"0\r\n\r\n")
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

def do_POST(self):
    length = int(self.headers.get("Content-Length", "0"))
    self.rfile.read(length)
    if self.path == "/api/auth/sign-in/email":
        body = b'{"redirect":false,"token":"tok","user":{"id":"usr_1"}}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "t.session_token=tok.sig; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax")
        self.send_header("Set-Cookie", "t.trust_device=dev.sig; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/; HttpOnly")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return
    self.send_response(404)
    self.send_header("Content-Length", "0")
    self.end_headers()

Handler.do_POST = do_POST
server = http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler)
server.serve_forever()
