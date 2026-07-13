#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path

state_root = Path(os.environ.get("CONVEX_STATE_ROOT", "/home/ubuntu/.deploy/motocom/convex-state"))
state_dir = state_root / "local" / "default"
config_path = state_dir / "config.json"

if not config_path.is_file():
    raise SystemExit(f"Missing Convex config: {config_path}")

config = json.loads(config_path.read_text(encoding="utf-8"))
backend_version = config["backendVersion"]
instance_name = config.get("deploymentName") or "anonymous-motocom"
instance_secret = config["instanceSecret"]
ports = config["ports"]

binary = Path.home() / ".cache" / "convex" / "binaries" / backend_version / "convex-local-backend"
if not binary.is_file():
    raise SystemExit(f"Missing Convex backend binary: {binary}")

storage_dir = state_dir / "convex_local_storage"
database_path = state_dir / "convex_local_backend.sqlite3"
storage_dir.mkdir(parents=True, exist_ok=True)

public_origin = os.environ.get("CONVEX_PUBLIC_ORIGIN", "https://moto.aoo.cz/convex")
public_site = os.environ.get("CONVEX_PUBLIC_SITE", f"http://127.0.0.1:{ports['site']}")
sentry_identifier = hashlib.sha256(instance_name.encode("utf-8")).hexdigest()

args = [
    str(binary),
    "--interface", "127.0.0.1",
    "--port", str(ports["cloud"]),
    "--site-proxy-port", str(ports["site"]),
    "--convex-origin", public_origin,
    "--convex-site", public_site,
    "--instance-name", instance_name,
    "--instance-secret", instance_secret,
    "--local-storage", str(storage_dir),
    "--sentry-identifier", sentry_identifier,
    "--redact-logs-to-client",
    "--disable-beacon",
    str(database_path),
]

os.execv(str(binary), args)
