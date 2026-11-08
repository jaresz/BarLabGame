#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
build_dir="$project_dir/public_html"
config_path="$script_dir/deploy.local.json"

if [[ ! -f "$config_path" ]]; then
  printf 'Deployment configuration not found: %s. Copy deploy.local.example.json to deploy.local.json and fill in the server settings.\n' "$config_path" >&2
  exit 1
fi

# The Node reader validates JSON and emits four newline-free values in a fixed order.
config_values="$(node "$script_dir/read-deploy-config.mjs" "$config_path")"
mapfile -t settings <<< "$config_values"
destination="${settings[0]}"
remote_host="${settings[1]}"
remote_assets="${settings[2]%/}"
ssh_port="${settings[3]}"
remote_icons="${remote_assets%/assets}/icons"
remote_sounds="${remote_assets%/assets}/sounds"

cd -- "$project_dir"
npm run build

[[ -f "$build_dir/index.html" ]] || { echo 'Build output does not contain public_html/index.html; deployment stopped.' >&2; exit 1; }
[[ -d "$build_dir/assets" ]] || { echo 'Build output does not contain public_html/assets; deployment stopped.' >&2; exit 1; }
[[ -d "$build_dir/icons" ]] || { echo 'Build output does not contain public_html/icons; deployment stopped.' >&2; exit 1; }
[[ -d "$build_dir/sounds" ]] || { echo 'Build output does not contain public_html/sounds; deployment stopped.' >&2; exit 1; }
[[ -f "$build_dir/manifest.json" ]] || { echo 'Build output does not contain public_html/manifest.json; deployment stopped.' >&2; exit 1; }
[[ -f "$build_dir/sw.js" ]] || { echo 'Build output does not contain public_html/sw.js; deployment stopped.' >&2; exit 1; }

shopt -s nullglob
asset_files=("$build_dir/assets/"*)
asset_count=0
# Inspect generated files before upload; both platform scripts expect plain asset names.
for asset in "${asset_files[@]}"; do
  [[ -f "$asset" ]] || continue
  asset_name="${asset##*/}"
  [[ "$asset_name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Asset filenames contain unsafe characters.' >&2; exit 1; }
  ((asset_count += 1))
done
((asset_count > 0)) || { echo 'Build output contains no assets; deployment stopped.' >&2; exit 1; }
sound_files=("$build_dir/sounds/"*.wav)
(( ${#sound_files[@]} > 0 )) || { echo 'Build output contains no WAV sounds; deployment stopped.' >&2; exit 1; }

printf 'Uploading application assets, icons, and sounds to %s\n' "$destination"
scp -r -P "$ssh_port" "$build_dir/assets" "$build_dir/icons" "$build_dir/sounds" "$destination"
scp -P "$ssh_port" "$build_dir/manifest.json" "$build_dir/index.html" "$destination"
ssh -p "$ssh_port" "$remote_host" "chmod -R a+rX '$remote_assets' '$remote_icons' '$remote_sounds'"
# Upload the worker last so clients only discover the new version after its assets are present.
scp -P "$ssh_port" "$build_dir/sw.js" "$destination"
echo 'Deployment completed.'
