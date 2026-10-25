"""Build a reproducible source distribution; Python is only needed by developers."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
# Explicit public inputs: never sweep the checkout or include runtime state.
ROOT_FILES = '''package.json package-lock.json README.md LICENSE .gitignore .gitattributes
build.mjs launch.mjs server.mjs lan-gateway.mjs lan-config.example.json
MMDB.cmd MMDB.ps1 mmdb.sh mmdb-manager.ps1
Start.cmd Start.ps1 Start-LAN.cmd Start-LAN.ps1
Stop.cmd Stop.ps1 Stop-LAN.cmd Stop-LAN.ps1 start.sh start-lan.sh'''.split()
SOURCE_TYPES = {
    'src': {'.js', '.mjs'},
    'scripts': {'.ps1', '.sh'},
    'tests': {'.mjs', '.ps1', '.py'},
    'tools': {'.mjs', '.py'},
    'docs': {'.md', '.txt'},
}
GENERATED = ['dist/local-pg.user.js', 'dist/preview.html']


def package_files():
    files = [ROOT / name for name in ROOT_FILES + GENERATED]
    for folder, suffixes in SOURCE_TYPES.items():
        files.extend(p for p in (ROOT / folder).rglob('*')
                     if p.is_file() and p.suffix in suffixes
                     and not any(part.startswith('.') or part == '__pycache__'
                                 for part in p.relative_to(ROOT / folder).parts))
    files.extend(p for p in (ROOT / 'licenses').iterdir() if p.is_file())
    for file in files:
        if not file.is_file() or file.is_symlink():
            raise ValueError(f'Missing or symlinked release input: {file}')
        file.resolve().relative_to(ROOT)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--portable-menu', action='store_true',
                        help='Use the portable-menu filename; contents are identical')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'artifacts')
    parser.add_argument('--update-latest', action='store_true',
                        help='Also replace downloads/mmdb-pg-latest.zip and its checksum')
    options = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    subprocess.run(['node', str(ROOT / 'build.mjs')], cwd=ROOT, check=True)
    edition = 'portable-menu' if options.portable_menu else 'universal'
    destination = options.output_dir.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f'mmdb-pg-{version}-{edition}.zip'
    files = package_files()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in files:
            name = file.relative_to(ROOT).as_posix()
            # CRLF checkouts must produce the same archive on Windows and Unix.
            data = file.read_bytes().replace(b'\r\n', b'\n')
            info = zipfile.ZipInfo('mmdb-pg/' + name, date_time=(2026, 10, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            bundle.writestr(info, data)
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert len(bundle.namelist()) == len(set(bundle.namelist()))
        assert f'@version      {version}'.encode() in bundle.read('mmdb-pg/dist/local-pg.user.js')
        for name in bundle.namelist():
            assert Path(name).name not in ['config.json', 'lan-config.json', 'st-path.json', 'accounts.json']
            assert not name.endswith(('.log', '.tmp', '.pid', '.zip'))
            assert 'node_modules/' not in name and '/downloads/' not in name
            if name.endswith('.sh'):
                assert b'\r' not in bundle.read(name)
                assert (bundle.getinfo(name).external_attr >> 16) & 0o111
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    if options.update_latest:
        latest = ROOT / 'downloads/mmdb-pg-latest.zip'
        latest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(archive, latest)
        latest.with_suffix('.zip.sha256').write_text(f'{digest}  {latest.name}\n', encoding='ascii')
    print(f'{archive}\n{len(files)} files; {archive.stat().st_size} bytes\nSHA256 {digest}')


if __name__ == '__main__':
    main()
