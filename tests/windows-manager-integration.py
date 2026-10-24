"""Windows-only lifecycle check with an isolated local stub; never calls Google."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
assert os.name == 'nt'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
launch = '''import fs from 'node:fs'; import http from 'node:http';
const server=http.createServer((q,r)=>r.end('{}'));
server.listen(Number(process.env.MMDB_PORT),'127.0.0.1',()=>{
fs.writeFileSync(new URL('runtime.pid',import.meta.url),String(process.pid));
console.log('TEST READY');});
'''
with tempfile.TemporaryDirectory(prefix='win-manager-test-', dir=root) as scratch:
    base = Path(scratch)
    home = base/'managed'
    app = home/'app'
    env = {**os.environ, 'MMDB_PORT': str(port)}
    def run(action, package=None, success=True, input_text=None):
        cmd = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
               str(root/'mmdb-manager.ps1'), '-Action', action, '-ManagerHome', str(home)]
        if package:
            cmd += ['-Package', str(package)]
        # Detached Windows children can inherit an additional pipe handle from
        # PowerShell. Capture to a file so a running stub does not hold EOF open.
        with tempfile.TemporaryFile() as capture:
            result = subprocess.run(cmd, env=env, input=input_text.encode() if input_text else None,
                                    stdout=capture, stderr=subprocess.STDOUT, timeout=90)
            capture.seek(0)
            result.stdout = capture.read()
        print(action, result.returncode, flush=True)
        if (result.returncode == 0) != success:
            print(result.stdout.decode('utf-8', errors='replace'), flush=True)
            raise AssertionError(action)
        return result
    def fixture(name, version):
        target = base/name
        files = {
            'package.json': json.dumps({'name': 'mmdb-pg', 'version': version, 'type': 'module'}),
            'package-lock.json': '{}',
            'build.mjs': "console.log('TEST BUILD');",
            'launch.mjs': launch,
            'server.mjs': '// stub',
            'node_modules/ws/package.json': '{}',
            'MMDB.cmd': (root/'MMDB.cmd').read_text(),
            'mmdb-manager.ps1': (root/'mmdb-manager.ps1').read_bytes(),
        }
        with zipfile.ZipFile(target, 'w') as z:
            for name, content in files.items():
                z.writestr('mmdb-pg/'+name, content)
        return target
    archive = fixture('valid.zip', '1.2.10')
    try:
        run('install', archive)
        assert (home/'manager/MMDB.cmd').is_file()
        (app/'config.json').write_text(json.dumps({'apiKey': 'test-preserved', 'port': port}))
        run('start')
        first = (app/'runtime.pid').read_text()
        run('start')
        assert first == (app/'runtime.pid').read_text(), 'duplicate launch'
        run('update', archive)
        assert first != (app/'runtime.pid').read_text(), 'update did not restart'
        assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
        run('status')
        bad = base/'bad.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('mmdb-pg/../../escape.txt', 'invalid')
        live = (app/'runtime.pid').read_text()
        run('install', bad, success=False)
        assert live == (app/'runtime.pid').read_text()
        run('install', fixture('older.zip', '1.2.9'), success=False)
        assert live == (app/'runtime.pid').read_text()
        run('menu', bad, input_text='2\n0\n5\n0\n3\n0\n0\n')
        assert not list(home.glob('stage.*'))
        # Spoofing a live non-service PID must never stop that process.
        (app/'runtime.pid').write_text(str(os.getpid()))
        run('stop', success=False)
        (app/'runtime.pid').write_text(live)
        run('stop')
        assert not (app/'runtime.pid').exists()
    finally:
        if (app/'runtime.pid').exists():
            run('stop')
print('PASS: install/start/duplicate prevention/update/config/menu/bad ZIP/downgrade/PID ownership/stop', flush=True)
