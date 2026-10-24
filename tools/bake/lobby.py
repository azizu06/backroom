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
from mathutils import Matrix, Vector

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


def fogged(c, t):
    """Aerial perspective: pull a colour towards the warm haze by t (0 = near, 1 = lost in the haze)."""
    return mix(c, FOG, t)


# Warm haze between aqua sky and cream, nudged towards butter; derived only from palette colours.
FOG = mix(mix(hexlin(AQUA), hexlin(CREAM), 0.5), hexlin(BUTTER), 0.3)
TREE = mix(hexlin(MINT), hexlin(SLATE), 0.3)
TREE_DARK = mix(hexlin(MINT), hexlin(NAVY), 0.45)
SKY_TOP_Y = 12.0  # three.js y where the sky gradient reaches its top colour


def sky_material():
    """Self-lit sky with a vertical gradient: warm blush-butter at the treeline, cream, then soft aqua overhead.
    Uses the object's Z (three.js y); every part is joined into one object at the origin before the bake."""
    horizon = mix(hexlin(BUTTER), hexlin(BLUSH), 0.35)
    low = mix(hexlin(BUTTER), hexlin(CREAM), 0.5)
    high = mix(hexlin(CREAM), hexlin(AQUA), 0.45)
    top = mix(hexlin(AQUA), hexlin(CREAM), 0.2)
    mat = make_material("sky", low, 1.0, emit=0.6)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    scale = nt.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.use_clamp = True
    scale.inputs[1].default_value = 1.0 / SKY_TOP_Y
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    elems = ramp.color_ramp.elements
    elems[0].position, elems[0].color = 0.0, (*horizon, 1.0)
    elems[1].position, elems[1].color = 1.0, (*top, 1.0)
    for pos, col in ((0.36, low), (0.68, high)):
        e = elems.new(pos)
        e.color = (*col, 1.0)
    nt.links.new(coord.outputs["Object"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], scale.inputs[0])
    nt.links.new(scale.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
    return mat


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
    "tree": make_material("tree", TREE, 0.9),
    "tree_dark": make_material("tree_dark", TREE_DARK, 0.9),
    "trunk": make_material("trunk", mix(hexlin(PEACH), hexlin(NAVY), 0.5), 0.9),
    # Forest r2: depth comes from aerial perspective. Each band further out leans towards a warm haze (FOG) and
    # glows a little more, so the rings read as distance rather than as one flat wall.
    "bush": make_material("bush", mix(hexlin(MINT), hexlin(SLATE), 0.18), 0.95),
    "tree_mid": make_material("tree_mid", fogged(mix(TREE, TREE_DARK, 0.5), 0.32), 0.95, emit=0.08),
    "trunk_mid": make_material("trunk_mid", fogged(mix(hexlin(PEACH), hexlin(NAVY), 0.5), 0.35), 0.95),
    "tree_far": make_material("tree_far", fogged(TREE_DARK, 0.55), 1.0, emit=0.18),
    "tree_haze": make_material("tree_haze", fogged(TREE_DARK, 0.74), 1.0, emit=0.3),
    "hill": make_material("hill", fogged(mix(hexlin(MINT), hexlin(SLATE), 0.15), 0.82), 1.0, emit=0.36),
    "mist": make_material("mist", FOG, 1.0, emit=0.45),
    "grass_mid": make_material("grass_mid", fogged(mix(hexlin(MINT), hexlin(SLATE), 0.15), 0.35), 1.0),
    "grass_far": make_material("grass_far", fogged(mix(hexlin(MINT), hexlin(SLATE), 0.15), 0.62), 1.0, emit=0.15),
    # Outermost ground band: nearly lost in the haze, so the disc edge feathers out instead of ending as a slab.
    "ground_haze": make_material("ground_haze", fogged(mix(hexlin(MINT), hexlin(SLATE), 0.15), 0.88), 1.0, emit=0.35),
    "sky": sky_material(),
    # Glass hint: hairline streaks on the panes (the GLB is one opaque lightmapped material, so no real glass).
    # Low contrast on purpose: haze-tinted towards the frame and sky, unlit, so they read as a reflection hint.
    "glint": make_material("glint", mix(FOG, mix(hexlin(PEACH), hexlin(SLATE), 0.35), 0.25), 0.6),
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
    # Lobby detail r2: second plant tone, clock face, ceiling lights (the ceiling-light materials join the
    # "ceiling" node so they hide with it in the overview, see GROUP_OF).
    "plant_dark": make_material("plant_dark", mix(hexlin(MINT), hexlin(SLATE), 0.22), 0.9),
    "clock_face": make_material("clock_face", hexlin(CREAM), 0.35),
    "downlight": make_material("downlight", hexlin(BUTTER), 0.4, emit=0.8),
    "lamp_rim": make_material("lamp_rim", hexlin(CREAM), 0.4),
    "pendant": make_material("pendant", mix(hexlin(BUTTER), hexlin(PEACH), 0.3), 0.5, emit=0.12),
    "cord": make_material("cord", hexlin(NAVY), 0.6),
}

