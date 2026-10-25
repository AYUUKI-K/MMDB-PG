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
with tempfile.TemporaryDirectory(prefix='manager-test-', dir=root) as scratch:
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
    assert not (app/'accounts.json').exists(), 'retired account records migrated'
    run('status')
    bad = Path(scratch)/'bad.zip'
    with zipfile.ZipFile(bad, 'w') as z:
        z.writestr('mmdb-pg/../../escape.txt', 'invalid')
    run('update', bad, success=False)
    assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
    assert not list((Path(scratch)/'.local/share/mmdb').glob('stage.*'))
    result = run(input_text='1\n0\n3\n1\n0\n5\n0\n9\n0\n')
    assert result.stdout.count('========== MMDB') >= 4
    assert '—— 启动方式 ——' in result.stdout
    assert '—— 最近启动 / 运行日志 ——' in result.stdout
    # A failed update returns to its page and menu instead of exiting the manager.
    (Path(scratch)/'.local/share/mmdb/source-url').write_text('https://127.0.0.1:1/invalid.zip')
    result = run(input_text='2\n0\n5\n0\n0\n')
    assert result.stdout.count('========== MMDB') >= 3
    assert '操作未完成' in result.stdout
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
print('PASS: install, config preservation, status, traversal rejection, cleanup', flush=True)
