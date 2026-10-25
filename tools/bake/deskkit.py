"""Desk kit: separate, individually named stylized office props, exported as deskkit.glb (no room, no lightmap).

Run (inside the sandbox, see tools/bake/README.md):
  blender --background --factory-startup --disable-autoexec --python deskkit.py -- --out /bake/out

Coordinates are three.js metres (Y up). `B()` converts to Blender's Z-up; the glTF exporter maps it back.
Every prop is one node at the origin with its origin at its floor contact point, front facing +z. Wall pieces
(`wall_art`, `whiteboard`) have their origin on the wall, at the centre of their back face's bottom edge for the
whiteboard and at the back-face centre for the art. Props are lit live in the web scene (like character.glb);
a cheap per-vertex contact-shadow term goes into a float colour attribute ("ao"), computed here without Cycles.
The web registry (web/lib/office/deskkit.ts) places these nodes on the existing procedural anchors and relies on
the node names below and on materials named `tint` (recoloured per placement). Also writes deskkit.nodes.json.
Our own code only: no downloads, no network, no process spawning. Reads nothing; writes only into --out.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---- cozy pastel palette (mirrors web/lib/office/palette.ts and lobby.py; keep in sync) ----------------------
AQUA = "#9EF2FB"
CREAM = "#FFF7EC"
PEACH = "#F6D3B8"
BUTTER = "#FFF0B3"
BLUSH = "#FFC9D9"
LAVENDER = "#D9CCFF"
MINT = "#CDF2DC"
NAVY = "#4A5A7A"
SLATE = "#7C88A6"

bpy.ops.wm.read_factory_settings(use_empty=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = arg("--out", os.path.join(os.getcwd(), "out"))
SIZE = min(int(arg("--size", "2048")), 2048)  # unused (no textures); clamped like every bake script
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene


def B(x, y, z):
    """three.js (x, y up, z) -> Blender (x, -z, y up)."""
    return (x, -z, y)


def hexlin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def make_material(name, color, roughness=0.8, emit=0.0, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emit > 0:
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    return mat


MATS = {
    "wood": make_material("wood", hexlin(PEACH), 0.55),
    "wood_dark": make_material("wood_dark", mix(hexlin(PEACH), hexlin(SLATE), 0.3), 0.55),
    "panel": make_material("panel", hexlin(LAVENDER), 0.75),
    "trim": make_material("trim", hexlin(NAVY), 0.5),
    "metal": make_material("metal", hexlin(SLATE), 0.35, metallic=0.2),
    "cream": make_material("cream", hexlin(CREAM), 0.6),
    "pot": make_material("pot", hexlin(BLUSH), 0.8),
    "soil": make_material("soil", mix(hexlin(PEACH), hexlin(NAVY), 0.55), 1.0),
    "plant": make_material("plant", hexlin(MINT), 0.9),
    "plant_dark": make_material("plant_dark", mix(hexlin(MINT), hexlin(SLATE), 0.25), 0.9),
    "shade": make_material("shade", hexlin(BUTTER), 0.6, emit=0.35),
    "butter": make_material("butter", hexlin(BUTTER), 0.8),
    "aqua": make_material("aqua", hexlin(AQUA), 0.4),
    "blush": make_material("blush", hexlin(BLUSH), 0.8),
    "mint": make_material("mint", hexlin(MINT), 0.8),
    "lavender": make_material("lavender", hexlin(LAVENDER), 0.8),
    "vault": make_material("vault", mix(hexlin(SLATE), hexlin(AQUA), 0.25), 0.3, metallic=0.5),
    "coffee": make_material("coffee", mix(hexlin(PEACH), hexlin(NAVY), 0.65), 0.3),
    # Recoloured per placement by the web layer (room accent for chairs, the procedural colour for rugs and art).
    "tint": make_material("tint", hexlin(LAVENDER), 0.9),
}

# ---- geometry helpers (copied from lobby.py, plus per-prop grouping and a contact-shadow vertex term) ----------
parts = []
MANIFEST = {}


def _rotate(bm, rot_x=0.0, rot_y=0.0, rot_z=0.0):
    """Rotate about the origin by three.js-axis angles (x, then z, then y)."""
    if rot_x:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_x, 3, "X"), verts=bm.verts)
    if rot_z:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-rot_z, 3, "Y"), verts=bm.verts)
    if rot_y:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)


def _ao(mesh):
    """Contact shadow per vertex (linear grey): darker towards each part's own base and near the floor."""
    zs = [v.co.z for v in mesh.vertices]
    if not zs:
        return
    lo, hi = min(zs), max(zs)
    span = max(hi - lo, 1e-4)
    try:
        attr = mesh.color_attributes.new(name="ao", type="FLOAT_COLOR", domain="POINT")
    except (AttributeError, TypeError, RuntimeError):
        return
    for i, v in enumerate(mesh.vertices):
        t = (v.co.z - lo) / span
        floor = min(1.0, max(0.0, v.co.z / 0.25))
        g = (0.84 + 0.16 * t) * (0.8 + 0.2 * floor)
        attr.data[i].color = (g, g, g, 1.0)


