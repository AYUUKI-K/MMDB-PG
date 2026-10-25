"""Run a built ZIP from a path with spaces and an unrelated working directory."""
from pathlib import Path
import http.client
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
ARCHIVE = Path(os.environ.get('MMDB_TEST_PACKAGE', ROOT / f'artifacts/mmdb-pg-{VERSION}-universal.zip'))


def request(port, path):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


with tempfile.TemporaryDirectory(prefix='mmdb package smoke ') as scratch:
    base = Path(scratch)
    with zipfile.ZipFile(ARCHIVE) as bundle:
        bundle.extractall(base)
    app = base / 'mmdb-pg'
    # Use the lockfile from the actual package, not the checkout's node_modules.
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    subprocess.run([npm, 'ci', '--offline', '--no-audit', '--no-fund'], cwd=app, check=True)
    subprocess.run(['node', str(app / 'build.mjs')], cwd=base, check=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    config = json.dumps({'port': port, 'apiKey': 'release-smoke-only'})
    (app / 'config.json').write_text(config, encoding='utf-8')
    env = {k: v for k, v in os.environ.items() if k not in ('MMDB_PORT', 'MMDB_API_KEY')}
    for entry in ('launch.mjs', 'server.mjs'):
        with tempfile.TemporaryFile() as log:
            service = subprocess.Popen(['node', str(app / entry), '--background'], cwd=base,
                                       env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 10
                while True:
                    assert service.poll() is None, f'{entry} exited before ready'
                    try:
                        status, body = request(port, '/health')
                        assert status == 200
                        assert json.loads(body)['version'] == 'mmdb-' + VERSION
                        break
                    except (OSError, http.client.HTTPException):
                        assert time.monotonic() < deadline, f'{entry} did not become ready'
                        time.sleep(0.1)
                for path, marker in [('/local-pg.user.js', b'// ==UserScript=='),
                                     ('/local-pg.meta.js', b'// @version'),
                                     ('/preview', b'<!doctype html>')]:
                    status, body = request(port, path)
                    assert status == 200 and marker in body, (entry, path, status)
                assert (app / 'config.json').read_text(encoding='utf-8') == config
                assert not (base / 'config.json').exists()
                assert not (app / 'src/server/config.json').exists()
                print(f'PASS: packaged {entry}, config root and browser assets', flush=True)
            finally:
                service.terminate()
                service.wait(timeout=10)
                log.seek(0)
                print(log.read().decode('utf-8', errors='replace'), flush=True)
    if os.name == 'nt':
        subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                        '-File', str(app / 'MMDB.ps1'), '-Action', 'check'], cwd=base, check=True)
print('PASS: extracted release works independently of the source checkout and caller cwd.')
