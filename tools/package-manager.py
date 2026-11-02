"""Package only the standalone manager's public source; never runtime data."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'runtime-manager'
PUBLIC_DIRS = {'src', 'browser-extension', 'licenses', 'tests'}
PUBLIC_FILES = {'package.json', 'README.md', 'LICENSE', 'cli.mjs', 'Manager.cmd',
                'start.sh', 'manager.config.example.json'}


def main():
    version = json.loads((PROJECT / 'package.json').read_text(encoding='utf-8'))['version']
    archive = ROOT / 'artifacts' / f'mmdb-runtime-manager-{version}.zip'
    archive.parent.mkdir(exist_ok=True)
    files = sorted(p for p in PROJECT.rglob('*') if p.is_file()
                   and (p.relative_to(PROJECT).parts[0] in PUBLIC_DIRS
                        or p.relative_to(PROJECT).as_posix() in PUBLIC_FILES))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in files:
            if path.is_symlink():
                raise ValueError(f'Symlinked public input: {path}')
            path.resolve().relative_to(PROJECT)
            name = path.relative_to(PROJECT).as_posix()
            info = zipfile.ZipInfo('mmdb-runtime-manager/' + name, (2026, 10, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            bundle.writestr(info, path.read_bytes().replace(b'\r\n', b'\n'))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    print(f'{archive}\n{len(files)} public files; SHA256 {digest}')


if __name__ == '__main__':
    main()
