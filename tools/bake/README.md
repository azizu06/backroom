# Baked art (opt-in)

Blender-made rooms, baked to a lightmap and exported as GLB, shown with `/office?art=baked`. The procedural scene stays the default and the fallback (`web/app/office/mounts/BakedArt.tsx`).

- `lobby.py`: models the lobby in web-scene coordinates, bakes lighting to one 2048 px lightmap (Cycles CPU, denoising off), exports `lobby.glb` with the map as WebP.
- `run-gx10.sh`: runs a script on the GX10 inside `bwrap` (no network, read-only system and script, one writable dir under `~/bake`, `nice -n 19`, `timeout 1800`).

Bake (from the desktop; check `nproc`, `uptime`, `nvidia-smi` and Ollama first, and only run when the box is quiet):

```
ssh gx10 'mkdir -p ~/bake/in'
scp tools/bake/lobby.py tools/bake/run-gx10.sh gx10:bake/in/
ssh gx10 'bash ~/bake/in/run-gx10.sh ~/bake/in/lobby.py ~/bake/run1 2048 256 8'
scp gx10:bake/run1/out/lobby.glb web/public/office-art/lobby.glb
```

Inspect the GLB (size, parses, only the expected nodes) before committing. Scripts are our own code only: no downloads, no subprocess, socket, urllib, requests or exec.

Node names the web layer relies on: `shell`, `wall_far`, `wall_near`, `ceiling`. `wall_near` and `ceiling` are hidden in the orthographic overview and shown in first-person Play. The ceiling panels, downlights and pendants are joined into `ceiling` so they hide with it. `lobby.colliders.json` is written by the script (no bake needed to know it) and mirrored in `web/public/office-art/`.
