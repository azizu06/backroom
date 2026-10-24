"""Lobby room: model, bake lighting to one lightmap, export a GLB.

Run (inside the sandbox, see tools/bake/README.md):
  blender --background --factory-startup --disable-autoexec --python lobby.py -- \
      --out /bake/out --size 2048 --samples 256 --threads 8

All coordinates in this file are the web scene's (three.js, Y up, metres). `B()` converts to Blender's Z-up.
The lobby sits at x -8..-2.5, z 1.3..5.5 in the office (web/lib/office/state.ts, web/app/office/scene.tsx).
Our own code only: no downloads, no network, no process spawning.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

# ---- cozy pastel palette ----------------------------------------------------------------------------------------
# These mirror web/lib/office/palette.ts (Blender's Python cannot import the TS module, so keep the two in sync).
# Rules: no pure black or white; shadows and ambient tint slate; warm butter key, cool aqua fill at low strength.
AQUA = "#9EF2FB"      # logo anchor: accents, cool fill
CREAM = "#FFF7EC"     # walls, ceiling
PEACH = "#F6D3B8"     # warm wood / floor, table
BUTTER = "#FFF0B3"    # warm light panels, key light
BLUSH = "#FFC9D9"     # rug, cushions, plant pot
LAVENDER = "#D9CCFF"  # sofa, accent wainscot
MINT = "#CDF2DC"      # plant
NAVY = "#4A5A7A"      # trim, door frames, outlines
SLATE = "#7C88A6"     # shadow / ambient tint

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- arguments (after the "--") -------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = arg("--out", os.path.join(os.getcwd(), "out"))
SIZE = int(arg("--size", "2048"))
SAMPLES = int(arg("--samples", "256"))
THREADS = int(arg("--threads", "0"))  # 0 = Blender decides
os.makedirs(OUT, exist_ok=True)

# ---- room dimensions (three.js metres) ------------------------------------------------------------------------
X0, X1 = -7.9, -2.55      # inner faces of west wall and east divider
Z0, Z1 = 1.3, 5.5         # inner faces of north wall (doorway to the aisle) and south edge
FLOOR_TOP = 0.048         # below the contact-shadow plane (y 0.05), above the room pad (0.045)
WALL_H = 2.8
WALL_T = 0.12
DOOR_X = (-5.8, -4.2)     # doorway in the north wall; agents walk through it


def B(x, y, z):
    """three.js (x, y up, z) -> Blender (x, -z, y up). The glTF exporter maps it back."""
    return (x, -z, y)


# ---- materials ------------------------------------------------------------------------------------------------
def make_material(name, color, roughness=0.85, brick=None, emit=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if emit > 0:  # self-lit surfaces (forest sky, lamp shades) bake as glowing
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    if brick:  # plank pattern for the floor, computed in the bake
        tex = nt.nodes.new("ShaderNodeTexBrick")
        tex.offset = 0.5
        tex.inputs["Scale"].default_value = 1.0
        tex.inputs["Color1"].default_value = (*brick[0], 1.0)
        tex.inputs["Color2"].default_value = (*brick[1], 1.0)
        tex.inputs["Mortar"].default_value = (*brick[2], 1.0)
        tex.inputs["Mortar Size"].default_value = 0.006
        tex.inputs["Brick Width"].default_value = 1.2
        tex.inputs["Row Height"].default_value = 0.16
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def hexlin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def mix(a, b, t):
    """Linear blend of two palette colours (already linear), t=0 -> a."""
    return tuple(x + (y - x) * t for x, y in zip(a, b))


MATS = {
    # Peach planks; alternate rows and the seams lean towards slate so the floor reads against cream walls.
    "floor": make_material("floor", hexlin(PEACH), 0.55,
                           brick=(hexlin(PEACH), mix(hexlin(PEACH), hexlin(SLATE), 0.12),
                                  mix(hexlin(PEACH), hexlin(SLATE), 0.45))),
    "wall_far": make_material("wall_far", hexlin(CREAM)),
    "wall_near": make_material("wall_near", hexlin(CREAM)),
    "ceiling": make_material("ceiling", hexlin(CREAM)),
    "trim": make_material("trim", hexlin(NAVY), 0.5),
    "wainscot": make_material("wainscot", hexlin(LAVENDER), 0.7),
    "rug": make_material("rug", hexlin(BLUSH), 1.0),
    "sofa": make_material("sofa", hexlin(LAVENDER), 0.95),
    "wood": make_material("wood", mix(hexlin(PEACH), hexlin(SLATE), 0.25), 0.5),
    "pot": make_material("pot", hexlin(BLUSH), 0.8),
    "plant": make_material("plant", hexlin(MINT), 0.9),
    "panel": make_material("panel", hexlin(BUTTER), 0.4),
    # Restyle (blender-r1): forest outside the west windows and real office props.
    "frame": make_material("frame", mix(hexlin(PEACH), hexlin(SLATE), 0.35), 0.45),
    "sill": make_material("sill", hexlin(CREAM), 0.5),
    "grass": make_material("grass", mix(hexlin(MINT), hexlin(SLATE), 0.15), 1.0),
    "tree": make_material("tree", mix(hexlin(MINT), hexlin(SLATE), 0.3), 0.9),
    "tree_dark": make_material("tree_dark", mix(hexlin(MINT), hexlin(NAVY), 0.45), 0.9),
    "trunk": make_material("trunk", mix(hexlin(PEACH), hexlin(NAVY), 0.5), 0.9),
    "sky": make_material("sky", mix(hexlin(AQUA), hexlin(CREAM), 0.35), 1.0, emit=0.55),
    "machine": make_material("machine", hexlin(NAVY), 0.35),
    "metal": make_material("metal", hexlin(SLATE), 0.3),
    "mug": make_material("mug", hexlin(CREAM), 0.4),
    "cooler": make_material("cooler", hexlin(AQUA), 0.2),
    "book_a": make_material("book_a", hexlin(BLUSH), 0.8),
    "book_b": make_material("book_b", hexlin(LAVENDER), 0.8),
    "book_c": make_material("book_c", hexlin(MINT), 0.8),
    "book_d": make_material("book_d", hexlin(BUTTER), 0.8),
    "book_e": make_material("book_e", mix(hexlin(NAVY), hexlin(LAVENDER), 0.3), 0.8),
    "art_a": make_material("art_a", hexlin(AQUA), 0.9),
    "art_b": make_material("art_b", hexlin(BLUSH), 0.9),
    "shade": make_material("shade", hexlin(BUTTER), 0.6, emit=0.6),
}

# ---- geometry -------------------------------------------------------------------------------------------------
scene = bpy.context.scene
parts = []


def box(mat, cx, cy, cz, sx, sy, sz, bevel=0.0, rot_y=0.0):
    """Axis-aligned box in three.js coordinates, optionally rotated about Y (radians)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)  # Blender axes: x, y(=three z), z(=three y)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    if rot_y:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(f"m_{mat}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(bpy.data.materials[mat])
    obj = bpy.data.objects.new(f"p_{mat}", mesh)
    scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = bevel > 0
    parts.append(obj)
    return obj


