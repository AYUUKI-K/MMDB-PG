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
const server=http.createServer((q,r)=>r.end(JSON.stringify({pending:fs.existsSync(new URL('busy.flag',import.meta.url))?1:0,active:[]})));
server.listen(Number(process.env.MMDB_PORT),'127.0.0.1',()=>{
fs.writeFileSync(new URL('runtime.pid',import.meta.url),String(process.pid));
console.log('TEST READY 测试中文日志');});
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
    def fixture(name, version, portable=False):
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
        if portable:
            files['MMDB.cmd'] = (root/'MMDB.cmd').read_bytes()
            files['scripts/portable.ps1'] = (root/'scripts/portable.ps1').read_bytes()
        with zipfile.ZipFile(target, 'w') as z:
            for name, content in files.items():
                z.writestr('mmdb-pg/'+name, content)
        return target
    archive = fixture('valid.zip', '1.2.10')
    try:
        run('install', archive)
        assert (home/'manager/MMDB.cmd').is_file()
        (app/'config.json').write_text(json.dumps({'apiKey': 'test-preserved', 'port': port}))
        (app/'accounts.json').write_text('{"version":1,"accounts":[]}')
        run('start')
        first = (app/'runtime.pid').read_text()
        run('start')
        assert first == (app/'runtime.pid').read_text(), 'duplicate launch'
        (app/'busy.flag').write_text('busy')
        run('lan', success=False)
        assert first == (app/'runtime.pid').read_text(), 'busy mode switch stopped service'
        (app/'busy.flag').unlink()
        run('lan')
        lan_pid = (app/'runtime.pid').read_text()
        assert lan_pid != first, 'LAN selection did not switch the running local service'
        assert (home/'manager/start-mode').read_text().strip() == 'lan'
        run('lan')
        assert lan_pid == (app/'runtime.pid').read_text(), 'duplicate LAN launch'
        run('start')
        first = (app/'runtime.pid').read_text()
        assert first != lan_pid, 'local selection did not switch LAN service'
        run('update', archive)
        assert first != (app/'runtime.pid').read_text(), 'update did not restart'
        assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
        assert not (app/'accounts.json').exists(), 'retired account records migrated'
        run('status')
        bad = base/'bad.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('mmdb-pg/../../escape.txt', 'invalid')
        live = (app/'runtime.pid').read_text()
        run('install', bad, success=False)
        assert live == (app/'runtime.pid').read_text()
        run('install', fixture('older.zip', '1.2.9'), success=False)
        assert live == (app/'runtime.pid').read_text()
        menu = run('menu', bad, input_text='2\n0\n5\n0\n3\n0\n0\n')
        assert '测试中文日志' in menu.stdout.decode('utf-8'), 'UTF-8 log displayed incorrectly'
        assert not list(home.glob('stage.*'))
        run('update', fixture('portable.zip', '1.5.0', portable=True))
        assert (app/'scripts/portable.ps1').is_file(), 'portable menu missing from app'
        assert not (home/'manager/scripts/portable.ps1').exists()
        fixed_entry = (home/'manager/MMDB.cmd').read_text()
        assert 'if exist "%~dp0scripts\\portable.ps1"' in fixed_entry
        assert '"%~dp0mmdb-manager.ps1"' in fixed_entry, 'fixed updater fallback missing'
        assert (home/'manager/mmdb-manager.ps1').is_file()
        live = (app/'runtime.pid').read_text()
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
