import ast
import hashlib
import json
import pathlib
import sys
import types

# Execute only the separately reviewed immutable verification artifact, with mock engine state.
report = json.loads(pathlib.Path(sys.argv[1]).read_text())
source = report['draft']['files'][0]['text']
assert hashlib.sha256(source.encode()).hexdigest() == sys.argv[2]
tree = ast.parse(source)
assert not any(isinstance(node, (ast.Import, ast.ImportFrom)) for node in ast.walk(tree))
assert not any(isinstance(node, ast.Name) and node.id in {'open', 'exec', 'eval', '__import__', 'globals', 'locals'} for node in ast.walk(tree))
code = compile(tree, '<reviewed-renpy-artifact>', 'exec')
config = types.SimpleNamespace(start_callbacks=[])
store = types.SimpleNamespace(coins=0)
scope = {'__builtins__': {'getattr': getattr, 'setattr': setattr, 'isinstance': isinstance, 'int': int, 'float': float, 'bool': bool, 'Exception': Exception}, 'renpy': types.SimpleNamespace(store=store), 'config': config}
exec(code, scope)
assert store.coins == 0 and len(config.start_callbacks) == 1
config.start_callbacks[0]()
assert store.coins == 10
exec(code, scope)
assert store.coins == 10 and len(config.start_callbacks) == 1
store.coins = 0
config.start_callbacks[0]()
assert store.coins == 10
store.coins = 27  # Loading existing store state does not invoke start_callbacks.
assert store.coins == 27
store.coins = True
config.start_callbacks[0]()
assert store.coins is True
store.coins = 2.5
config.start_callbacks[0]()
assert store.coins == 12.5
del store.coins
config.start_callbacks[0]()
assert not hasattr(store, 'coins')
print(json.dumps({'passed': True, 'sourceSha256': sys.argv[2], 'cases': 8, 'engineApiMocks': True, 'gameRuntimeVerified': False}))
