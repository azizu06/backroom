#!/usr/bin/env bash
# Runs ON the GX10 (aarch64, CPU Cycles). Sandboxed: no network, read-only system and script, one writable dir.
# Usage: run-gx10.sh <script.py> <run-dir under ~/bake> [size] [samples] [threads]
# Copy first:  scp tools/bake/lobby.py gx10:bake/in/lobby.py   (then read the log in <run-dir>/log.txt)
set -euo pipefail
script=$(readlink -f "$1"); run=$(readlink -f "$2"); size=${3:-2048}; samples=${4:-256}; threads=${5:-8}
case "$run" in "$HOME"/bake/*) ;; *) echo "run dir must be under ~/bake" >&2; exit 2;; esac
case "$script" in "$HOME"/bake/*) ;; *) echo "script must be under ~/bake" >&2; exit 2;; esac
[[ "$threads" =~ ^[1-8]$ ]] || { echo "threads must be 1..8" >&2; exit 2; }
script_name=$(basename "$script")
inputs=()
case "$script_name" in
  hall.py|exterior.py)
    layout="$(dirname "$script")/hall.layout.json"
    [[ -f "$layout" ]] || { echo "hall.layout.json must be next to the script" >&2; exit 2; }
    inputs=(--ro-bind "$layout" /bake/hall.layout.json)
    ;;
esac
mkdir -p "$run/out" "$run/home"
start=$(date +%s)
status=0
nice -n 19 timeout 1800 bwrap \
  --unshare-net --unshare-pid --die-with-parent \
  --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt --symlink usr/lib /lib --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$script" "/bake/$script_name" "${inputs[@]}" \
  --bind "$run" /bake/run \
  --setenv HOME /bake/run/home --chdir /bake/run \
  blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python "/bake/$script_name" -- \
    --out /bake/run/out --size "$size" --samples "$samples" --threads "$threads" >"$run/log.txt" 2>&1 || status=$?
echo "exit=$status" >>"$run/log.txt"
echo "seconds=$(( $(date +%s) - start ))" | tee "$run/timing.txt"
exit "$status"