def _link(bm, mat, recalc=True, smooth=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(f"m_{mat}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[mat])
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    _ao(mesh)
    obj = bpy.data.objects.new(f"p_{mat}", mesh)
    scene.collection.objects.link(obj)
    parts.append(obj)
    return obj


def box(mat, cx, cy, cz, sx, sy, sz, bevel=0.0, rot_y=0.0, rot_x=0.0, rot_z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(sx, sy, sz) * 0.45), segments=2,
                        affect="EDGES")
    _rotate(bm, rot_x, rot_y, rot_z)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    return _link(bm, mat, smooth=bevel > 0)


def cyl(mat, cx, cy, cz, r, h, segs=16, r_top=None, axis="y", rot_x=0.0, rot_z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r_top is None else r_top, depth=h)
    if axis == "z":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
    elif axis == "x":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    _rotate(bm, rot_x, 0.0, rot_z)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    return _link(bm, mat)


def ball(mat, cx, cy, cz, r, squash=1.0, segs=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r)
    bmesh.ops.scale(bm, vec=(1, 1, squash), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    return _link(bm, mat)


def place(objs, x=0.0, z=0.0, rot_y=0.0):
    """Move already-built parts by a three.js yaw about the origin, then a floor offset (for sets of props)."""
    m = Matrix.Translation(Vector(B(x, 0.0, z))) @ Matrix.Rotation(rot_y, 4, "Z")
    for o in objs:
        o.data.transform(m)


def finish(name):
    """Join the parts built since the last finish() into one node called `name`, origin at the world origin."""
    global parts
    members = parts
    parts = []
    bpy.ops.object.select_all(action="DESELECT")
    for o in members:
        o.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    if len(members) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    try:
        obj.data.color_attributes.active_color = obj.data.color_attributes["ao"]
        obj.data.color_attributes.render_color_index = obj.data.color_attributes.active_color_index
    except (AttributeError, KeyError, TypeError):
        pass
    xs = [v.co.x for v in obj.data.vertices]
    zs = [-v.co.y for v in obj.data.vertices]  # three.js z
    ys = [v.co.z for v in obj.data.vertices]
    MANIFEST[name] = {"minX": round(min(xs), 3), "maxX": round(max(xs), 3), "minZ": round(min(zs), 3),
                      "maxZ": round(max(zs), 3), "minY": round(min(ys), 3), "maxY": round(max(ys), 3),
                      "materials": sorted({m.name for m in obj.data.materials if m})}
    return obj


# ---- props ------------------------------------------------------------------------------------------------------
DESK_W, DESK_D, DESK_TOP = 2.25, 1.05, 0.91  # same footprint and top as web/lib/office/furniture.ts deskPieces


def desk():
    box("wood", 0, DESK_TOP - 0.06, 0, DESK_W, 0.12, DESK_D, bevel=0.025)
    box("panel", -0.95, (DESK_TOP - 0.12) / 2, 0, 0.1, DESK_TOP - 0.12, 0.9, bevel=0.015)       # left panel leg
    px = DESK_W / 2 - 0.3
    box("panel", px, (DESK_TOP - 0.12) / 2, 0, 0.52, DESK_TOP - 0.12, 0.92, bevel=0.02)         # drawer pedestal
    for i in range(3):                                                                         # drawers face the sitter (-z)
        y = 0.15 + i * 0.24
        box("wood_dark", px, y + 0.1, -0.465, 0.46, 0.2, 0.03, bevel=0.01)
        box("metal", px, y + 0.14, -0.49, 0.16, 0.025, 0.025, bevel=0.008)
    box("panel", -0.12, 0.52, 0.36, 1.55, 0.42, 0.04, bevel=0.012)                              # modesty panel
    box("wood_dark", 0, DESK_TOP - 0.125, 0, DESK_W - 0.08, 0.01, DESK_D - 0.08)                # lip shadow line


def chair(mat="tint"):
    """Office chair, seat centred on the origin, back towards -z (the desk-local layout of furniture.ts)."""
    for i in range(5):
        a = i * 2 * math.pi / 5
        dx, dz = math.sin(a) * 0.22, math.cos(a) * 0.22
        box("metal", dx / 2, 0.07, dz / 2, 0.05, 0.035, 0.24, bevel=0.012, rot_y=a)
        ball("trim", dx, 0.03, dz, 0.03, segs=8)
    cyl("metal", 0, 0.24, 0, 0.03, 0.32, segs=10)
    box(mat, 0, 0.45, 0, 0.6, 0.11, 0.56, bevel=0.045)                                         # seat cushion
    box("metal", 0, 0.62, -0.25, 0.06, 0.3, 0.04, bevel=0.01)                                   # back post
    box(mat, 0, 0.84, -0.26, 0.58, 0.48, 0.09, bevel=0.04, rot_x=-0.08)                         # back cushion
    for side in (-1, 1):                                                                       # armrests
        box("metal", side * 0.29, 0.56, 0.0, 0.03, 0.14, 0.03)
        box("trim", side * 0.29, 0.64, 0.02, 0.05, 0.03, 0.28, bevel=0.012)


# Monitor casing matches MONITOR_FACE in web/lib/office/props/monitors.ts (1.8 x 1.08 face, +0.1 casing),
# centred 0.63 above the desk top; the web layer keeps drawing the live screen just in front of it (+z 0.05).
MON_W, MON_H, MON_Y = 1.9, 1.18, 0.63


def monitor():
    box("metal", 0, 0.01, -0.05, 0.42, 0.02, 0.26, bevel=0.008)
    box("metal", 0, 0.3, -0.08, 0.09, 0.58, 0.04, bevel=0.012)
    box("trim", 0, MON_Y, 0, MON_W, MON_H, 0.07, bevel=0.025)
    box("trim", 0, MON_Y, -0.055, 1.1, 0.62, 0.05, bevel=0.02)                                 # rear housing
    box("metal", 0, MON_Y - MON_H / 2 + 0.03, 0.036, 0.16, 0.012, 0.004)                         # chin logo strip


def keyboard():
    box("blush", 0, 0.004, 0, 0.4, 0.008, 0.5, bevel=0.003)                                    # desk mat
    box("cream", -0.02, 0.022, -0.06, 0.34, 0.026, 0.13, bevel=0.008)
    for i in range(3):
        box("metal", -0.02, 0.037, -0.1 + i * 0.04, 0.3, 0.006, 0.025)
    ball("cream", 0.13, 0.018, 0.13, 0.035, squash=0.55, segs=10)                              # mouse


def desk_lamp():
    cyl("trim", 0, 0.015, 0, 0.095, 0.03, segs=16)
    cyl("metal", 0.02, 0.17, 0, 0.012, 0.3, segs=8, rot_z=-0.25)
    cyl("metal", 0.0, 0.33, 0.05, 0.011, 0.2, segs=8, rot_x=1.0)
    ball("trim", 0.06, 0.31, 0, 0.018, segs=8)
    cyl("shade", 0.0, 0.36, 0.12, 0.05, 0.1, segs=16, r_top=0.085, rot_x=0.5)


def filing_cabinet():
    w, d, h = 0.5, 0.6, 1.02
    box("panel", 0, h / 2, 0, w, h, d, bevel=0.02)
    for i in range(3):
        y = 0.18 + i * 0.32
        box("lavender", 0, y, d / 2 + 0.005, w - 0.06, 0.28, 0.02, bevel=0.01)
        box("metal", 0, y + 0.06, d / 2 + 0.02, 0.16, 0.025, 0.025, bevel=0.008)
        box("cream", 0, y - 0.04, d / 2 + 0.017, 0.12, 0.05, 0.005)                             # label card


SHELF_W, SHELF_D, SHELF_H = 1.4, 0.34, 0.9  # height matches SHELF_HEIGHT in props/dressing.ts (plants sit on it)


def bookshelf():
    t = 0.04
    for side in (-1, 1):
        box("wood", side * (SHELF_W / 2 - t / 2), SHELF_H / 2, 0, t, SHELF_H, SHELF_D, bevel=0.01)
    box("wood_dark", 0, SHELF_H / 2, -SHELF_D / 2 + 0.01, SHELF_W - 2 * t, SHELF_H, 0.02)
    for y in (t / 2, SHELF_H / 2, SHELF_H - t / 2):
        box("wood", 0, y, 0, SHELF_W - 2 * t + 0.002, t, SHELF_D, bevel=0.008)
    colours = ("blush", "mint", "butter", "aqua", "lavender", "trim")
    widths = (0.07, 0.09, 0.06, 0.08, 0.1, 0.065)
    heights = (0.3, 0.33, 0.26, 0.31, 0.28, 0.32)
    for row, floor in enumerate((t, SHELF_H / 2 + t / 2)):
        x = -SHELF_W / 2 + t + 0.05 + row * 0.06
        for i in range(7):
            n = row * 3 + i
            bw, bh = widths[n % 6], heights[n % 6]
            if x + bw > SHELF_W / 2 - t - 0.25:
                break
            box(colours[n % 6], x + bw / 2, floor + bh / 2, 0.01, bw, bh, SHELF_D * 0.8, bevel=0.006)
            x += bw + (0.12 if i == 2 else 0.008)
        # one leaning book and a small box end each row
        box(colours[(row + 4) % 6], SHELF_W / 2 - t - 0.17, floor + 0.13, 0.01, 0.06, 0.28, SHELF_D * 0.75,
            bevel=0.006, rot_z=0.32)
        box("cream", SHELF_W / 2 - t - 0.07, floor + 0.05, 0.02, 0.1, 0.1, 0.18, bevel=0.01)


def plant(scale_pot, height, leaves, pot_r_top=None):
    r = scale_pot
    cyl("pot", 0, height * 0.18, 0, r * 0.8, height * 0.36, segs=12, r_top=pot_r_top or r)
    cyl("trim", 0, height * 0.36 + 0.004, 0, (pot_r_top or r) + 0.006, 0.012, segs=12)
    cyl("soil", 0, height * 0.36 + 0.008, 0, (pot_r_top or r) * 0.86, 0.01, segs=12)
    for i, (dx, dy, dz, lr) in enumerate(leaves):
        ball("plant" if i % 2 == 0 else "plant_dark", dx, dy, dz, lr, squash=0.8, segs=10)


def plant_small():
    plant(0.1, 0.38, ((0, 0.2, 0, 0.07), (-0.045, 0.25, 0.02, 0.055), (0.04, 0.29, -0.02, 0.05)))


def plant_medium():
    plant(0.11, 0.5, ((0, 0.27, 0, 0.08), (-0.05, 0.34, 0.03, 0.07), (0.05, 0.4, -0.02, 0.065),
                      (0.0, 0.46, 0.02, 0.05)))
    cyl("plant_dark", 0, 0.28, 0, 0.008, 0.2, segs=6)


def plant_large():
    """Floor plant at size 1: pot 0.46 wide and 0.44 tall, foliage within a 1 m footprint (PLANT_RADIUS 0.5)."""
    cyl("pot", 0, 0.22, 0, 0.18, 0.44, segs=14, r_top=0.23)
    cyl("trim", 0, 0.445, 0, 0.235, 0.02, segs=14)
    cyl("soil", 0, 0.45, 0, 0.2, 0.012, segs=14)
    cyl("plant_dark", 0, 0.6, 0, 0.02, 0.32, segs=6)
    for i, (dx, dy, dz, lr) in enumerate(((0, 0.75, 0, 0.3), (-0.2, 0.68, 0.1, 0.22), (0.2, 0.7, -0.08, 0.22),
                                         (0.05, 0.98, 0.04, 0.22), (-0.08, 0.9, -0.15, 0.18),
                                         (0.12, 0.88, 0.17, 0.17))):
        ball("plant" if i % 2 == 0 else "plant_dark", dx, dy, dz, lr, squash=0.85, segs=12)


def whiteboard():
    w, h, y0 = 1.8, 1.1, 0.9
    box("trim", 0, y0 + h / 2, 0.025, w, h, 0.05, bevel=0.012)
    box("cream", 0, y0 + h / 2, 0.052, w - 0.08, h - 0.08, 0.006)
    box("metal", 0, y0 - 0.02, 0.08, 1.1, 0.04, 0.1, bevel=0.008)                              # marker tray
    for i, m in enumerate(("aqua", "blush", "trim")):
        cyl(m, -0.2 + i * 0.12, y0 + 0.012, 0.08, 0.012, 0.11, segs=8, axis="x")
    for i, (bw, m) in enumerate(((0.9, "aqua"), (0.6, "blush"), (0.75, "lavender"))):                # scribbles
        box(m, -0.3 + i * 0.05, y0 + h - 0.25 - i * 0.18, 0.056, bw, 0.03, 0.002)


def wall_art():
    box("trim", 0, 0, 0.02, 0.8, 0.5, 0.04, bevel=0.008)
    box("butter", 0, 0, 0.044, 0.72, 0.42, 0.008)
    ball("blush", 0.18, 0.09, 0.05, 0.05, squash=0.2, segs=12)                                 # sun
    box("tint", -0.12, -0.08, 0.05, 0.46, 0.15, 0.006, rot_z=0.12)                              # hills
    box("mint", 0.16, -0.13, 0.054, 0.36, 0.11, 0.006, rot_z=-0.1)


def rug():
    """1 x 1 m at scale 1; the web scales x and z to the procedural rug's size and recolours `tint`."""
    box("tint", 0, 0.004, 0, 1.0, 0.008, 1.0, bevel=0.003)
    box("cream", 0, 0.009, 0, 0.86, 0.004, 0.86)
    for side in (-1, 1):
        box("tint", 0, 0.012, side * 0.33, 0.78, 0.003, 0.04)
    box("tint", 0, 0.012, 0, 0.3, 0.003, 0.3, rot_y=math.pi / 4)


def mug():
    cyl("aqua", 0, 0.05, 0, 0.055, 0.1, segs=14, r_top=0.06)
    cyl("coffee", 0, 0.098, 0, 0.05, 0.006, segs=14)
    for x, y, sx, sy in ((-0.075, 0.075, 0.05, 0.016), (-0.075, 0.025, 0.05, 0.016), (-0.098, 0.05, 0.016, 0.05)):
        box("aqua", x, y, 0, sx, sy, 0.018, bevel=0.005)                                       # handle


def tray():
    for level in (0, 1):
        y = level * 0.07
        box("lavender", 0, y + 0.005, 0, 0.34, 0.01, 0.26, bevel=0.003)
        for side in (-1, 1):
            box("lavender", side * 0.165, y + 0.03, 0, 0.01, 0.05, 0.26)
        box("lavender", 0, y + 0.03, -0.125, 0.34, 0.05, 0.01)
        box("cream", 0.01 * level, y + 0.016, 0.005, 0.29, 0.008, 0.22)
        box("butter", -0.02, y + 0.022, 0.01, 0.27, 0.004, 0.2, rot_y=0.06)
    for side in (-1, 1):                                                                       # posts
        box("metal", side * 0.15, 0.06, -0.11, 0.012, 0.12, 0.012)


# Treasury: TreasuryVault.tsx's body is 1.8 x 1.4 x 1.25 centred on (5, 4) with a 1.4 x 1.05 door on its north face.
VAULT_W, VAULT_H, VAULT_D = 1.8, 1.4, 1.25


def vault_body():
    box("trim", 0, 0.05, 0, VAULT_W + 0.04, 0.1, VAULT_D + 0.04, bevel=0.02)                  # plinth
    box("trim", 0, VAULT_H / 2 + 0.03, 0, VAULT_W, VAULT_H - 0.06, VAULT_D, bevel=0.04)
    box("metal", 0, VAULT_H - 0.015, 0, VAULT_W - 0.04, 0.03, VAULT_D - 0.04, bevel=0.01)     # top cap (y 1.4)
    box("metal", 0, 0.7, VAULT_D / 2 + 0.005, 1.52, 1.17, 0.02, bevel=0.01)                   # door recess frame


def vault_door():
    """Door on the vault's face; origin on the floor below the door's back face, door towards +z."""
    box("vault", 0, 0.7, 0.03, 1.4, 1.05, 0.06, bevel=0.02)
    cyl("metal", 0, 0.7, 0.07, 0.4, 0.03, segs=24, axis="z")
    cyl("vault", 0, 0.7, 0.09, 0.32, 0.02, segs=24, axis="z")
    for i in range(8):                                                                         # bolts
        a = i * math.pi / 4
        cyl("trim", math.cos(a) * 0.36, 0.7 + math.sin(a) * 0.36, 0.09, 0.022, 0.02, segs=8, axis="z")
    cyl("butter", 0, 0.7, 0.115, 0.05, 0.04, segs=12, axis="z")                               # wheel hub
    for i in range(3):                                                                         # spokes
        box("butter", 0, 0.7, 0.13, 0.42, 0.025, 0.02, rot_z=i * math.pi / 3, bevel=0.006)
    for i in range(12):                                                                        # rim
        a = i * math.pi / 6
        box("butter", math.cos(a) * 0.21, 0.7 + math.sin(a) * 0.21, 0.13, 0.03, 0.115, 0.025,
            rot_z=a, bevel=0.006)
    for y in (0.35, 1.05):                                                                     # hinges
        cyl("metal", -0.72, y, 0.04, 0.03, 0.14, segs=10)


def safe():
    box("trim", 0, 0.31, 0, 0.6, 0.62, 0.55, bevel=0.03)
    box("vault", 0, 0.33, 0.28, 0.48, 0.48, 0.02, bevel=0.01)
    cyl("butter", -0.08, 0.36, 0.3, 0.06, 0.025, segs=16, axis="z")
    box("metal", 0.14, 0.33, 0.3, 0.03, 0.16, 0.03, bevel=0.008)
    for side in (-1, 1):
        box("metal", side * 0.24, 0.015, 0, 0.06, 0.03, 0.45)


def meeting_table():
    """Rounded table 2.2 x 1.1 (top 0.76) with four chairs, as one set."""
    box("wood", 0, 0.73, 0, 2.2, 0.06, 1.1, bevel=0.05)
    for side in (-1, 1):
        box("panel", side * 0.7, 0.36, 0, 0.12, 0.7, 0.5, bevel=0.02)
        box("panel", side * 0.7, 0.02, 0, 0.18, 0.04, 0.8, bevel=0.01)
    for x, z, rot in ((-0.55, 0.85, math.pi), (0.55, 0.85, math.pi), (-0.55, -0.85, 0.0), (0.55, -0.85, 0.0)):
        before = len(parts)
        chair("lavender")
        place(parts[before:], x, z, rot)


def kitchen_counter():
    w, d, h = 1.6, 0.6, 0.88
    box("cream", 0, (h - 0.04) / 2, 0, w, h - 0.04, d, bevel=0.015)
    box("wood", 0, h - 0.02, 0.01, w + 0.04, 0.04, d + 0.04, bevel=0.012)                     # worktop
    for i in range(3):
        x = -w / 2 + w / 6 + i * w / 3
        box("mint", x, (h - 0.04) / 2 + 0.02, d / 2 + 0.006, w / 3 - 0.04, h - 0.14, 0.015, bevel=0.008)
        box("metal", x, h - 0.16, d / 2 + 0.02, 0.18, 0.02, 0.02)
    box("trim", 0, 0.03, 0.02, w - 0.02, 0.06, d - 0.04)                                       # toe kick
    box("metal", 0.35, h + 0.002, -0.02, 0.5, 0.006, 0.36)                                     # sink inset
    cyl("metal", 0.35, h + 0.12, -0.24, 0.015, 0.24, segs=8)                                   # tap


def kettle():
    cyl("cream", 0, 0.012, 0, 0.09, 0.024, segs=16)
    cyl("blush", 0, 0.12, 0, 0.085, 0.19, segs=16, r_top=0.065)
    cyl("trim", 0, 0.225, 0, 0.03, 0.02, segs=10)
    box("trim", -0.09, 0.15, 0, 0.025, 0.14, 0.03, bevel=0.008)
    box("trim", -0.06, 0.225, 0, 0.07, 0.02, 0.03, bevel=0.006)
    cyl("blush", 0.1, 0.13, 0, 0.018, 0.08, segs=8, rot_z=-0.9)                                # spout


def fridge():
    w, d, h = 0.7, 0.68, 1.8
    box("aqua", 0, h / 2 + 0.02, 0, w, h - 0.04, d, bevel=0.04)
    box("trim", 0, 0.02, 0, w - 0.06, 0.04, d - 0.06)
    box("cream", 0, 1.16, d / 2 + 0.002, w - 0.04, 0.006, 0.01)                                # door split
    for y0, y1 in ((0.12, 1.12), (1.2, 1.72)):
        box("metal", w / 2 - 0.08, (y0 + y1) / 2, d / 2 + 0.03, 0.03, min(0.4, y1 - y0 - 0.2), 0.03, bevel=0.01)
    box("blush", -0.12, 1.45, d / 2 + 0.006, 0.12, 0.14, 0.006, rot_z=0.1)                      # a note


PROPS = (
    ("desk", desk), ("chair", chair), ("monitor", monitor), ("keyboard", keyboard), ("desk_lamp", desk_lamp),
    ("filing_cabinet", filing_cabinet), ("bookshelf", bookshelf), ("plant_small", plant_small),
    ("plant_medium", plant_medium), ("plant_large", plant_large), ("whiteboard", whiteboard),
    ("wall_art", wall_art), ("rug", rug), ("mug", mug), ("tray", tray), ("vault_body", vault_body),
    ("vault_door", vault_door), ("safe", safe), ("meeting_table", meeting_table),
    ("kitchen_counter", kitchen_counter), ("kettle", kettle), ("fridge", fridge),
)
for name, build in PROPS:
    build()
    finish(name)

# ---- export -----------------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(True)
export_kwargs = dict(
    filepath=os.path.join(OUT, "deskkit.glb"), export_format="GLB", use_selection=True, export_apply=True,
    export_yup=True, export_lights=False, export_cameras=False, export_texcoords=False, export_normals=True,
    export_materials="EXPORT",
)
try:  # Blender 4.2+: vertex colours are exported only when asked for
    bpy.ops.export_scene.gltf(export_vertex_color="ACTIVE", **export_kwargs)
except TypeError:  # Blender 4.0/4.1
    bpy.ops.export_scene.gltf(export_colors=True, **export_kwargs)

with open(os.path.join(OUT, "deskkit.nodes.json"), "w") as fh:
    json.dump({"kit": "deskkit", "nodes": MANIFEST}, fh, indent=1, sort_keys=True)
faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print("DESKKIT_DONE", OUT, "nodes", len(MANIFEST), "faces", faces)
