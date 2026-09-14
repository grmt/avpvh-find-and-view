#!/usr/bin/env python3
"""Minimal HTTP wrapper around the tesseract CLI binary, for OCR-ing scan
crops on YOUR OWN machine instead of the production server (which doesn't
have the CPU/RAM for a heavier, more accurate OCR model).

The plugin's "Lokale Docker" engine option in the lightbox editor posts
raw image bytes here directly from the browser (no tunnel/VPN needed --
browsers exempt http://localhost from the mixed-content block even on an
https page) and expects back {"text": "..."}.

Swap in a different/heavier OCR engine here if you want better accuracy
than Tesseract; the plugin only cares about this POST /ocr contract, not
what's actually inside the container.
"""
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("LOCAL_OCR_PORT") or 8091)
LANG = os.environ.get("LOCAL_OCR_LANG") or "nld"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _cors_headers(self):
        # Wide open on purpose: this only ever listens on localhost, for
        # one browser tab you're actively using yourself.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"ok": True})
            return
        self._send_json({"error": "not found"}, status=404)

    def do_POST(self):
        if self.path != "/ocr":
            self._send_json({"error": "not found"}, status=404)
            return

        length = int(self.headers.get("Content-Length", 0))
        image_bytes = self.rfile.read(length)
        if not image_bytes:
            self._send_json({"error": "empty body"}, status=400)
            return

        try:
            result = subprocess.run(
                ["tesseract", "-", "-", "-l", LANG],
                input=image_bytes,
                capture_output=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            self._send_json({"error": "OCR timed out"}, status=504)
            return
        except FileNotFoundError:
            self._send_json({"error": "tesseract binary not found"}, status=500)
            return

        if result.returncode != 0:
            self._send_json({"error": result.stderr.decode("utf-8", "replace")}, status=500)
            return

        self._send_json({"text": result.stdout.decode("utf-8", "replace")})


if __name__ == "__main__":
    print(f"Local OCR service listening on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
