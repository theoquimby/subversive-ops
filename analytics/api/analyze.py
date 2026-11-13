"""Vercel Python Function: POST /api/analyze with the shared secret in `x-analytics-secret`.

GET returns a health check (versions, no data). The app never sends database
credentials here — it gathers the numbers itself and POSTs them as JSON.
"""

import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from subops import VERSION  # noqa: E402
from subops.engine import analyze  # noqa: E402

MAX_BODY = 8 * 1024 * 1024


def _authorized(header: str | None) -> bool:
    secret = os.environ.get("ANALYTICS_SECRET", "")
    return bool(secret) and header is not None and hmac.compare_digest(header.encode(), secret.encode())


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        raw = json.dumps(body, default=float).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        import numpy, pandas, scipy, statsmodels  # noqa: E401

        self._send(200, {"ok": True, "version": VERSION, "python": sys.version.split()[0], "numpy": numpy.__version__, "pandas": pandas.__version__, "scipy": scipy.__version__, "statsmodels": statsmodels.__version__, "secretSet": bool(os.environ.get("ANALYTICS_SECRET"))})

    def do_POST(self):
        if not _authorized(self.headers.get("x-analytics-secret")):
            return self._send(401, {"error": "unauthorized"})
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413 if n > MAX_BODY else 400, {"error": "bad body size"})
        try:
            payload = json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})
        t = time.time()
        out = analyze(payload)
        out["seconds"] = round(time.time() - t, 3)
        self._send(200, out)
