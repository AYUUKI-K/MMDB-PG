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
    def run(*args, success=True):
        result = subprocess.run([bash, str(root/'mmdb.sh'), *map(str, args)],
                                env=env, text=True, encoding='utf-8', errors='replace',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        print(args[0], result.returncode, result.stdout[-800:], flush=True)
        assert (result.returncode == 0) == success

    archive = root/'downloads/mmdb-pg-latest.zip'
    run('install', archive)
    app = Path(scratch)/'mmdb-pg'
    assert (app/'launch.mjs').is_file()
    (app/'config.json').write_text(json.dumps({'port': 18765, 'apiKey': 'test-preserved'}))
    run('update', archive)
    assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
    run('status')
    bad = Path(scratch)/'bad.zip'
    with zipfile.ZipFile(bad, 'w') as z:
        z.writestr('mmdb-pg/../../escape.txt', 'invalid')
    run('update', bad, success=False)
    assert json.loads((app/'config.json').read_text())['apiKey'] == 'test-preserved'
    assert not (Path(scratch)/'.local/share/mmdb/update.lock').exists()
    assert not list((Path(scratch)/'.local/share/mmdb').glob('stage.*'))
print('PASS: install, config preservation, status, traversal rejection, cleanup', flush=True)