# ---- geometry -------------------------------------------------------------------------------------------------
scene = bpy.context.scene
parts = []


def _rotate(bm, rot_x=0.0, rot_y=0.0, rot_z=0.0):
    """Rotate about the origin by three.js-axis angles (x, then z, then y). B() is a proper rotation, so a
    three.js axis a maps to Blender axis B(a): x -> X, y -> Z, z -> -Y."""
    if rot_x:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_x, 3, "X"), verts=bm.verts)
    if rot_z:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-rot_z, 3, "Y"), verts=bm.verts)
    if rot_y:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)


def box(mat, cx, cy, cz, sx, sy, sz, bevel=0.0, rot_y=0.0, rot_x=0.0, rot_z=0.0):
    """Box in three.js coordinates, optionally rotated about three.js x, z, then y (radians)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)  # Blender axes: x, y(=three z), z(=three y)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    _rotate(bm, rot_x, rot_y, rot_z)
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


def _link(bm, mat, recalc=True, smooth=True):
    if recalc:  # closed solids only; open cards keep the winding set by _face_towards
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(f"m_{mat}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(bpy.data.materials[mat])
    obj = bpy.data.objects.new(f"p_{mat}", mesh)
    scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    parts.append(obj)
    return obj


def cyl(mat, cx, cy, cz, r, h, segs=16, r_top=None, axis="y", rot_x=0.0, rot_z=0.0):
    """Cylinder (or cone with r_top) centred at (cx, cy, cz) in three.js coordinates. axis "y" stands it up,
    "z" points it out of a north/south wall, "x" out of an east/west wall; rot_x/rot_z tilt a standing one."""
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


def _face_towards(bm, target):
    """Wind every face of an open card so its front (the side three.js draws) faces target (three.js)."""
    bm.normal_update()
    t = Vector(B(*target))
    flip = [f for f in bm.faces if f.normal.dot(t - f.calc_center_median()) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)


# Footprints (three.js x/z min/max) of baked props the player should not walk through; written next to the GLB.
COLLIDERS = []


def solid(name, cx, cz, sx, sz):
    COLLIDERS.append({"name": name, "minX": round(cx - sx / 2, 3), "maxX": round(cx + sx / 2, 3),
                      "minZ": round(cz - sz / 2, 3), "maxZ": round(cz + sz / 2, 3)})


SILL_Y, HEAD_Y = 0.95, 2.35
DOWNLIGHTS = ((-7.35, 1.85), (-7.35, 4.95), (-2.95, 1.9), (-2.95, 3.3))
PENDANTS = ((-3.8, 4.85), (-3.0, 4.85))
PENDANT_Y = 2.08  # bottom of the shade sits above a standing player's eye
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
        # Glass hint: one short hairline pair high in each lower pane, just inside the pane plane.
        gx, ty = x + 0.012, SILL_Y + h * 0.62
        for pz in ((z0 + zm) / 2, (zm + z1) / 2):
            box("glint", gx, ty - 0.16, pz - 0.05, 0.003, 0.16, 0.007, rot_x=0.6)
            box("glint", gx, ty - 0.22, pz + 0.01, 0.003, 0.08, 0.006, rot_x=0.6)


# ---- forest (r2): layered rings around a centre west of the lobby, so every window angle sees depth ----------
FOREST_C = (-6.0, 3.4)        # ring centre (three.js x, z), on the lobby's mid line
FOREST_EYE = (-5.0, 1.5, 3.4)  # cards and the sky face this point (inside the lobby)
OUTSIDE_X = X0 - WALL_T - 0.1  # nothing of the forest comes closer than this to the west wall


def jit(i, k):
    """Deterministic 0..1 jitter (no random module): a hashed sine."""
    v = math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return v - math.floor(v)


def polar(r, a):
    """Ring point: a = 0 is due west of FOREST_C, positive a towards +z (south)."""
    return FOREST_C[0] - r * math.cos(a), FOREST_C[1] + r * math.sin(a)


def max_angle(r, clear):
    """Largest ring angle at radius r that keeps a point `clear` metres west of the wall."""
    c = (FOREST_C[0] - OUTSIDE_X + clear) / r
    return min(math.radians(60), math.acos(min(1.0, c)))


def arc_grid(mat, a0, a1, segs, rows):
    """Open curved surface: rows(i) -> [(r, y), ...] bottom to top for column i, faced towards FOREST_EYE."""
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        col = []
        for r, y in rows(i):
            x, z = polar(r, a)
            col.append(bm.verts.new(B(x, y, z)))
        cols.append(col)
    for c0, c1 in zip(cols, cols[1:]):
        for j in range(len(c0) - 1):
            bm.faces.new((c0[j], c1[j], c1[j + 1], c0[j + 1]))
    _face_towards(bm, FOREST_EYE)
    return _link(bm, mat, recalc=False, smooth=False)


def fir_card(mat, r, a, w, h):
    """Flat two-tier fir silhouette standing on the ring at angle a, for the far treeline."""
    x, z = polar(r, a)
    tx, tz = math.sin(a), math.cos(a)  # ring tangent
    outline = ((-0.5, 0.0), (0.5, 0.0), (0.22, 0.45), (0.36, 0.45), (0.0, 1.0), (-0.36, 0.45), (-0.22, 0.45))
    bm = bmesh.new()
    verts = [bm.verts.new(B(x + tx * u * w, v * h, z + tz * u * w)) for u, v in outline]
    bm.faces.new(verts)
    _face_towards(bm, FOREST_EYE)
    return _link(bm, mat, recalc=False, smooth=False)


def fir(x, z, h, mat, trunk="trunk", segs=10, tiers=3):
    """Low-poly cone tree: a trunk and stacked tapering tiers."""
    cyl(trunk, x, h * 0.12, z, 0.07 + h * 0.01, h * 0.24, segs=max(5, segs - 2))
    rings = ((0.75, 0.42, 0.32), (0.58, 0.62, 0.32), (0.4, 0.8, 0.32)) if tiers == 3 else ((0.7, 0.45, 0.42), (0.45, 0.72, 0.42))
    for r, y, d in rings:
        cyl(mat, x, h * y, z, r * h / 3.2, h * d, segs=segs, r_top=0.02)


def round_tree(x, z, h, mat, trunk="trunk"):
    """Deciduous accent: trunk and two soft canopy balls."""
    cyl(trunk, x, h * 0.2, z, 0.08, h * 0.4, segs=8)
    ball(mat, x, h * 0.58, z, h * 0.26, squash=0.9, segs=10)
    ball(mat, x + 0.12, h * 0.78, z - 0.05, h * 0.18, squash=0.9, segs=10)


def ring(n, r0, r1, clear, seed):
    """n jittered (x, z, t) spots between radii r0..r1 that stay `clear` metres off the wall; t in 0..1."""
    spots = []
    for i in range(n):
        r = r0 + (r1 - r0) * jit(i, seed)
        amax = max_angle(r, clear)
        a = -amax + 2 * amax * (i + 0.2 + 0.6 * jit(i, seed + 1)) / n
        x, z = polar(r, a)
        spots.append((x, z, jit(i, seed + 2)))
    return spots


HILL_R = 10.6  # the ground stops under the hills; nothing past them is visible from inside


def ground_band(mat, r0, r1, y, segs=28):
    """Flat annular band r0..r1 at height y, trimmed along each ray to the strip west of the wall line."""
    xw = OUTSIDE_X + 0.1
    rw = FOREST_C[0] - xw  # ray length from FOREST_C to the wall line at angle 0
    amax = min(math.radians(62), math.acos(rw / r1) - 1e-3)  # a touch wider than the tree rings (60 deg)
    a0 = -amax

    def rows(i):
        a = a0 + 2 * amax * i / segs
        return ((max(r0, rw / math.cos(a)), y), (r1, y))
    return arc_grid(mat, a0, amax, segs, rows)


def forest():
    """A stylized forest beyond the west windows with real depth: graded ground, a near band of detailed trees
    and bushes, a mid band, a far band, a flat treeline and hills lost in warm haze, mist banks, a sky dome."""
    # Ground: a half-disc of concentric bands around FOREST_C, cut straight at the wall line, each band fogged a
    # little more and the last one nearly haze, so from above it ends in a soft circle rather than a slab.
    for mat, r0, r1, y in (("grass", 0.0, 5.6, -0.02), ("grass_mid", 5.6, 7.3, -0.025),
                           ("grass_far", 7.3, 9.2, -0.03), ("ground_haze", 9.2, HILL_R, -0.035)):
        ground_band(mat, r0, r1, y)
    # Band 1 (near, ~1.5-3 m past the glass): bushes along the front, detailed firs and round trees.
    for i, (x, z, t) in enumerate(ring(9, 3.3, 3.7, 0.55, 11)):
        ball("bush", x, 0.22, z, 0.32 + 0.18 * t, squash=0.7, segs=10)
    for i, (x, z, t) in enumerate(ring(8, 4.3, 5.2, 0.95, 21)):
        h = 2.6 + 1.2 * t
        if i % 3 == 1:
            round_tree(x, z, h * 0.9, "tree")
        else:
            fir(x, z, h, "tree_dark" if i % 2 else "tree")
    # Band 2 (mid): fewer segments, first step of haze.
    for i, (x, z, t) in enumerate(ring(10, 5.9, 6.6, 1.0, 31)):
        fir(x, z, 3.2 + 1.2 * t, "tree_mid", trunk="trunk_mid", segs=8)
    # Band 3 (far, thinned): two-tier firs, more haze and a little glow.
    for i, (x, z, t) in enumerate(ring(9, 7.5, 8.2, 1.0, 41)):
        fir(x, z, 3.4 + 1.2 * t, "tree_far", trunk="tree_far", segs=6, tiers=2)
    # Low mist bank between bands 2 and 3, veiling the far trunks.
    a3 = max_angle(7.15, 0.5)
    arc_grid("mist", -a3, a3, 16, lambda i: ((7.15, -0.02), (7.15, 0.35 + 0.25 * jit(i, 51))))
    # Band 4: flat fir silhouettes on two staggered radii (no coplanar overlap) over a continuous body strip.
    a4 = max_angle(9.4, 0.5)
    n4 = 18
    for i in range(n4):
        a = -a4 + 2 * a4 * (i + 0.5) / n4
        fir_card("tree_haze", 9.4 + 0.14 * (i % 2), a, 1.4 + 0.5 * jit(i, 61), 3.0 + 1.6 * jit(i, 62))
    arc_grid("tree_haze", -a4, a4, 20, lambda i: ((9.75, -0.02), (9.75, 1.2 + 0.35 * jit(i, 63))))
    # Band 5: rolling hills just in front of the sky.
    a5 = max_angle(HILL_R, 0.5)
    arc_grid("hill", -a5, a5, 24, lambda i: ((HILL_R, -0.02), (HILL_R, 2.0 + 0.8 * math.sin(i * 0.6) + 0.5 * jit(i, 71))))
    # Sky dome: curved and leaning in at the top so even a glance up through the glass stays inside the gradient.
    a6 = max_angle(11.4, 0.3)
    sky_rows = ((11.4, -0.05), (11.3, 4.0), (10.3, 8.0), (8.3, SKY_TOP_Y))
    arc_grid("sky", -a6, a6, 22, lambda i: sky_rows)


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
    detail_props()


def detail_props():
    """Lobby detail r2: coat and umbrella stands by the doorway, a magazine table and a plant cluster on the east
    wall, a wall clock over the bookshelf. Floor pieces get colliders; all stay off the doorway walk."""
    # Coat stand just west of the doorway: weighted base, pole, hooks, a hanging coat and a hat.
    sx, sz = -6.08, 1.62
    cyl("frame", sx, FLOOR_TOP + 0.02, sz, 0.17, 0.04, segs=16)
    cyl("wood", sx, 0.9, sz, 0.025, 1.7, segs=10)
    ball("wood", sx, 1.77, sz, 0.045, segs=10)
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        box("frame", sx + 0.08 * math.cos(a), 1.62, sz + 0.08 * math.sin(a), 0.14, 0.022, 0.022,
            bevel=0.008, rot_y=-a, rot_z=0.5)  # tilt the outer end up, then spin round
    box("sofa", sx + 0.02, 1.22, sz + 0.12, 0.3, 0.72, 0.1, bevel=0.04, rot_x=0.08)       # coat
    box("sofa", sx + 0.02, 1.53, sz + 0.12, 0.2, 0.08, 0.13, bevel=0.03)                  # collar
    cyl("book_a", sx - 0.09, 1.66, sz - 0.04, 0.11, 0.015, segs=16, rot_z=0.35)          # hat brim
    ball("book_a", sx - 0.095, 1.7, sz - 0.04, 0.07, squash=0.75, segs=12)                 # hat crown
    solid("coat_stand", sx, sz, 0.4, 0.4)
    # Umbrella stand beside it: an aqua tub with two closed umbrellas.
    ux, uz = -6.62, 1.52
    cyl("cooler", ux, 0.27, uz, 0.12, 0.44, segs=16)
    cyl("sill", ux, 0.49, uz, 0.13, 0.025, segs=16)
    for (dx, dz, m, tilt) in ((-0.03, 0.02, "book_d", 0.12), (0.04, -0.02, "rug", -0.1)):
        cyl(m, ux + dx, 0.62, uz + dz, 0.035, 0.6, segs=8, r_top=0.012, rot_z=tilt)
        hx = ux + dx - math.sin(tilt) * 0.33  # the tilted shaft's top
        cyl("trim", hx, 0.98, uz + dz, 0.01, 0.12, segs=6, rot_z=tilt)
        box("trim", hx + 0.03, 1.04, uz + dz, 0.07, 0.018, 0.018, bevel=0.006)
    solid("umbrella_stand", ux, uz, 0.3, 0.3)
    # Round magazine table against the east wall with a fan of magazines and a little vase.
    tx, tz = -2.95, 3.3
    cyl("frame", tx, FLOOR_TOP + 0.015, tz, 0.18, 0.03, segs=16)
    cyl("frame", tx, 0.28, tz, 0.03, 0.48, segs=10)
    cyl("wood", tx, 0.52, tz, 0.27, 0.035, segs=24)
    for k, (m, a) in enumerate((("book_b", 0.2), ("book_a", -0.35), ("book_c", 0.75))):
        box(m, tx - 0.04 + 0.03 * k, 0.545 + 0.009 * k, tz - 0.03 + 0.02 * k, 0.2, 0.008, 0.27, bevel=0.002, rot_y=a)
    cyl("cooler", tx + 0.12, 0.6, tz + 0.1, 0.035, 0.12, segs=10, r_top=0.025)
    ball("plant", tx + 0.12, 0.69, tz + 0.1, 0.05, segs=8)
    solid("magazine_table", tx, tz, 0.56, 0.56)
    # Reception plant cluster in the south-east corner: a tall snake plant, a leafy pot and a small one.
    px, pz = -2.88, 4.36
    cyl("pot", px, 0.2, pz - 0.08, 0.17, 0.38, segs=16, r_top=0.2)
    for k in range(7):
        a = k * 2.4
        dx, dz = 0.08 * math.cos(a), 0.08 * math.sin(a)
        cyl("plant_dark" if k % 2 else "plant", px + dx, 0.6 + 0.04 * (k % 3), pz - 0.08 + dz,
            0.035, 0.5 + 0.08 * (k % 3), segs=6, r_top=0.004, rot_x=0.18 * math.sin(a), rot_z=-0.18 * math.cos(a))
    cyl("sill", px - 0.17, 0.14, pz + 0.22, 0.13, 0.26, segs=16, r_top=0.15)
    for (dx, dy, dz, r) in ((0, 0.38, 0, 0.17), (0.08, 0.5, 0.04, 0.12), (-0.07, 0.48, -0.03, 0.11)):
        ball("plant", px - 0.17 + dx, dy, pz + 0.22 + dz, r, squash=0.85, segs=10)
    cyl("cooler", px + 0.12, 0.09, pz + 0.24, 0.09, 0.16, segs=14, r_top=0.1)
    ball("plant_dark", px + 0.12, 0.23, pz + 0.24, 0.1, squash=0.8, segs=10)
    solid("plant_cluster", px - 0.06, pz + 0.06, 0.6, 0.7)
    # Framed wall clock over the bookshelf, hands at ten past ten.
    cx, cy, cz = -3.35, 2.22, Z0 + 0.03
    cyl("trim", cx, cy, cz, 0.2, 0.05, segs=28, axis="z")
    cyl("clock_face", cx, cy, cz + 0.022, 0.17, 0.012, segs=28, axis="z")
    for k in range(12):
        a = k * math.pi / 6
        big = k % 3 == 0
        box("trim", cx + 0.145 * math.sin(a), cy + 0.145 * math.cos(a), cz + 0.03,
            0.012 if big else 0.007, 0.03 if big else 0.018, 0.006, rot_z=-a)
    for (a, length, width) in ((math.radians(305), 0.09, 0.016), (math.radians(60), 0.13, 0.01)):
        box("trim", cx + length / 2 * math.sin(a), cy + length / 2 * math.cos(a), cz + 0.034,
            width, length, 0.006, rot_z=-a)
    cyl("trim", cx, cy, cz + 0.036, 0.014, 0.01, segs=10, axis="z")


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
    # Recessed downlights in the corners the panels miss, and two pendants over the coffee corner.
    for (lx, lz) in DOWNLIGHTS:
        cyl("lamp_rim", lx, WALL_H - 0.004, lz, 0.12, 0.008, segs=20)
        cyl("downlight", lx, WALL_H - 0.009, lz, 0.085, 0.006, segs=20)
    for lx, lz in PENDANTS:
        cyl("cord", lx, WALL_H - 0.33, lz, 0.008, 0.66, segs=6)
        cyl("lamp_rim", lx, WALL_H - 0.01, lz, 0.05, 0.02, segs=12)
        cyl("pendant", lx, PENDANT_Y + 0.08, lz, 0.05, 0.16, segs=20, r_top=0.022)
        ball("pendant", lx, PENDANT_Y, lz, 0.13, squash=0.55, segs=16)
    # Skirting boards on the north (both sides of the doorway), south and east walls (west has one above).
    box("trim", (X0 + DOOR_X[0]) / 2 - 0.03, FLOOR_TOP + 0.07, Z0 + 0.03, DOOR_X[0] - X0 - 0.1, 0.14, 0.06, bevel=0.015)
    box("trim", (DOOR_X[1] + X1) / 2 + 0.03, FLOOR_TOP + 0.07, Z0 + 0.03, X1 - DOOR_X[1] - 0.1, 0.14, 0.06, bevel=0.015)
    box("trim", cx, FLOOR_TOP + 0.07, Z1 - 0.03, w, 0.14, 0.06, bevel=0.015)
    box("trim", X1 - 0.03, FLOOR_TOP + 0.07, cz, 0.06, 0.14, d, bevel=0.015)
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

# The forest and sky are big but soft and far, so they get less of the one lightmap than the room does: shrink
# their UV islands in place (no overlaps can appear), then repack so the room's islands grow into the space.
UV_WEIGHT = {
    "tree": 0.45, "tree_dark": 0.45, "bush": 0.45, "trunk": 0.4, "grass": 0.3,
    "tree_mid": 0.3, "trunk_mid": 0.25, "grass_mid": 0.2, "tree_far": 0.22, "mist": 0.2, "ground_haze": 0.1,
    "tree_haze": 0.18, "hill": 0.16, "grass_far": 0.12, "sky": 0.15,
}


def weight_uv_islands(mesh, weights):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv["lightmap"]
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def loop_of(face, vert):
        for lp in face.loops:
            if lp.vert is vert:
                return lp
        return None

    # Faces sharing an edge whose UVs also coincide on both ends belong to one island.
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        same = True
        for v in e.verts:
            l1, l2 = loop_of(f1, v), loop_of(f2, v)
            if l1 is None or l2 is None or (l1[uv].uv - l2[uv].uv).length > 1e-6:
                same = False
                break
        if same:
            parent[find(f1.index)] = find(f2.index)
    islands = {}
    for f in bm.faces:
        islands.setdefault(find(f.index), []).append(f)
    names = [m.name if m else "" for m in mesh.materials]
    shrunk = 0
    for faces in islands.values():
        k = weights.get(names[faces[0].material_index] if faces[0].material_index < len(names) else "")
        if not k:
            continue
        loops = [lp for f in faces for lp in f.loops]
        us = [lp[uv].uv.x for lp in loops]
        vs = [lp[uv].uv.y for lp in loops]
        c = Vector(((min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2))
        for lp in loops:
            lp[uv].uv = c + (lp[uv].uv - c) * k
        shrunk += 1
    bm.to_mesh(mesh)
    bm.free()
    return shrunk


print("UV_WEIGHTED", weight_uv_islands(mesh, UV_WEIGHT))
scene.tool_settings.use_uv_select_sync = True  # pack every face without needing UV-editor selection state
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
try:
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
except (RuntimeError, TypeError) as err:  # the smart-project layout is still valid, only less balanced
    print("UV_PACK_SKIPPED", err)
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
# Small warm point lights inside the two pendants over the coffee corner (lobby detail r2).
for i, (lx, lz) in enumerate(PENDANTS):
    pl = bpy.data.lights.new(f"pendant_{i}", "POINT")
    # 1.2 W, not 7: at 7 W the shades sit ~1 m over the cabinet and clip the corner and wall to white.
    pl.energy, pl.color, pl.shadow_soft_size = 1.2, mix(hexlin(BUTTER), hexlin(PEACH), 0.35), 0.15
    pl_obj = bpy.data.objects.new(f"pendant_{i}", pl)
    pl_obj.location = B(lx, PENDANT_Y - 0.06, lz)
    scene.collection.objects.link(pl_obj)
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

# Nodes the web layer toggles, by source material. Ceiling lights travel with the ceiling so the overview
# (which hides "ceiling") does not show them floating over the room.
GROUP_OF = {"wall_far": "wall_far", "wall_near": "wall_near", "ceiling": "ceiling", "panel": "ceiling",
            "downlight": "ceiling", "lamp_rim": "ceiling", "pendant": "ceiling", "cord": "ceiling"}
groups = {}
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    # Separated objects may keep the full slot list, so read the material of the first face.
    slot_name = o.material_slots[o.data.polygons[0].material_index].material.name
    groups.setdefault(GROUP_OF.get(slot_name, "shell"), []).append(o)
# Join each group into one node ("shell" holds every non-toggled piece) so the GLB has few draws.
for node_name, members in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in members:
        o.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    if len(members) > 1:
        bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = node_name
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
