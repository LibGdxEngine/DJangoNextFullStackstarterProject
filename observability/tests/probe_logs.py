"""Exercise the running Linux Compose filelog pipeline without touching app services.

Run: python3 observability/tests/probe_logs.py
Creates disposable labeled producers; restarts only the collector to verify offsets.
"""
import json
import subprocess
import time
import urllib.parse
import urllib.request
import uuid


nonce = uuid.uuid4().hex
project = json.loads(subprocess.check_output(["docker", "compose", "config", "--format", "json"]))["name"]
collector = subprocess.check_output(["docker", "compose", "ps", "-q", "otel-collector"], text=True).strip()
loki = subprocess.check_output(["docker", "compose", "ps", "-q", "loki"], text=True).strip()
networks = json.loads(subprocess.check_output(["docker", "inspect", loki]))[0]["NetworkSettings"]["Networks"]
ip = networks[project + "_telemetry-storage"]["IPAddress"]
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
created = []
start = time.time_ns() - 1_000_000_000


def records(service):
    query = '{service_name="' + service + '"}'
    params = urllib.parse.urlencode({"query": query, "start": str(start), "limit": 1000})
    with http.open(f"http://{ip}:3100/loki/api/v1/query_range?{params}", timeout=10) as response:
        data = json.load(response)
    return [value[1] for stream in data["data"]["result"] for value in stream["values"]]


def producer(service, lines, label_project=project):
    name = "mobser-log-probe-" + uuid.uuid4().hex[:12]
    created.append(name)
    args = ["docker", "run", "--name", name, "--log-driver", "json-file",
            "--log-opt", "max-size=10k", "--log-opt", "max-file=3"]
    if label_project is not None:
        args += ["--label", "com.docker.compose.project=" + label_project,
                 "--label", "com.docker.compose.service=" + service,
                 "--log-opt", "labels=com.docker.compose.project,com.docker.compose.service"]
    # Feed through stdin to avoid shell interpolation or argument quoting concerns.
    command = 'while IFS= read -r line; do printf "%s\\n" "$line"; sleep 0.5; done'
    args += ["-i", "caddy:2.11.4-alpine", "sh", "-c", command]
    subprocess.run(args, input="\n".join(lines) + "\n", text=True, stdout=subprocess.DEVNULL, check=True)


try:
    producer("frontend", ["Error: PRIVATE_NEXT_" + nonce, json.dumps({"message": "PRIVATE_JSON_" + nonce})])
    for app_service in ["backend", "celery_worker", "celery_beat"]:
        producer(app_service, ["Exception: PRIVATE_PYTHON_" + nonce, "broker: redis://credential-" + nonce + "@redis:6379/0"])
    producer("foreign-probe", ["FOREIGN_" + nonce], label_project="other-" + nonce)
    producer("unlabeled-probe", ["UNLABELED_" + nonce], label_project=None)
    service = "rotation-probe-" + nonce
    lines = [json.dumps({"message": f"rotation-event-{index}", "padding": "x" * 3500}) for index in range(15)]
    producer(service, lines)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        found = records(service)
        if len(found) == 15:
            break
        time.sleep(2)
    assert len(found) == 15, f"Expected 15 rotated records, got {len(found)}"
    assert len(set(found)) == 15, "Rotation duplicated a record"
    assert not records("foreign-probe"), "Foreign project accepted"
    assert not records("unlabeled-probe"), "Unlabeled record accepted"
    frontend = records("frontend")
    assert any("Next.js runtime log" in record for record in frontend), "Missing safe Next.js fallback"
    assert all(nonce not in record for record in frontend), "Raw Next.js secret exported"
    for app_service in ["backend", "celery_worker", "celery_beat"]:
        app_logs = records(app_service)
        assert any("Python runtime log" in record for record in app_logs), "Missing Python fallback"
        assert all(nonce not in record for record in app_logs), "Raw Python secret exported"
    subprocess.run(["docker", "restart", collector], stdout=subprocess.DEVNULL, check=True)
    time.sleep(10)
    assert len(records(service)) == 15, "Collector restart replayed records despite stored offsets"
    print("PASS: application privacy, Docker project filtering, rotation (15 unique records), persisted offsets")
finally:
    for name in created:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
