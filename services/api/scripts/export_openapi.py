import json
from pathlib import Path

from fintwin.main import app


target = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "openapi.json"
target.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
print(target)
