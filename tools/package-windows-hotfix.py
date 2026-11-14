"""Package the standalone recovery and updater dependencies for 1.18.x onward."""
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['Repair-Update.cmd', 'tools/windows-update-repair.mjs',
         'tools/release-update.mjs', 'tools/legacy-components.mjs']


def main():
    target = ROOT / 'downloads/mmdb-windows-update-hotfix.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name in FILES:
            data = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
            if name.endswith('.cmd'):
                data = data.replace(b'\n', b'\r\n')
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, data)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(f'{digest}  {target.name}\n', encoding='ascii')
    print(f'{target}\nSHA256 {digest}')


if __name__ == '__main__':
    main()
