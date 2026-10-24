#!/usr/bin/env bash
set -e
task_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
node "$task_root/tools/check-st-reasoning.mjs" "$@"
