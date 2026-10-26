"""Exercise a real in-place portable upgrade using a local release, never Google."""
from pathlib import Path
import json, os, shutil, socket, subprocess, tempfile, zipfile

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
archive=root/f'artifacts/mmdb-pg-{version}-universal.zip'
with tempfile.TemporaryDirectory(prefix='MMDB portable update ') as scratch:
    app=Path(scratch)/'mmdb-pg'
    with zipfile.ZipFile(archive) as bundle: bundle.extractall(scratch)
    for name in ['package.json','package-lock.json']:
        data=json.loads((app/name).read_text(encoding='utf-8'));data['version']='0.0.1'
        if 'packages' in data: data['packages']['']['version']='0.0.1'
        (app/name).write_text(json.dumps(data),encoding='utf-8')
    (app/'src/shared/version.js').write_text("export const MMDB_VERSION='0.0.1';\n",encoding='utf-8')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    config=json.dumps({'port':port,'apiKey':'portable-upgrade-test'})
    (app/'config.json').write_text(config)
    (app/'notes.txt').write_text('user notes remain here')
    env={**os.environ,'MMDB_PORT':str(port),'MMDB_API_KEY':'portable-upgrade-test','npm_config_offline':'true'}
    def run(action, source=None):
        if os.name=='nt':
            cmd=['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(app/'MMDB.ps1'),'-Action',action]
            if source:cmd+=['-Package',str(source)]
        else:cmd=['node',str(app/'tools/portable-manager.mjs'),action]+([str(source)] if source else [])
        with tempfile.TemporaryFile() as capture:
            result=subprocess.run(cmd,cwd=app,env=env,stdout=capture,stderr=subprocess.STDOUT,timeout=90)
            capture.seek(0);output=capture.read().decode('utf-8',errors='replace')
        if result.returncode:raise AssertionError(output)
        print(action,'PASS',flush=True)
        return output
    try:
        run('ready')
        old_pid=(app/'runtime.pid').read_text()
        output=run('update',archive)
        assert (app/'runtime.pid').read_text()!=old_pid,'update did not restart the service'
        assert json.loads((app/'package.json').read_text())['version']==version
        assert (app/'config.json').read_text()==config
        assert (app/'notes.txt').read_text()=='user notes remain here'
        assert f'/local-pg.user.js?v={version}' in output
        backups=list((app/'.updates').glob('backup-*'))
        assert len(backups)==1
        assert json.loads((backups[0]/'package.json').read_text())['version']=='0.0.1'
        assert not list((app/'.updates').glob('stage-*'))
        live=(app/'runtime.pid').read_text()
        run('update',archive)
        assert (app/'runtime.pid').read_text()==live,'same-version update restarted the service'
    finally:
        if (app/'runtime.pid').exists():run('stop')
print('PASS: portable release upgrade, restart, matching userscript, config, backup and same-version reuse.')
