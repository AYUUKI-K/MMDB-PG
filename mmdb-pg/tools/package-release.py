"""Developer-only reproducible source package; Python is not needed to run MMDB."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
destination = root.parent.parent if root.parent.name == f'mmdb-pg-{version}-universal' else root.parent
archive = destination / f'mmdb-pg-{version}-universal.zip'
files = '''server.mjs protocol.mjs continuation.mjs anti-truncation.mjs diagnostics.mjs metrics.mjs
config.mjs json-response.mjs reasoning-diagnostics.mjs build.mjs launch.mjs local-pg.user.js preview.html package.json
package-lock.json README.md LICENSE THIRD_PARTY.md .gitignore lan-gateway.mjs
lan-config.example.json Start.cmd Start.ps1 Stop.cmd Stop.ps1 Start-LAN.cmd
Start-LAN.ps1 Stop-LAN.cmd Stop-LAN.ps1 start.sh start-lan.sh Fix-ST-Reasoning.cmd fix-st-reasoning.sh
Check-ST-Reasoning.cmd check-st-reasoning.sh mmdb.sh'''.split()
for folder in ['src', 'test', 'licenses', 'tools']:
    files += [p.relative_to(root).as_posix() for p in sorted((root / folder).rglob('*'))
              if p.is_file() and '__pycache__' not in p.parts]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(files):
        info = zipfile.ZipInfo('mmdb-pg/' + name, date_time=(2026, 10, 18, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
        z.writestr(info, (root / name).read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(set(z.namelist()))
    for name in z.namelist():
        assert Path(name).name not in ['config.json', 'lan-config.json', 'runtime.pid', 'lan-runtime.pid']
        assert not name.endswith(('.log', '.tmp')) and 'node_modules/' not in name
        if name.endswith('.sh'):
            assert b'\r' not in z.read(name)
            assert (z.getinfo(name).external_attr >> 16) & 0o111
    assert f'@version      {version}'.encode() in z.read('mmdb-pg/local-pg.user.js')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
print(f'{archive}\n{len(files)} files; {archive.stat().st_size} bytes\nSHA256 {digest}')
