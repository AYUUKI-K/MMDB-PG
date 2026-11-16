"""Developer check: isolated HOME, no Google calls or real service restart."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
bash = os.environ.get('MMDB_TEST_BASH') or shutil.which('bash')
assert bash, 'Bash required'
class ManagedTempDirectory(tempfile.TemporaryDirectory):
    def cleanup(self):
        app = Path(self.name)/'mmdb-pg'
        manager = app/'tools/portable-manager.mjs'
        if manager.is_file() and (app/'runtime.pid').exists():
            subprocess.run(['node', str(manager), 'stop'], cwd=app,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        super().cleanup()

with ManagedTempDirectory(prefix='manager-test-', dir=root) as scratch:
    env = {**os.environ, 'HOME': scratch, 'MMDB_PORT': '18765'}
    entry = Path(scratch)/'mmdb-install.sh'
    shutil.copyfile(root/'mmdb.sh', entry)
    def run(*args, success=True, input_text=None):
        result = subprocess.run([bash, str(entry), *map(str, args)],
                                env=env, input=input_text.encode('utf-8') if input_text is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        result.stdout = result.stdout.decode('utf-8', errors='replace')
        print(args[0] if args else 'menu', result.returncode, result.stdout[-800:], flush=True)
        assert (result.returncode == 0) == success
        return result

    version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
    archive = Path(os.environ.get('MMDB_TEST_PACKAGE', root/f'artifacts/mmdb-pg-{version}-universal.zip')).resolve()
    run('install', archive)
    app = Path(scratch)/'mmdb-pg'
    assert (app/'launch.mjs').is_file()
    (app/'config.json').write_text(json.dumps({'port': 18765, 'apiKey': 'test-preserved'}))
    (app/'accounts.json').write_text('{"version":1,"accounts":[]}')
    run('update', archive)
    assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
    assert (app/'accounts.json').read_text() == '{"version":1,"accounts":[]}', 'same-version update changed a user file'
    run('status')
    bad = Path(scratch)/'bad.zip'
    with zipfile.ZipFile(bad, 'w') as z:
        z.writestr('mmdb-pg/../../escape.txt', 'invalid')
    run('update', bad, success=False)
    assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
    assert not list((Path(scratch)/'.local/share/mmdb').glob('stage.*'))
    result = run(input_text='5\n2\n\n0\n99\n0\n')
    assert result.stdout.count('MEOW-FM ·') >= 4
    assert '更多操作' not in result.stdout
    assert '更新全部' in result.stdout
    assert 'portable-service.log' in result.stdout
    # A failed update returns to its page and menu instead of exiting the manager.
    (Path(scratch)/'.local/share/mmdb/source-url').write_text('https://127.0.0.1:1/invalid.zip')
    result = run(input_text='2\n\n4\n\n0\n')
    assert result.stdout.count('MEOW-FM ·') >= 3
    assert '操作未完成' in result.stdout
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
    snapshot=Path(scratch)/'source.zip'
    revision='c'*40
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(snapshot,'w') as dest:
        dest.comment=revision.encode('ascii')
        for item in source.infolist():
            dest.writestr('MMDB-PG-main/'+item.filename.removeprefix('mmdb-pg/'),source.read(item))
    live=(app/'runtime.pid').read_text()
    run('install',snapshot,success=False)  # A local ZIP cannot claim GitHub's source-archive prefix.
    assert (app/'runtime.pid').read_text()==live
    assert not (app/'downloads').exists()
    assert json.loads((app/'config.json').read_text())['apiKey']=='test-preserved'
    with zipfile.ZipFile(snapshot,'a') as dest: dest.comment=b''
    run('install',snapshot,success=False)
    assert (app/'runtime.pid').read_text()==live
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
    run('stop')
print('PASS: install, config preservation, status, traversal rejection, cleanup', flush=True)
