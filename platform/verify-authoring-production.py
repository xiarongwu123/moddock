import json
import pathlib
import urllib.error
import urllib.request

root = pathlib.Path('/home/xrw/moddock-studio')
config = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
origin = 'http://' + config['MODDOCK_STUDIO_HOST'] + ':' + config['MODDOCK_STUDIO_PORT']
payload = {'harness': 'pi-agent', 'prompt': '为已识别的 Unity Mono 游戏制定一个探索机制 Mod 的开发方案。当前只提供开发方案，需核对游戏专用 API 后才能实现，请勿编造接口或宣称已经制作安装。',
           'types': [{'id': 'project-plan', 'available': True}], 'capability': {'creativeDefaultsDelegated': True},
           'context': {'game': {'name': 'Unity Mono deployment verification'}},
           'diagnostic': {'engine': {'key': 'unity-mono', 'name': 'Unity Mono'}, 'loaders': ['BepInEx']}}
request = urllib.request.Request(origin + '/plan', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + config['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'pi-production-verification', 'Accept': 'application/x-ndjson', 'Content-Type': 'application/json'})
events = []
result = None
with urllib.request.urlopen(request, timeout=310) as response:
    assert response.headers.get_content_type() == 'application/x-ndjson'
    for line in response:
        frame = json.loads(line)
        if frame['type'] == 'event': events.append(frame['event'])
        elif frame['type'] == 'result': result = frame['result']
        elif frame['type'] == 'error': raise RuntimeError(frame.get('code', 'Pi production error'))
assert result and result.get('kind') == 'project-plan' and isinstance(result.get('steps'), list)
assert any(event['type'] == 'thinking_delta' and event.get('delta') for event in events)
assert any(event['type'] == 'skill_loaded' and 'bepinex-mono' in event.get('path', '') for event in events)
assert any(event['type'] == 'tool_end' and event.get('name') == 'submit_result' and not event.get('failed') for event in events)
public = {}
for route, expected in [('/api/health', 200), ('/api/v1/plans', 200), ('/api/v1/nexus/status', 401), ('/api/v1/studio/plan', 401)]:
    request = urllib.request.Request('https://mu-api.claude-api.cn' + route, data=b'{}' if route.endswith('/plan') else None, headers={'Content-Type': 'application/json', 'User-Agent': ''})
    try: response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error: response = error
    assert response.status == expected, route + ': ' + str(response.status)
    public[route] = response.status
    data = response.read()
    if route == '/api/v1/plans':
        plans = json.loads(data)
        assert plans['paymentsEnabled'] and plans['paymentMethod'] == 'manual'
report = {'productionRelease': str((root / 'current').readlink()), 'productionPiVerified': True, 'realModelUsed': True, 'bepinexSkillLoaded': True, 'thinkingStreamed': True,
          'toolNames': sorted(set(event['name'] for event in events if event.get('name') and event['type'] == 'tool_end')),
          'publicRoutes': public, 'productionAccountsOrOrdersCreated': False, 'gameRuntimeVerified': False}
file = root / 'authoring-production-check-20261016.json'
file.write_text(json.dumps(report, indent=2)); file.chmod(0o600)
print(json.dumps(report), flush=True)
