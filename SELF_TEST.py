from pathlib import Path
import importlib.util
import urllib.request

ROOT = Path(__file__).resolve().parent

assert (ROOT / 'app' / 'index.html').exists(), 'Missing index.html'
assert (ROOT / 'app' / 'app.js').exists(), 'Missing app.js'
assert (ROOT / 'app' / 'style.css').exists(), 'Missing style.css'

spec = importlib.util.spec_from_file_location('fretsense_windows', ROOT / 'fretsense_windows.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
server, url = module.start_server()
try:
    with urllib.request.urlopen(url, timeout=5) as response:
        body = response.read().decode('utf-8', 'ignore')
        assert response.status == 200
        assert 'FretSense' in body
finally:
    server.shutdown()
    server.server_close()

print('FretSense Windows self-test: PASS')
