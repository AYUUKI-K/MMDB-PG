#!/usr/bin/env bash
set -eu
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/start.sh" --lan
