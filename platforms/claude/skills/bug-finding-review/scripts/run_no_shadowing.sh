#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "no-shadow: node is required" >&2
    exit 127
fi

node "$script_dir/no-shadowing.mjs" "$@"
