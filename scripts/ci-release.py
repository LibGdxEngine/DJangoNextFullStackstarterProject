#!/usr/bin/env python3
"""Emit identity only after the reusable CI gate and digest smoke test pass."""
import hashlib
import json
import os
from pathlib import Path
import re

repository = 'LibGdxEngine/DJangoNextFullStackstarterProject'
assert os.environ['GITHUB_REPOSITORY'] == repository
assert re.fullmatch(r'[0-9a-f]{40}', os.environ['GITHUB_SHA'])
images = {}
for service in ('backend', 'frontend'):
    image = os.environ[f'{service.upper()}_IMAGE']
    assert re.fullmatch(
        rf'ghcr.io/libgdxengine/djangonextfullstackstarterproject-{service}@sha256:[0-9a-f]{{64}}',
        image,
    ), 'release images must use the fixed repository and immutable digest'
    images[f'{service}_image'] = image
runtime = Path('deploy/compose.yml').read_bytes() + Path('deploy/gateway.Caddyfile').read_bytes()
manifest = {
    'schema_version': 1,
    'repository': repository,
    'sha': os.environ['GITHUB_SHA'],
    'run_id': int(os.environ['GITHUB_RUN_ID']),
    'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
    **images,
    'runtime_sha256': hashlib.sha256(runtime).hexdigest(),
    'migration_compatible': True,
}
Path('release.json').write_text(json.dumps(manifest, indent=2) + '\n')
