"""Upgrade actual published 1.18.1 installations with their unchanged old updater."""
from pathlib import Path
import io, json, os, socket, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[1]
LEGACY = os.environ.get('MMDB_LEGACY_REF', '38e6afe')
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
RELEASE = ROOT / f'artifacts/mmdb-pg-{VERSION}-universal.zip'
old_zip = subprocess.check_output(['git', 'show', f'{LEGACY}:downloads/mmdb-pg-latest.zip'], cwd=ROOT)
with zipfile.ZipFile(io.BytesIO(old_zip)) as bundle:
    old_version = json.loads(bundle.read('mmdb-pg/package.json'))['version']

with tempfile.TemporaryDirectory(prefix='MMDB real legacy upgrade ') as scratch:
    base = Path(scratch)
    source = base / 'source.zip'
    with zipfile.ZipFile(RELEASE) as src, zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as dst:
        dst.comment = b'a' * 40
        for item in src.infolist():
            name = item.filename.replace('mmdb-pg/', 'MMDB-PG-main/', 1)
            dst.writestr(name, src.read(item))
    harness = base / 'update.mjs'
    harness.write_text('''import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [app,source,latest,kind]=process.argv.slice(2),original=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  const u=new URL(url);
  if(u.hostname==='codeload.github.com'||u.hostname==='raw.githubusercontent.com'){
    const bytes=readFileSync(u.hostname==='codeload.github.com'?source:latest+(u.pathname.endsWith('.sha256')?'.sha256':''));
    const response=new Response(bytes);Object.defineProperty(response,'url',{value:u.href});return response;
  }
  if(u.hostname!=='127.0.0.1')throw Error('Unexpected external request during upgrade test');
  return original(url,options);
};
process.argv=['node',app+'/tools/portable-manager.mjs','update',kind==='source'?'source':'https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip'];
const {main}=await import(pathToFileURL(app+'/tools/portable-manager.mjs').href);
// The module's own entry point invokes main with these argv values.
''', encoding='utf-8')

    for kind in ['source', 'release', 'fixed-source'] if os.name == 'nt' else ['source', 'release']:
        case = base / kind
        case.mkdir()
        install = case / 'fixed' if kind == 'fixed-source' else case
        with zipfile.ZipFile(io.BytesIO(old_zip)) as z:
            z.extractall(case)
        app = case / 'mmdb-pg'
        fixed_script = case / 'old-manager.ps1'
        if kind == 'fixed-source':
            fixed_script.write_bytes((app / 'mmdb-manager.ps1').read_bytes())
            install.mkdir()
            app.rename(install / 'app')
            app = install / 'app'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
        config = json.dumps({'port': port, 'apiKey': 'isolated-legacy-upgrade-test'})
        (app / 'config.json').write_text(config)
        env = {**os.environ, 'MMDB_PORT': str(port), 'MMDB_API_KEY': 'isolated-legacy-upgrade-test', 'npm_config_offline': 'true'}
        def run(command):
            with tempfile.TemporaryFile() as log:
                r = subprocess.run(command, cwd=case, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=150)
                log.seek(0); output = log.read().decode('utf-8', errors='replace')
            if r.returncode:
                raise AssertionError(output)
            return output
        try:
            run(['node', str(app / 'tools/portable-manager.mjs'), 'ready'])
            old_pid = (app / 'runtime.pid').read_text()
            if kind == 'fixed-source':
                run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(fixed_script), '-ManagerHome', str(install), '-Action', 'update-all', '-Package', str(source)])
            else:
                run(['node', str(harness), str(app), str(source), str(ROOT / 'downloads/mmdb-pg-latest.zip'), kind])
            assert json.loads((app / 'package.json').read_text())['version'] == VERSION
            assert json.loads((app / 'config.json').read_text(encoding='utf-8-sig')) == json.loads(config)
            assert (app / 'runtime.pid').read_text() != old_pid
            assert (app / 'runtime-manager/src/diagnostics-page.mjs').is_file()
            assert (app / 'runtime-manager/Manager.cmd').is_file()
            assert (app / 'browser-extension/manifest.json').is_file()
            status = run(['node', str(app / 'tools/portable-manager.mjs'), 'status'])
            assert f'后台版本：{VERSION}' in status
            if kind == 'source':
                assert not (next((app / '.updates').glob('backup-*')) / 'runtime-manager').exists()
            print(f'PASS: unchanged {old_version} {kind} updater -> {VERSION}, new components, config and running backend', flush=True)
        finally:
            if (app / 'runtime.pid').exists():
                run(['node', str(app / 'tools/portable-manager.mjs'), 'stop'])
