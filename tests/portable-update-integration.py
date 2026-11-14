"""Exercise a real in-place portable upgrade using a local release, never Google."""
from pathlib import Path
import io, json, os, socket, subprocess, tempfile, zipfile

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
archive=root/f'artifacts/mmdb-pg-{version}-universal.zip'
legacy_ref=os.environ.get('MMDB_UPDATE_LEGACY_REF')
with tempfile.TemporaryDirectory(prefix='MMDB portable update ') as scratch:
    app=Path(scratch)/'mmdb-pg'
    if legacy_ref:
        old_zip=subprocess.check_output(['git','show',f'{legacy_ref}:downloads/mmdb-pg-latest.zip'],cwd=root)
        with zipfile.ZipFile(io.BytesIO(old_zip)) as bundle: bundle.extractall(scratch)
        # Apply the actual hotfix without replacing the old menu or manager.
        with zipfile.ZipFile(root/'downloads/mmdb-windows-update-hotfix.zip') as hotfix:
            hotfix.extractall(app)
        previous_version=json.loads((app/'package.json').read_text(encoding='utf-8'))['version']
        assert previous_version!=version, 'legacy fixture must require an upgrade'
    else:
        with zipfile.ZipFile(archive) as bundle: bundle.extractall(scratch)
        previous_version='0.0.1'
        for name in ['package.json','package-lock.json']:
            data=json.loads((app/name).read_text(encoding='utf-8'));data['version']=previous_version
            if 'packages' in data: data['packages']['']['version']=previous_version
            (app/name).write_text(json.dumps(data),encoding='utf-8')
        (app/'src/shared/version.js').write_text(f"export const MMDB_VERSION='{previous_version}';\n",encoding='utf-8')
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
    holder=None
    try:
        if legacy_ref and os.name=='nt':
            # A protected Windows PID reproduces 1.18.0's kill(pid, 0) failure.
            (app/'runtime.pid').write_text('4')
            blocked=subprocess.run(['node',str(app/'tools/portable-manager.mjs'),'status'],cwd=app,env=env,capture_output=True,timeout=30)
            assert blocked.returncode!=0 and '无法确认进程状态' in blocked.stderr.decode('utf-8',errors='replace')
            subprocess.run(['node',str(app/'tools/windows-update-repair.mjs')],cwd=Path(scratch),env=env,check=True,timeout=30)
            assert not (app/'runtime.pid').exists()
            assert any(p.read_text()=='4' for p in (app/'.updates').glob('runtime-pid-*.txt'))
        run('ready')
        if legacy_ref and os.name=='nt':
            live_receipt=(app/'runtime.pid').read_bytes()
            refused=subprocess.run(['node',str(app/'tools/windows-update-repair.mjs')],env=env,capture_output=True,timeout=30)
            assert refused.returncode!=0 and (app/'runtime.pid').read_bytes()==live_receipt
        if os.name=='nt':
            holder=subprocess.Popen(['node','-e','process.stdout.write("ready\\n");process.stdin.resume();'],cwd=app/'scripts',stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            assert holder.stdout.readline()==b'ready\n'
        old_pid=(app/'runtime.pid').read_text()
        output=run('update',archive)
        if holder: assert holder.poll() is None, 'directory holder exited during the update'
        assert (app/'runtime.pid').read_text()!=old_pid,'update did not restart the service'
        assert json.loads((app/'package.json').read_text())['version']==version
        assert (app/'config.json').read_text()==config
        assert (app/'notes.txt').read_text()=='user notes remain here'
        assert f'/local-pg.user.js?v={version}' in output
        backups=list((app/'.updates').glob('backup-*'))
        assert len(backups)==1
        assert json.loads((backups[0]/'package.json').read_text())['version']==previous_version
        assert not list((app/'.updates').glob('stage-*'))
        live=(app/'runtime.pid').read_text()
        run('update',archive)
        assert (app/'runtime.pid').read_text()==live,'same-version update restarted the service'
    finally:
        try:
            if (app/'runtime.pid').exists():run('stop')
        finally:
            if holder: holder.communicate(timeout=10)
print(f'PASS: portable {previous_version} upgrade, occupied directory, restart, matching userscript, config, backup and same-version reuse.')
