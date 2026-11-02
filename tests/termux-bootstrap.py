"""Exercise Termux bootstrap failures with fake tools; never change system packages."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
BASH = os.environ.get('MMDB_TEST_BASH') or shutil.which('bash')
if not BASH and os.name == 'nt':
    candidate = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/bin/bash.exe'
    if candidate.is_file():
        BASH = str(candidate)
assert BASH, 'Bash required; set MMDB_TEST_BASH if it is not on PATH'
LINKER_ERROR = ('CANNOT LINK EXECUTABLE "curl": cannot locate symbol '
                '"SSL_set_quic_tls_early_data_enabled" referenced by "libcurl.so"')
PRELUDE = f"""
TERMUX_VERSION=test
PREFIX=''
node() {{ return 0; }}
npm() {{ return 0; }}
curl() {{ printf 'CURL %s\\n' "$*"; }}
pkg() {{ printf 'PKG %s\\n' "$*"; }}
apt() {{ printf 'APT %s\\n' "$*"; }}
linker_error() {{ printf '%s\\n' '{LINKER_ERROR}' >&2; return 1; }}
"""


def run(code, *args, success=True):
    env = {key: value for key, value in os.environ.items()
           if key not in ('BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS')}
    result = subprocess.run([BASH, '--noprofile', '--norc', '-c', PRELUDE + code,
                             'termux-bootstrap-test', *map(str, args)],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            encoding='utf-8', errors='replace', timeout=15)
    assert (result.returncode == 0) == success, result.stdout
    return result.stdout


with tempfile.TemporaryDirectory(prefix='manager-test-termux-', dir=ROOT) as scratch:
    base = Path(scratch).resolve()
    base.relative_to(ROOT)
    # Load the actual dependency functions without entering a menu or registering
    # a launcher in the developer's HOME. Portable functions still use scripts/..
    fixed = base / 'mmdb.sh'
    source = (ROOT / 'mmdb.sh').read_text(encoding='utf-8')
    assert source.endswith('main "$@"\n')
    fixed.write_text(source.removesuffix('main "$@"\n'), encoding='utf-8', newline='\n')
    portable = base / 'scripts/portable.sh'
    portable.parent.mkdir()
    source = (ROOT / 'scripts/portable.sh').read_text(encoding='utf-8')
    portable.write_text(source.split('if [ "$#" -gt 0 ]; then\n')[0],
                        encoding='utf-8', newline='\n')
    load = 'source "$1"\n'
    missing_node = '''
command() {
  if [ "${1:-}" = -v ] && [ "${2:-}" = node ]; then return 1; fi
  builtin command "$@"
}
'''
    output = run(load + missing_node + 'curl() { linker_error; }; need_runtime',
                 fixed, success=False)
    assert LINKER_ERROR in output and 'apt update && apt full-upgrade' in output
    assert 'PKG ' not in output, output
    output = run(load + missing_node + 'need_runtime', fixed)
    assert 'PKG install -y nodejs-lts npm' in output, output
    output = run(load + missing_node + 'pkg() { return 1; }; need_runtime',
                 fixed, success=False)
    assert '依赖安装失败' in output and 'apt full-upgrade' in output

    for script, action, executable in [(fixed, 'need_runtime', 'node'),
                                       (fixed, 'need_npm', 'npm'),
                                       (portable, 'node_ready', 'node')]:
        output = run(load + f'{executable}() {{ linker_error; }}; {action}',
                     script, success=False)
        assert LINKER_ERROR in output and 'apt update && apt full-upgrade' in output
        assert 'PKG ' not in output
        output = run(load + action, script)
        assert not output, output

    output = run(load + 'node() { return 1; }; node_ready', portable, success=False)
    assert 'Node.js 22+' in output and '系统库无法加载' not in output
    output = run(load + 'unset TERMUX_VERSION PREFIX; node() { linker_error; }; need_runtime',
                 fixed, success=False)
    assert LINKER_ERROR in output and 'apt full-upgrade' not in output
    print('PASS: broken curl stops pkg; install errors and Node/npm linker failures are explained; healthy tools pass')

# The user in the reported screenshot cannot download our script yet. Execute
# the published command with fake apt/curl/bash and prove failed upgrades stop it.
for doc in ['README.md', 'docs/INSTALLATION.md']:
    section = (ROOT / doc).read_text(encoding='utf-8').split('## Android Termux：首次安装', 1)[1]
    command_text = re.search(r'```sh\n(.*?)\n```', section, re.S).group(1)
    output = run('bash() { printf "INSTALLER\\n"; }\n' + command_text)
    assert output.index('APT update') < output.index('APT full-upgrade -y') < output.index('APT install -y') < output.index('CURL -fL') < output.index('INSTALLER')
    for failed in ['update', 'full-upgrade', 'install']:
        output = run(f'apt() {{ printf "APT %s\\n" "$*"; [ "$1" != "{failed}" ]; }}\n'
                     'bash() { printf "INSTALLER\\n"; }\n' + command_text, success=False)
        assert 'CURL ' not in output and 'INSTALLER' not in output
    output = run('curl() { linker_error; }; bash() { printf "INSTALLER\\n"; }\n'
                 + command_text, success=False)
    assert LINKER_ERROR in output and 'INSTALLER' not in output
print('PASS: both published Termux commands upgrade before downloading and stop on every failed step')
