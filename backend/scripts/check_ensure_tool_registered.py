import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings

key = get_settings().api_key
req = urllib.request.Request(
    "http://localhost:8100/api/v1/config/",
    headers={"X-API-Key": key},
)
with urllib.request.urlopen(req, timeout=10) as resp:
    data = json.load(resp)

tools = data.get("tools_registered") or data.get("tools") or []
if tools and isinstance(tools[0], dict):
    names = [t.get("name") for t in tools]
else:
    names = list(tools)
print("ensure_missions registered:", "ensure_missions" in names)
print("related:", [n for n in names if n and ("mission" in n or "ensure" in n or "stats" in n)])
