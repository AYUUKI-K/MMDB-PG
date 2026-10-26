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
const version=JSON.parse(fs.readFileSync(new URL('package.json',import.meta.url))).version;
const server=http.createServer((q,r)=>{
if(q.url.startsWith('/local-pg.user.js')){
  if(fs.existsSync(new URL('bad-script.flag',import.meta.url))){r.statusCode=503;r.end('unavailable');return;}
  r.end('// ==UserScript==\\n// @version      '+version+'\\n// ==/UserScript==\\n');return;
}
r.end(JSON.stringify({version,pending:fs.existsSync(new URL('busy.flag',import.meta.url))?1:0,active:[]}));});
server.listen(Number(process.env.MMDB_PORT),'127.0.0.1',()=>{
fs.writeFileSync(new URL('runtime.pid',import.meta.url),String(process.pid));
console.log('TEST READY 测试中文日志');});
'''
with tempfile.TemporaryDirectory(prefix='win-manager-test-', dir=root) as scratch:
    base = Path(scratch)
    home = base/'managed'
    app = home/'app'
    env = {**os.environ, 'MMDB_PORT': str(port), 'npm_config_offline': 'true'}
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
    def fixture(name, version, portable=False, source_revision=None):
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
        if source_revision:
            lock=json.loads((root/'package-lock.json').read_text())
            files['package.json']=json.dumps({'name':'mmdb-pg','version':version,'type':'module','dependencies':{'ws':'^8.18.3'}})
            lock['version']=version;lock['packages']['']['version']=version
            files['package-lock.json']=json.dumps(lock)
            files['downloads/old.zip'] = 'must not be installed'
            files['config.json'] = '{"apiKey":"must-not-replace"}'
        with zipfile.ZipFile(target, 'w') as z:
            for name, content in files.items():
                z.writestr((f'MMDB-PG-{source_revision}/' if source_revision else 'mmdb-pg/')+name, content)
        return target
    archive = fixture('valid.zip', '1.2.10')
    try:
        cold = run('script', archive)
        assert f'http://127.0.0.1:{port}/local-pg.user.js?v=1.2.10' in cold.stdout.decode('utf-8')
        assert '主菜单选 3 更新浏览器脚本' not in cold.stdout.decode('utf-8')
        run('stop')
        assert (home/'manager/MMDB.cmd').is_file()
        (app/'config.json').write_text(json.dumps({'apiKey': 'test-preserved', 'port': port}))
        (app/'accounts.json').write_text('{"version":1,"accounts":[]}')
        # Direct script preparation starts a stopped backend; it must not need
        # a separate start action or open a browser from this diagnostic command.
        script = run('script')
        assert f'http://127.0.0.1:{port}/local-pg.user.js?v=1.2.10' in script.stdout.decode('utf-8')
        first = (app/'runtime.pid').read_text()
        run('start')
        assert first == (app/'runtime.pid').read_text(), 'duplicate launch'
        (app/'busy.flag').write_text('busy')
        run('script')
        assert first == (app/'runtime.pid').read_text(), 'script preparation restarted a busy service'
        run('stop', success=False)
        run('update', archive, success=False)
        run('lan', success=False)
        assert first == (app/'runtime.pid').read_text(), 'busy mode switch stopped service'
        (app/'busy.flag').unlink()
        run('lan')
        lan_pid = (app/'runtime.pid').read_text()
        assert lan_pid != first, 'LAN selection did not switch the running local service'
        assert (home/'manager/start-mode').read_text().strip() == 'lan'
        run('script')
        assert lan_pid == (app/'runtime.pid').read_text(), 'script update switched LAN mode'
        (app/'bad-script.flag').write_text('bad')
        run('script', success=False)
        assert lan_pid == (app/'runtime.pid').read_text()
        (app/'bad-script.flag').unlink()
        run('lan')
        assert lan_pid == (app/'runtime.pid').read_text(), 'duplicate LAN launch'
        run('start')
        first = (app/'runtime.pid').read_text()
        assert first != lan_pid, 'local selection did not switch LAN service'
        run('update-all', archive)
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
        menu = run('menu', bad, input_text='2\n\n4\n\n5\n0\n0\n')
        assert '测试中文日志' in menu.stdout.decode('utf-8'), 'UTF-8 log displayed incorrectly'
        assert not list(home.glob('stage.*'))
        run('update', fixture('portable.zip', '1.5.0', portable=True))
        assert (app/'scripts/portable.ps1').is_file(), 'portable menu missing from app'
        assert not (home/'manager/scripts/portable.ps1').exists()
        fixed_entry = (home/'manager/MMDB.cmd').read_text()
        assert 'if exist "%~dp0scripts\\portable.ps1"' in fixed_entry
        assert '"%~dp0mmdb-manager.ps1"' in fixed_entry, 'fixed updater fallback missing'
        assert (home/'manager/mmdb-manager.ps1').is_file()
        revision='b'*40
        run('update-all',fixture('source.zip','1.5.0',portable=True,source_revision=revision))
        assert json.loads((app/'.source-revision.json').read_text(encoding='utf-8-sig'))['commit']==revision
        assert not (app/'downloads').exists()
        assert json.loads((app/'config.json').read_text())['apiKey']=='test-preserved'
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