def _link(bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(f"m_{mat}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(bpy.data.materials[mat])
    obj = bpy.data.objects.new(f"p_{mat}", mesh)
    scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    parts.append(obj)
    return obj


def cyl(mat, cx, cy, cz, r, h, segs=16, r_top=None):
    """Vertical cylinder (or cone with r_top) standing centred at (cx, cy, cz) in three.js coordinates."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r_top is None else r_top, depth=h)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    return _link(bm, mat)


def ball(mat, cx, cy, cz, r, squash=1.0, segs=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r)
    bmesh.ops.scale(bm, vec=(1, 1, squash), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(cx, cy, cz), verts=bm.verts)
    return _link(bm, mat)


# Footprints (three.js x/z min/max) of baked props the player should not walk through; written next to the GLB.
COLLIDERS = []


def solid(name, cx, cz, sx, sz):
    COLLIDERS.append({"name": name, "minX": round(cx - sx / 2, 3), "maxX": round(cx + sx / 2, 3),
                      "minZ": round(cz - sz / 2, 3), "maxZ": round(cz + sz / 2, 3)})


SILL_Y, HEAD_Y = 0.95, 2.35
WINDOWS = ((1.8, 3.15), (3.45, 4.9))   # z spans of the two west windows


def west_wall_with_windows(cz, d):
    """West wall as solid pieces around two large windows, with frames, mullions and a sill."""
    x = X0 - WALL_T / 2
    za, zb = Z0 - WALL_T, Z1 + WALL_T
    box("wall_far", x, SILL_Y / 2, cz, WALL_T, SILL_Y, d + WALL_T)                         # below sills
    box("wall_far", x, (HEAD_Y + WALL_H) / 2, cz, WALL_T, WALL_H - HEAD_Y, d + WALL_T)     # above heads
    edges = [za] + [z for span in WINDOWS for z in span] + [zb]
    for z0, z1 in zip(edges[0::2], edges[1::2]):                                         # piers
        box("wall_far", x, (SILL_Y + HEAD_Y) / 2, (z0 + z1) / 2, WALL_T, HEAD_Y - SILL_Y, z1 - z0)
    for z0, z1 in WINDOWS:
        zm, h = (z0 + z1) / 2, HEAD_Y - SILL_Y
        for zz in (z0, z1):
            box("frame", x, (SILL_Y + HEAD_Y) / 2, zz, WALL_T + 0.06, h, 0.07, bevel=0.012)
        for yy in (SILL_Y, HEAD_Y):
            box("frame", x, yy, zm, WALL_T + 0.06, 0.07, z1 - z0 + 0.07, bevel=0.012)
        box("frame", x, (SILL_Y + HEAD_Y) / 2, zm, 0.05, h, 0.035, bevel=0.008)          # mullion
        box("frame", x, SILL_Y + h * 0.62, zm, 0.05, 0.035, z1 - z0, bevel=0.008)        # transom
        box("sill", X0 + 0.07, SILL_Y - 0.02, zm, 0.2, 0.04, z1 - z0 + 0.2, bevel=0.01)


def tree(x, z, h, dark=False):
    cyl("trunk", x, h * 0.12, z, 0.07 + h * 0.01, h * 0.24, segs=8)
    m = "tree_dark" if dark else "tree"
    for i, (r, y) in enumerate(((0.75, 0.42), (0.58, 0.62), (0.4, 0.8))):
        cyl(m, x, h * y, z, r * h / 3.2, h * 0.32, segs=10, r_top=0.02)


def forest():
    """A stylized forest outside the west windows: grass, a few rings of cone trees, a soft sky wall."""
    box("grass", -13.5, -0.02, 3.4, 11.0, 0.04, 16.0)
    trees = [(-9.6, 2.2, 3.0, False), (-10.2, 4.3, 3.6, True), (-9.4, 5.6, 2.6, False), (-10.8, 1.0, 3.3, False),
             (-11.4, 3.2, 4.2, False), (-12.0, 5.2, 3.8, True), (-11.6, -0.6, 3.9, True), (-12.8, 1.9, 4.6, True),
             (-13.4, 4.1, 4.4, False), (-13.9, 6.6, 4.0, True), (-14.6, 0.4, 4.8, False), (-15.2, 2.9, 5.0, True),
             (-15.6, 5.4, 4.6, False), (-10.6, 7.0, 3.4, False), (-12.6, -1.8, 4.2, False)]
    for x, z, h, dark in trees:
        tree(x, z, h, dark)
    box("sky", -17.5, 3.0, 3.4, 0.1, 7.0, 18.0)


def props():
    """Real office props, rounded rather than blocky, kept clear of the procedural audit board, inbox counter,
    shelf and plant (see the note in build()) and of the walk from the doorway."""
    # Coffee corner against the south wall, east side: cabinet, machine, mugs.
    cab_x, cab_z = -3.35, 5.18
    box("wood", cab_x, 0.45, cab_z, 1.3, 0.86, 0.5, bevel=0.03)
    box("sill", cab_x, 0.9, cab_z, 1.36, 0.04, 0.56, bevel=0.012)
    for dx in (-0.32, 0.32):
        box("frame", cab_x + dx, 0.6, cab_z - 0.255, 0.18, 0.025, 0.01, bevel=0.005)          # handles
    mx = cab_x - 0.3
    box("machine", mx, 1.14, cab_z + 0.05, 0.34, 0.44, 0.34, bevel=0.05)                      # body
    box("metal", mx, 1.02, cab_z - 0.1, 0.16, 0.05, 0.14, bevel=0.01)                         # drip tray
    cyl("metal", mx, 1.3, cab_z - 0.12, 0.03, 0.06, segs=10)                                  # spout
    cyl("cooler", mx + 0.08, 1.4, cab_z + 0.12, 0.06, 0.06, segs=12)                          # bean hopper lid
    for i, dx in enumerate((0.05, 0.2, 0.35)):
        cyl("mug" if i != 1 else "book_a", cab_x + dx, 0.97, cab_z - 0.05 + i * 0.04, 0.045, 0.1, segs=14)
    solid("coffee_cabinet", cab_x, cab_z, 1.36, 0.56)
    # Water cooler beside it.
    wx, wz = -4.35, 5.25
    box("sill", wx, 0.5, wz, 0.34, 1.0, 0.34, bevel=0.04)
    cyl("cooler", wx, 1.2, wz, 0.15, 0.4, segs=18, r_top=0.1)
    solid("water_cooler", wx, wz, 0.38, 0.38)
    # Bookshelf against the north wall, east of the doorway, with varied books.
    bx, bz, bw = -3.35, Z0 + 0.17, 1.3
    # Open-fronted case: back, sides and top, so the books show.
    box("wood", bx, 0.95, Z0 + 0.03, bw, 1.8, 0.04, bevel=0.01)                              # back panel
    for sx in (bx - bw / 2 + 0.02, bx + bw / 2 - 0.02):
        box("wood", sx, 0.95, bz, 0.04, 1.8, 0.3, bevel=0.012)                              # sides
    box("wood", bx, 1.86, bz, bw, 0.04, 0.32, bevel=0.012)                                  # top
    shelves = (0.12, 0.55, 0.98, 1.41)
    for y in shelves:
        box("sill", bx, y + 0.02, bz + 0.01, bw - 0.08, 0.03, 0.27, bevel=0.006)
    books = ("book_a", "book_b", "book_c", "book_d", "book_e")
    k = 0
    for row, y in enumerate(shelves[:-1] + (1.41,)):
        x = bx - bw / 2 + 0.08
        while x < bx + bw / 2 - 0.12:
            k += 1
            t = 0.035 + (k * 37 % 5) * 0.008
            hgt = 0.22 + (k * 53 % 7) * 0.02
            tilt = 0.25 if k % 11 == 0 else 0.0
            box(books[k % len(books)], x + t / 2, y + 0.035 + hgt / 2, bz - 0.01, t, hgt, 0.2, bevel=0.004, rot_y=0.0)
            x += t + (0.06 if tilt else 0.004)
            if k % 13 == 0:
                x += 0.12  # a gap now and then
    solid("bookshelf", bx, bz, bw, 0.32)
    # Tall floor plant in a rounded pot by the east wall.
    px, pz = -2.95, 2.0
    cyl("pot", px, 0.22, pz, 0.2, 0.42, segs=16, r_top=0.24)
    for (dx, dy, dz, r) in ((0, 0.75, 0, 0.3), (0.12, 1.0, 0.06, 0.22), (-0.1, 1.08, -0.05, 0.2), (0.02, 1.28, 0, 0.16)):
        ball("plant", px + dx, dy, pz + dz, r, squash=0.85)
    solid("floor_plant", px, pz, 0.5, 0.5)
    # Wall art: two framed prints on the north wall west of the doorway, one on the south wall.
    for (ax, w, h, m) in ((-7.2, 0.6, 0.75, "art_a"), (-6.45, 0.45, 0.55, "art_b")):
        box("frame", ax, 1.75, Z0 + 0.03, w + 0.06, h + 0.06, 0.03, bevel=0.01)
        box(m, ax, 1.75, Z0 + 0.05, w, h, 0.01)
    box("frame", -6.2, 1.7, Z1 - 0.03, 1.06, 0.66, 0.03, bevel=0.01)
    box("art_b", -6.2, 1.7, Z1 - 0.05, 1.0, 0.6, 0.01)
    # Desk lamp on the coffee table, with a glowing shade.
    cyl("metal", -6.38, 0.4, 2.62, 0.06, 0.02, segs=12)
    cyl("metal", -6.38, 0.52, 2.62, 0.012, 0.24, segs=8)
    cyl("shade", -6.38, 0.68, 2.62, 0.1, 0.1, segs=16, r_top=0.06)
    # Cushions on the sofa.
    for z in (2.85, 3.65):
        box("rug", -7.55, 0.6, z, 0.16, 0.34, 0.38, bevel=0.07, rot_y=0.15)
    solid("sofa", -7.5, 3.25, 0.85, 1.9)
    solid("coffee_table", -6.55, 2.45, 0.72, 0.52)


def build():
    w, d = X1 - X0, Z1 - Z0
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    # Floor (planks come from the floor material) and a darker border so the room reads as set into the slab.
    box("floor", cx, FLOOR_TOP - 0.02, cz, w + 0.3, 0.04, d + 0.1)
    # Ceiling (hidden by the web layer in the orthographic overview).
    box("ceiling", cx, WALL_H + 0.03, cz, w + 0.3, 0.06, d + 0.3)
    # Far walls: west and north (north has a doorway). Near walls: east and south.
    west_wall_with_windows(cz, d)
    nx0, nx1 = X0 - WALL_T, X1 + WALL_T
    box("wall_far", (nx0 + DOOR_X[0]) / 2, WALL_H / 2, Z0 - WALL_T / 2, DOOR_X[0] - nx0, WALL_H, WALL_T)
    box("wall_far", (DOOR_X[1] + nx1) / 2, WALL_H / 2, Z0 - WALL_T / 2, nx1 - DOOR_X[1], WALL_H, WALL_T)
    lintel_h = 0.55
    box("wall_far", sum(DOOR_X) / 2, WALL_H - lintel_h / 2, Z0 - WALL_T / 2, DOOR_X[1] - DOOR_X[0], lintel_h, WALL_T)
    box("wall_near", X1 + WALL_T / 2, WALL_H / 2, cz, WALL_T, WALL_H, d + WALL_T)
    box("wall_near", cx, WALL_H / 2, Z1 + WALL_T / 2, w + WALL_T * 2, WALL_H, WALL_T)
    # Wainscot panels and skirting on the walls the camera looks at, plus rounded door frame.
    box("wainscot", X0 + 0.02, 0.5, cz, 0.04, 0.9, d - 0.05, bevel=0.012)
    box("wainscot", (X0 + DOOR_X[0]) / 2 + 0.05, 0.5, Z0 + 0.02, DOOR_X[0] - X0 - 0.1, 0.9, 0.04, bevel=0.012)
    box("wainscot", (DOOR_X[1] + X1) / 2, 0.5, Z0 + 0.02, X1 - DOOR_X[1], 0.9, 0.04, bevel=0.012)
    box("trim", X0 + 0.03, FLOOR_TOP + 0.07, cz, 0.06, 0.14, d, bevel=0.015)
    box("trim", cx, 0.97, Z0 + 0.03, w, 0.05, 0.06, bevel=0.012)  # chair rail, north
    for dx in DOOR_X:
        box("trim", dx, WALL_H / 2 - lintel_h / 2, Z0 - 0.0, 0.1, WALL_H - lintel_h, WALL_T + 0.04, bevel=0.02)
    box("trim", sum(DOOR_X) / 2, WALL_H - lintel_h - 0.04, Z0, DOOR_X[1] - DOOR_X[0] + 0.2, 0.1, WALL_T + 0.04, bevel=0.02)
    # Crown moulding all round.
    for (px, pz, sx, sz) in ((cx, Z0, w, 0.08), (X0, cz, 0.08, d), (cx, Z1, w, 0.08), (X1, cz, 0.08, d)):
        box("trim", px, WALL_H - 0.06, pz, sx, 0.12, sz, bevel=0.02)
    # Props kept at desk height or lower and clear of the procedural audit board (x -6.9..-4.9, z 3.9),
    # paper stack (-4.4, 3.1), shelf (west wall, z 1.2..2.4) and plant (-7.4, 4.95).
    box("rug", -4.5, FLOOR_TOP + 0.007, 2.45, 2.5, 0.014, 1.5, bevel=0.005)
    box("rug", -4.5, FLOOR_TOP + 0.015, 2.45, 2.1, 0.012, 1.1, bevel=0.005)
    # Sofa against the west wall.
    box("sofa", -7.5, 0.28, 3.25, 0.8, 0.4, 1.7, bevel=0.11)        # seat
    box("sofa", -7.76, 0.62, 3.25, 0.28, 0.5, 1.7, bevel=0.11)      # back
    for z in (2.43, 4.07):
        box("sofa", -7.5, 0.4, z, 0.8, 0.5, 0.2, bevel=0.07)        # arms
    # Low coffee table on the rug.
    box("wood", -6.55, 0.35, 2.45, 0.7, 0.05, 0.5, bevel=0.015)
    for (dx, dz) in ((-0.28, -0.18), (0.28, -0.18), (-0.28, 0.18), (0.28, 0.18)):
        box("wood", -6.55 + dx, 0.17, 2.45 + dz, 0.05, 0.34, 0.05, bevel=0.01)
    # Small potted plant on the coffee table: blush pot, mint leaves.
    box("pot", -6.68, 0.43, 2.45, 0.12, 0.11, 0.12, bevel=0.012)
    box("plant", -6.68, 0.54, 2.45, 0.16, 0.12, 0.16, bevel=0.04)
    box("plant", -6.66, 0.63, 2.44, 0.1, 0.1, 0.1, bevel=0.03, rot_y=0.6)
    # Ceiling light panels (emissive in the bake) and the ceiling lamps' housings.
    for px in (-6.4, -4.1):
        box("panel", px, WALL_H - 0.02, 3.4, 0.9, 0.04, 1.5, bevel=0.01)
    forest()
    props()


build()

# ---- one object, one non-overlapping UV layout --------------------------------------------------------------
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
shell = bpy.context.view_layer.objects.active
shell.name = "lobby"
# Merge slots with identical materials after join.
bpy.ops.object.material_slot_remove_unused()
mesh = shell.data
mesh.uv_layers.new(name="lightmap")
mesh.uv_layers.active = mesh.uv_layers["lightmap"]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# ---- bake target + one image node in every material ----------------------------------------------------------
img = bpy.data.images.new("lobby_lightmap", SIZE, SIZE, alpha=False)
img.colorspace_settings.name = "sRGB"
for slot in shell.material_slots:
    nt = slot.material.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.nodes.active = node
    node.select = True

# ---- lights + world --------------------------------------------------------------------------------------------
world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (*mix(hexlin(SLATE), hexlin(CREAM), 0.35), 1.0)  # slate-tinted ambient
bg.inputs["Strength"].default_value = 0.28
scene.world = world


def area(name, loc, size, energy, color, rot=(0, 0, 0), shape="RECTANGLE", size_y=None):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color, data.shape, data.size = energy, color, shape, size
    if size_y:
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    obj.location, obj.rotation_euler = B(*loc), rot
    scene.collection.objects.link(obj)


# Energies are low on purpose: the web layer draws the lightmap unlit and untonemapped, and the pastel albedos
# sit near white, so brighter lights clip cream walls to white.
# Warm butter key: the two ceiling panels, pointing down. Area lights face -Z by default (down in Blender).
for px in (-6.4, -4.1):
    area(f"key_{px}", (px, WALL_H - 0.06, 3.4), 0.9, 45, hexlin(BUTTER), size_y=1.5)
# Cool aqua fill at low strength: a big soft light low in the south-east corner, aimed across the room.
area("fill", (-3.0, 1.9, 5.0), 2.0, 26, hexlin(AQUA), rot=(math.radians(-60), 0, math.radians(135)), size_y=2.0)
# Warm window light: a soft butter sun from the forest side, through the west windows (blender-r1).
sun = bpy.data.lights.new("window_sun", "SUN")
sun.energy, sun.color, sun.angle = 1.1, hexlin(BUTTER), math.radians(8)
sun_obj = bpy.data.objects.new("window_sun", sun)
sun_obj.rotation_euler = (math.radians(58), 0, math.radians(-75))
scene.collection.objects.link(sun_obj)
for zm in [sum(span) / 2 for span in WINDOWS]:
    area(f"window_{zm}", (X0 - 0.3, (SILL_Y + HEAD_Y) / 2, zm), 1.3, 18, hexlin(BUTTER),
         rot=(0, math.radians(-90), 0), size_y=1.3)
# A narrow warm accent over the door so the corridor edge has a gradient.
area("door_glow", (-5.0, 2.2, Z0 + 0.4), 1.2, 12, hexlin(BUTTER), rot=(math.radians(180), 0, 0), size_y=0.3)

# ---- Cycles: CPU, no denoising (Blender 4.0.2 here has no OIDN) -------------------------------------------------
scene.render.engine = "CYCLES"
cy = scene.cycles
cy.device = "CPU"
cy.samples = SAMPLES
cy.use_denoising = False
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.01
cy.max_bounces = 6
cy.diffuse_bounces = 4
cy.glossy_bounces = 2
cy.sample_clamp_indirect = 3.0
cy.bake_type = "COMBINED"
if THREADS > 0:
    scene.render.threads_mode = "FIXED"
    scene.render.threads = THREADS
scene.view_settings.view_transform = "Standard"
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = True
scene.render.bake.margin = 8
scene.render.bake.margin_type = "EXTEND"

bpy.ops.object.select_all(action="DESELECT")
shell.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.object.bake(type="COMBINED")

# ---- save the lightmap, split nodes the web layer toggles, export -------------------------------------------------
img.filepath_raw = os.path.join(OUT, "lobby_lightmap.png")
img.file_format = "PNG"
img.save()

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")

final = bpy.data.materials.new("lobby_baked")
final.use_nodes = True
fnt = final.node_tree
fbsdf = fnt.nodes["Principled BSDF"]
fbsdf.inputs["Roughness"].default_value = 1.0
ftex = fnt.nodes.new("ShaderNodeTexImage")
ftex.image = img
fnt.links.new(ftex.outputs["Color"], fbsdf.inputs["Base Color"])

group_of = {"wall_far": "wall_far", "wall_near": "wall_near", "ceiling": "ceiling"}
objs = [o for o in bpy.data.objects if o.type == "MESH"]
keep = {}
for o in objs:
    # Separated objects may keep the full slot list, so read the material of the first face.
    slot_name = o.material_slots[o.data.polygons[0].material_index].material.name
    o.name = group_of.get(slot_name, "shell_" + slot_name)
    keep[o.name] = o
# Merge every non-toggled piece back into one "shell" node so the GLB has few draws.
shell_parts = [o for n, o in keep.items() if n.startswith("shell_")]
bpy.ops.object.select_all(action="DESELECT")
for o in shell_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = shell_parts[0]
bpy.ops.object.join()
bpy.context.view_layer.objects.active.name = "shell"
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    o.data.materials.clear()
    o.data.materials.append(final)
    o.data.name = o.name
    o.data.uv_layers.active = o.data.uv_layers["lightmap"]
    for layer in list(o.data.uv_layers):
        if layer.name != "lightmap":
            o.data.uv_layers.remove(layer)
    o.select_set(True)

bpy.ops.object.select_all(action="SELECT")
export_kwargs = dict(
    filepath=os.path.join(OUT, "lobby.glb"), export_format="GLB", use_selection=True,
    export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
    export_image_format="WEBP", export_texcoords=True, export_normals=True,
)
try:
    bpy.ops.export_scene.gltf(export_jpeg_quality=88, **export_kwargs)
except TypeError:
    bpy.ops.export_scene.gltf(**export_kwargs)
print("BAKE_DONE", OUT)

# Baked prop footprints for the web layer's Play colliders (blender-r1).
import json  # noqa: E402  (stdlib; writes one local file)
with open(os.path.join(OUT, "lobby.colliders.json"), "w") as fh:
    json.dump({"room": "lobby", "boxes": COLLIDERS}, fh, indent=1)
print("COLLIDERS", len(COLLIDERS))
