#!/usr/bin/env python3
"""Verify real Next.js → Django → Celery traces using disposable Docker containers.

Run after docker compose build/up. No routes or volumes in running apps are changed.
The smoke request executes only apps.common.tasks.ping. All test containers are removed.
"""
import json
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
containers = []
def run(*args, **kwargs):
    return subprocess.check_output(['docker', *args], text=True, cwd=ROOT, **kwargs).strip()
def inspect(name):
    return json.loads(run('inspect', name))[0]
def address(name, network):
    return inspect(name)['NetworkSettings']['Networks'][network]['IPAddress']

backend = run('compose', 'ps', '-q', 'backend')
frontend = run('compose', 'ps', '-q', 'frontend')
prometheus = run('compose', 'ps', '-q', 'prometheus')
project = inspect(backend)['Config']['Labels']['com.docker.compose.project']
default_network = f'{project}_default'
ingest_network = f'{project}_telemetry-ingest'
storage_network = f'{project}_telemetry-storage'
suffix = uuid.uuid4().hex[:8]
backend_name = f'mobser-smoke-backend-{suffix}'
frontend_name = f'mobser-smoke-frontend-{suffix}'
collector = address(run('compose', 'ps', '-q', 'otel-collector'), ingest_network)
tempo = address(run('compose', 'ps', '-q', 'tempo'), storage_network)
with tempfile.TemporaryDirectory(prefix='mobser-chain-') as tmp:
    files = Path(tmp)
    env = dict(item.split('=', 1) for item in inspect(backend)['Config']['Env'] if '=' in item)
    env.update(OTEL_SERVICE_NAME='mobser-backend', OTEL_TRACES_SAMPLER_ARG='1', OTEL_ENABLED='true', OTEL_EXPORTER_OTLP_ENDPOINT=f'http://{collector}:4318')
    env_file = files / 'backend.env'
    env_file.write_text('\n'.join(f'{key}={value}' for key,value in env.items())+'\n')
    env_file.chmod(0o600)
    backend_file = files / 'backend.py'
    backend_file.write_text('''import sys, types, logging
from core.wsgi import application
from django.conf import settings
from django.http import JsonResponse
from django.urls import path
from apps.common.tasks import ping
from opentelemetry import trace
from wsgiref.simple_server import make_server

def smoke(request):
    task = ping.delay()
    result = task.get(timeout=25)
    logging.getLogger('apps.common.smoke').info('Observability smoke task completed')
    return JsonResponse({'result':result,'task_id':task.id,'request_id':request.request_id,'trace_id':format(trace.get_current_span().get_span_context().trace_id,'032x')})
module = types.ModuleType('otel_smoke_urls')
module.urlpatterns = [path('api/smoke/', smoke)]
sys.modules[module.__name__] = module
settings.ROOT_URLCONF = module.__name__
settings.ALLOWED_HOSTS = ['*']
make_server('0.0.0.0',8000,application).serve_forever()
''')
    route = files / 'route.ts'
    route.write_text('''import { createServerApiClient } from "@/lib/api/server";
export async function GET() {
  const result = await createServerApiClient().get('/smoke/?secret=SENTINEL_CHAIN_SECRET');
  return Response.json(result);
}
''')
    try:
        run('create','--name',backend_name,'--network',default_network,'--env-file',str(env_file),'--env','PYTHONPATH=/app','--entrypoint','python',inspect(backend)['Config']['Image'],'/tmp/otel-smoke.py')
        containers.append(backend_name)
        run('network','connect',ingest_network,backend_name)
        run('cp',str(backend_file),f'{backend_name}:/tmp/otel-smoke.py')
        run('cp',str(ROOT/'backend/core'),f'{backend_name}:/app/')
        run('start',backend_name)
        backend_ip = address(backend_name,default_network)
        for _ in range(30):
            try:
                run('exec',backend_name,'python','-c',"import socket; socket.create_connection(('127.0.0.1',8000),timeout=1).close()",stderr=subprocess.DEVNULL)
                break
            except subprocess.CalledProcessError:
                time.sleep(1)
        else:
            raise RuntimeError('Backend did not start: '+run('logs','--tail','12',backend_name))
        frontend_env = dict(OTEL_ENABLED='true',OTEL_SERVICE_NAME='mobser-frontend',OTEL_TRACES_SAMPLER_ARG='1',OTEL_EXPORTER_OTLP_ENDPOINT=f'http://{collector}:4318',OTEL_RESOURCE_ATTRIBUTES='deployment.environment.name=development',BACKEND_API_URL=f'http://{backend_ip}:8000/api',NEXT_TELEMETRY_DISABLED='1')
        args=[]
        for key,value in frontend_env.items(): args.extend(['--env',f'{key}={value}'])
        run('create','--name',frontend_name,'--network',default_network,*args,inspect(frontend)['Config']['Image'],'npx','next','dev','--hostname','0.0.0.0')
        containers.append(frontend_name)
        run('network','connect',ingest_network,frontend_name)
        run('cp',str(ROOT/'frontend/src'),f'{frontend_name}:/app/')
        # Prepare a route exclusively in the stopped disposable container.
        staging = files/'otel-smoke'; staging.mkdir(); (staging/'route.ts').write_text(route.read_text())
        run('cp',str(staging),f'{frontend_name}:/app/src/app/')
        run('start',frontend_name)
        for _ in range(45):
            try:
                run('exec',frontend_name,'node','-e',"require('node:net').connect(3000,'127.0.0.1').on('connect',function(){this.end()}).on('error',()=>process.exit(1))",stderr=subprocess.DEVNULL)
                break
            except subprocess.CalledProcessError: time.sleep(1)
        else: raise RuntimeError('Frontend did not start: '+run('logs','--tail','12',frontend_name))
        trace_id=uuid.uuid4().hex; request_id=str(uuid.uuid4()); parent=uuid.uuid4().hex[:16]
        probe=f"fetch('http://127.0.0.1:3000/otel-smoke',{{headers:{{traceparent:'00-{trace_id}-{parent}-01','x-request-id':'{request_id}'}}}}).then(async r=>{{if(!r.ok)throw new Error(await r.text());console.log(await r.text())}}).catch(e=>{{console.error(e);process.exit(1)}})"
        result=json.loads(run('exec',frontend_name,'node','-e',probe))
        assert result['result']=='pong' and result['trace_id']==trace_id and result['request_id']==request_id,result
        for _ in range(30):
            try:
                trace_payload=run('exec',prometheus,'wget','-qO-',f'http://{tempo}:3200/api/traces/{trace_id}',stderr=subprocess.DEVNULL)
                trace_data=json.loads(trace_payload)
                services={a['value'].get('stringValue') for batch in trace_data.get('batches',[]) for a in batch.get('resource',{}).get('attributes',[]) if a['key']=='service.name'}
                if {'mobser-frontend','mobser-backend','mobser-worker'} <= services: break
            except (subprocess.CalledProcessError,json.JSONDecodeError): pass
            time.sleep(2)
        else: raise RuntimeError('Missing full trace services: '+str(services))
        assert 'SENTINEL_CHAIN_SECRET' not in trace_payload
        span_services = {}
        edges = []
        for batch in trace_data['batches']:
            service = next(a['value']['stringValue'] for a in batch['resource']['attributes'] if a['key'] == 'service.name')
            for group in batch.get('scopeSpans', batch.get('instrumentationLibrarySpans', [])):
                for span in group['spans']:
                    span_services[span['spanId']] = service
                    edges.append((span.get('parentSpanId'), service))
        assert any(span_services.get(parent) == 'mobser-frontend' and child == 'mobser-backend' for parent, child in edges)
        assert any(span_services.get(parent) == 'mobser-backend' and child == 'mobser-worker' for parent, child in edges)
        print(json.dumps({'status':'passed','trace_id':trace_id,'request_id':request_id,'task_id':result['task_id'],'services':sorted(services),'sentinel_exported':False}),flush=True)
    finally:
        for name in reversed(containers): run('rm','--force',name)
