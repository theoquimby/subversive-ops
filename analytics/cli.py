"""Local runner: JSON payload on stdin → results JSON on stdout (used by the app in development)."""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from subops.engine import analyze  # noqa: E402

if __name__ == "__main__":
    payload = json.load(sys.stdin)
    json.dump(analyze(payload), sys.stdout, default=float)
