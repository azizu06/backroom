"""Stylized office characters: one rounded, rigged base body plus per-role accessories and four baked clips.
Exports character.glb (one shared GLB; the web layer shows one variant per agent and recolours its shirt).

Run (inside the sandbox, see tools/bake/README.md):
  blender --background --factory-startup --disable-autoexec --python character.py -- --out /bake/out

Coordinates are three.js metres (Y up, feet at y=0, facing -Z like the office agents). `B()` converts to Blender.
Nodes the web layer relies on (web/lib/office/baked-character.ts):
- base body, shared by every variant: `body` (shirt, recoloured per agent), `skin` (head and hands), `hair`, `legs`,
  `face` (eyes, brows, smile, cheeks), all skinned to the armature `rig`.
- accessories: `v_<variant>_<item>`, variant in collections | payables | vendor | dana. The web layer hides every
  `v_*` node whose variant is not the agent's.
- clips (glTF animations): `idle` (breathe), `walk` (cycle), `talk` (gesture), `type` (at the desk). All loop.
No lightmap: the character is lit live so it matches the procedural props.
Our own code only: no downloads, no network, no process spawning, no file reads; writes only into --out.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(os.getcwd(), "out")
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
FPS = 24
scene.render.fps = FPS

# ---- cozy pastel palette ----------------------------------------------------------------------------------------
# These mirror web/lib/office/palette.ts (Blender's Python cannot import the TS module, so keep the two in sync).
# Rules: no pure black or white; every colour on the character is one of these tokens.
AQUA = "#9EF2FB"
CREAM = "#FFF7EC"
PEACH = "#F6D3B8"
BUTTER = "#FFF0B3"
BLUSH = "#FFC9D9"
LAVENDER = "#D9CCFF"
MINT = "#CDF2DC"
NAVY = "#4A5A7A"
SLATE = "#7C88A6"
CORAL = "#E8727A"


def B(x, y, z):
    return (x, -z, y)


def hexlin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def material(name, color, roughness=0.7):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hexlin(color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


# The shirt (`body`) is a neutral lavender the web layer replaces per agent. Accessory materials are `acc_<token>`.
MATS = {"body": material("body", LAVENDER), "skin": material("skin", PEACH, 0.6),
        "hair": material("hair", NAVY, 0.8), "legs": material("legs", SLATE),
        "face": material("face", NAVY, 0.4), "cheek": material("cheek", BLUSH, 0.8),
        "glint": material("glint", CREAM, 0.3)}
for token, hexval in (("aqua", AQUA), ("cream", CREAM), ("butter", BUTTER), ("blush", BLUSH), ("lavender", LAVENDER),
                      ("mint", MINT), ("navy", NAVY), ("slate", SLATE), ("coral", CORAL)):
    MATS["acc_" + token] = material("acc_" + token, hexval, 0.6)

# node name -> list of part objects; every part carries one material and is rigidly skinned to one bone.
nodes = {}


def add(node, mat, bone, bm, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(node)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[mat])
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(node, mesh)
    scene.collection.objects.link(obj)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    nodes.setdefault(node, []).append(obj)


def ball(node, mat, bone, x, y, z, r, sx=1.0, sy=1.0, sz=1.0, segs=20):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=bm.verts)
    add(node, mat, bone, bm)


def tube(node, mat, bone, p0, p1, r, segs=12, caps=True):
    """Rounded rod between two three.js points (ball caps hide the ends)."""
    a, b = Vector(B(*p0)), Vector(B(*p1))
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=not caps, segments=segs, radius1=r, radius2=r, depth=axis.length)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix()
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    add(node, mat, bone, bm)
    if caps:
        ball(node, mat, bone, *p0, r, segs=segs)
        ball(node, mat, bone, *p1, r, segs=segs)


def capsule(node, mat, bone, x, y0, y1, z, r, segs=16):
    """Vertical rounded capsule from y0 to y1 (centres of the end caps)."""
    tube(node, mat, bone, (x, y0, z), (x, y1, z), r, segs)


def cyl(node, mat, bone, x, y, z, r, h, segs=16):
    """Closed vertical cylinder centred at (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=h)
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=bm.verts)
    add(node, mat, bone, bm)


def box(node, mat, bone, x, y, z, sx, sy, sz, bevel=0.01, rot_y=0.0):
    """Bevelled box in three.js coordinates, optionally turned about three.js y (radians)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    if rot_y:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=bm.verts)
    add(node, mat, bone, bm)


def ring(node, mat, bone, centre, u, v, radius, r, a0=0.0, a1=2 * math.pi, segs=24, rsegs=8):
    """Torus (or open arc a0..a1) around a three.js centre in the plane of three.js directions u and v."""
    c, U, V = Vector(B(*centre)), Vector(B(*u)).normalized(), Vector(B(*v)).normalized()
    n = U.cross(V).normalized()
    closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
    count = segs if closed else segs + 1
    bm = bmesh.new()
    rows = []
    for i in range(count):
        t = a0 + (a1 - a0) * i / segs
        radial = U * math.cos(t) + V * math.sin(t)
        row = []
        for j in range(rsegs):
            p = 2 * math.pi * j / rsegs
            row.append(bm.verts.new(c + radial * (radius + r * math.cos(p)) + n * (r * math.sin(p))))
        rows.append(row)
    for i in range(segs):
        nxt = rows[(i + 1) % count]
        for j in range(rsegs):
            k = (j + 1) % rsegs
            bm.faces.new((rows[i][j], nxt[j], nxt[k], rows[i][k]))
    add(node, mat, bone, bm)
    if not closed:
        for t in (a0, a1):
            radial = U * math.cos(t) + V * math.sin(t)
            end = c + radial * radius
            ball(node, mat, bone, end.x, end.z, -end.y, r, segs=10)


# ---- armature -----------------------------------------------------------------------------------------------------
# Bone names avoid '.', which three's GLTFLoader strips from node names. (name, head, tail, parent), three.js coords.
BONES = [("hips", (0, 0.46, 0), (0, 0.62, 0), None),
         ("spine", (0, 0.62, 0), (0, 0.94, 0), "hips"),
         ("head", (0, 0.96, 0), (0, 1.36, 0), "spine"),
         ("arm_L", (-0.27, 0.86, 0), (-0.27, 0.72, 0), "spine"),
         ("fore_L", (-0.27, 0.72, 0), (-0.27, 0.53, 0), "arm_L"),
         ("arm_R", (0.27, 0.86, 0), (0.27, 0.72, 0), "spine"),
         ("fore_R", (0.27, 0.72, 0), (0.27, 0.53, 0), "arm_R"),
         ("thigh_L", (-0.09, 0.44, 0), (-0.09, 0.28, 0), "hips"),
         ("shin_L", (-0.09, 0.28, 0), (-0.09, 0.04, 0), "thigh_L"),
         ("thigh_R", (0.09, 0.44, 0), (0.09, 0.28, 0), "hips"),
         ("shin_R", (0.09, 0.28, 0), (0.09, 0.04, 0), "thigh_R")]
rig_data = bpy.data.armatures.new("rig")
rig = bpy.data.objects.new("rig", rig_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, head, tail, parent in BONES:
    eb = rig_data.edit_bones.new(name)
    eb.head, eb.tail, eb.roll = B(*head), B(*tail), 0.0
    if parent:
        eb.parent = rig_data.edit_bones[parent]
        eb.use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")

# ---- base body: chunky and friendly, about 1.45 m tall, big head, short legs --------------------------------------
for side, s in (("L", -1), ("R", 1)):
    capsule("legs", "legs", "thigh_" + side, s * 0.09, 0.28, 0.42, 0, 0.075)
    capsule("legs", "legs", "shin_" + side, s * 0.09, 0.12, 0.28, 0, 0.072)
    ball("legs", "legs", "shin_" + side, s * 0.09, 0.05, -0.04, 0.08, sx=1.0, sy=0.6, sz=1.4)     # shoes
ball("body", "body", "spine", 0, 0.72, 0, 0.24, sx=1.0, sy=1.25, sz=0.78)                       # rounded torso
ball("body", "body", "spine", 0, 0.985, 0, 0.085, sy=0.6)                                       # collar / neck
for side, s in (("L", -1), ("R", 1)):
    capsule("body", "body", "arm_" + side, s * 0.27, 0.73, 0.86, 0, 0.066)                      # sleeves
    capsule("body", "body", "fore_" + side, s * 0.27, 0.61, 0.73, 0, 0.062)
    ball("skin", "skin", "fore_" + side, s * 0.27, 0.53, 0, 0.066)                               # hands
ball("skin", "skin", "head", 0, 1.17, 0, 0.21, sy=1.05)                                          # head
ball("hair", "hair", "head", 0, 1.26, 0.03, 0.215, sy=0.72, sz=1.02)                             # hair cap
ball("hair", "hair", "head", -0.06, 1.33, -0.15, 0.08, sx=1.5, sy=0.55, sz=0.8)                  # soft fringe swoop
# Soft face, sized to read at 3 m: big dark eyes with a glint, short brows, a smile and blush cheeks.
for s in (-1, 1):
    ball("face", "face", "head", s * 0.075, 1.185, -0.192, 0.032, sy=1.15, sz=0.5, segs=12)
    ball("face", "glint", "head", s * 0.075 + 0.01, 1.2, -0.206, 0.009, sz=0.5, segs=8)
    tube("face", "face", "head", (s * 0.045, 1.245, -0.192), (s * 0.105, 1.252, -0.18), 0.009, segs=8)
    ball("face", "cheek", "head", s * 0.122, 1.122, -0.166, 0.03, sy=0.75, sz=0.4, segs=12)
ring("face", "face", "head", (0, 1.125, -0.198), (1, 0, 0), (0, 1, 0), 0.042, 0.008,
     a0=math.radians(200), a1=math.radians(340), segs=10, rsegs=6)                              # smile arc

# ---- per-role accessories (`v_<variant>_<item>`) ------------------------------------------------------------------
def lanyard(variant, cord, stripe):
    for s in (-1, 1):
        tube("v_%s_lanyard" % variant, "acc_" + cord, "spine", (s * 0.075, 0.99, -0.09), (s * 0.02, 0.8, -0.192), 0.008, segs=6)
    box("v_%s_lanyard" % variant, "acc_cream", "spine", 0, 0.73, -0.2, 0.085, 0.11, 0.014, bevel=0.006)
    box("v_%s_lanyard" % variant, "acc_" + stripe, "spine", 0, 0.765, -0.208, 0.086, 0.03, 0.006, bevel=0.002)
    box("v_%s_lanyard" % variant, "acc_navy", "spine", 0, 0.715, -0.208, 0.05, 0.012, 0.004, bevel=0.002)


# Collections: phone headset with a mic boom, mint lanyard badge.
ring("v_collections_headset", "acc_slate", "head", (0, 1.19, 0.0), (1, 0, 0), (0, 1, 0), 0.24, 0.014,
     a0=math.radians(8), a1=math.radians(172), segs=20)
for s in (-1, 1):
    ball("v_collections_headset", "acc_navy", "head", s * 0.222, 1.17, 0, 0.058, sx=0.45, segs=16)
    ball("v_collections_headset", "acc_mint", "head", s * 0.2, 1.17, 0, 0.045, sx=0.3, segs=12)
tube("v_collections_headset", "acc_slate", "head", (-0.225, 1.14, -0.02), (-0.13, 1.08, -0.18), 0.008, segs=6)
ball("v_collections_headset", "acc_coral", "head", -0.125, 1.078, -0.186, 0.02, segs=10)
lanyard("collections", "coral", "mint")

# Payables: round glasses and a butter lanyard badge.
for s in (-1, 1):
    ring("v_payables_glasses", "acc_navy", "head", (s * 0.078, 1.188, -0.215), (1, 0, 0), (0, 1, 0), 0.042, 0.007,
         segs=20, rsegs=6)
    tube("v_payables_glasses", "acc_navy", "head", (s * 0.12, 1.195, -0.205), (s * 0.2, 1.2, -0.06), 0.006, segs=6)
tube("v_payables_glasses", "acc_navy", "head", (-0.036, 1.195, -0.218), (0.036, 1.195, -0.218), 0.006, segs=6)
lanyard("payables", "aqua", "butter")

# Vendor desk: open mint cardigan with cream buttons, a butter folder tucked under the left arm.
for s in (-1, 1):
    ball("v_vendor_cardigan", "acc_mint", "spine", s * 0.07, 0.72, 0.012, 0.236, sx=0.75, sy=1.26, sz=0.8)
    capsule("v_vendor_cardigan", "acc_mint", "arm_" + ("L" if s < 0 else "R"), s * 0.27, 0.73, 0.86, 0, 0.072)
    capsule("v_vendor_cardigan", "acc_mint", "fore_" + ("L" if s < 0 else "R"), s * 0.27, 0.62, 0.73, 0, 0.068)
for y in (0.8, 0.7, 0.6):
    ball("v_vendor_cardigan", "acc_cream", "spine", -0.1, y, -0.185, 0.012, sz=0.5, segs=8)
box("v_vendor_folder", "acc_butter", "fore_L", -0.335, 0.66, -0.02, 0.03, 0.27, 0.21, bevel=0.008)
box("v_vendor_folder", "acc_cream", "fore_L", -0.335, 0.675, -0.02, 0.022, 0.25, 0.2, bevel=0.004)

# Dana (the human approver): coral scarf with a tail, hair bun, cream mug in the right hand.
ring("v_dana_scarf", "acc_coral", "spine", (0, 0.975, 0), (1, 0, 0), (0, 0, 1), 0.105, 0.035, segs=20)
tube("v_dana_scarf", "acc_coral", "spine", (-0.06, 0.95, -0.13), (-0.08, 0.8, -0.2), 0.03, segs=10)
box("v_dana_scarf", "acc_blush", "spine", -0.082, 0.775, -0.205, 0.06, 0.04, 0.03, bevel=0.01)
ball("v_dana_bun", "hair", "head", 0, 1.38, 0.1, 0.085, segs=16)
ring("v_dana_bun", "acc_blush", "head", (0, 1.335, 0.08), (1, 0, 0), (0, 0.4, 1), 0.05, 0.012, segs=16, rsegs=6)
cyl("v_dana_mug", "acc_cream", "fore_R", 0.27, 0.53, -0.085, 0.04, 0.085)
cyl("v_dana_mug", "acc_coral", "fore_R", 0.27, 0.555, -0.085, 0.041, 0.02)
ring("v_dana_mug", "acc_cream", "fore_R", (0.315, 0.53, -0.085), (1, 0, 0), (0, 1, 0), 0.022, 0.007, segs=12, rsegs=6)

# ---- one node per group, skinned to the rig ------------------------------------------------------------------------
meshes = []
for name, objs in nodes.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    obj.parent = rig
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    meshes.append(obj)

# ---- clips -------------------------------------------------------------------------------------------------------------
# Poses are rotations in degrees about Blender armature axes (x right, y forward, z up): +x swings a hanging limb
# forward; +y moves a hanging left arm outward (-x); +z turns left. `hips` may also carry a lift in metres.
CLIPS = {
    "idle": {"frames": [0, 24, 48], "pose": {
        "spine": [(0, 0, 0), (-2, 0, 0), (0, 0, 0)],
        "head": [(0, 0, 0), (2, 0, 1.5), (0, 0, 0)],
        "arm_L": [(2, 2, 0), (2, 4, 0), (2, 2, 0)],
        "arm_R": [(2, -2, 0), (2, -4, 0), (2, -2, 0)],
        "fore_L": [(6, 0, 0), (8, 0, 0), (6, 0, 0)],
        "fore_R": [(6, 0, 0), (8, 0, 0), (6, 0, 0)]},
        "lift": [0.0, 0.008, 0.0]},
    "walk": {"frames": [0, 6, 12, 18, 24], "pose": {
        "thigh_L": [(28, 0, 0), (0, 0, 0), (-28, 0, 0), (0, 0, 0), (28, 0, 0)],
        "thigh_R": [(-28, 0, 0), (0, 0, 0), (28, 0, 0), (0, 0, 0), (-28, 0, 0)],
        "shin_L": [(-6, 0, 0), (-12, 0, 0), (-14, 0, 0), (-45, 0, 0), (-6, 0, 0)],
        "shin_R": [(-14, 0, 0), (-45, 0, 0), (-6, 0, 0), (-12, 0, 0), (-14, 0, 0)],
        "arm_L": [(-22, 3, 0), (0, 3, 0), (22, 3, 0), (0, 3, 0), (-22, 3, 0)],
        "arm_R": [(22, -3, 0), (0, -3, 0), (-22, -3, 0), (0, -3, 0), (22, -3, 0)],
        "fore_L": [(10, 0, 0), (14, 0, 0), (24, 0, 0), (14, 0, 0), (10, 0, 0)],
        "fore_R": [(24, 0, 0), (14, 0, 0), (10, 0, 0), (14, 0, 0), (24, 0, 0)],
        "spine": [(4, 0, -4), (4, 0, 0), (4, 0, 4), (4, 0, 0), (4, 0, -4)],
        "head": [(-2, 0, 3), (-2, 0, 0), (-2, 0, -3), (-2, 0, 0), (-2, 0, 3)]},
        "lift": [0.0, 0.022, 0.0, 0.022, 0.0]},
    "talk": {"frames": [0, 12, 24, 36, 48], "pose": {
        "arm_R": [(12, -6, 0), (48, -14, 0), (32, -10, 0), (52, -16, 0), (12, -6, 0)],
        "fore_R": [(24, 0, 0), (62, 0, -10), (40, 0, 8), (66, 0, -12), (24, 0, 0)],
        "arm_L": [(8, 4, 0), (14, 6, 0), (10, 4, 0), (16, 6, 0), (8, 4, 0)],
        "fore_L": [(12, 0, 0), (20, 0, 0), (14, 0, 0), (22, 0, 0), (12, 0, 0)],
        "head": [(0, 0, 0), (-5, 3, 4), (3, 0, -2), (-4, -3, 5), (0, 0, 0)],
        "spine": [(0, 0, 0), (-2, 0, 3), (1, 0, 0), (-2, 0, 4), (0, 0, 0)]},
        "lift": [0.0, 0.006, 0.0, 0.006, 0.0]},
    "type": {"frames": [0, 3, 6, 9, 12, 15, 18, 21, 24], "pose": {
        "arm_L": [(58, -6, 0)] * 9,
        "arm_R": [(58, 6, 0)] * 9,
        "fore_L": [(30, 0, 0), (37, 0, 0), (30, 0, 0), (30, 0, 0), (36, 0, 0), (30, 0, 0), (30, 0, 0), (37, 0, 0), (30, 0, 0)],
        "fore_R": [(30, 0, 0), (30, 0, 0), (36, 0, 0), (30, 0, 0), (30, 0, 0), (37, 0, 0), (30, 0, 0), (30, 0, 0), (30, 0, 0)],
        "spine": [(4, 0, 0)] * 9,
        "head": [(7, 0, 0), (7, 0, 0), (7, 0, 1), (7, 0, 1), (8, 0, 0), (8, 0, 0), (7, 0, -1), (7, 0, -1), (7, 0, 0)]},
        "lift": [0.0] * 9},
}

rest = {bone.name: bone.matrix_local.to_3x3() for bone in rig_data.bones}
rig.animation_data_create()
for clip, spec in CLIPS.items():
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True
    rig.animation_data.action = action
    for index, frame in enumerate(spec["frames"]):
        for pb in rig.pose.bones:
            m = rest[pb.name]
            deg = spec["pose"].get(pb.name, [(0, 0, 0)] * len(spec["frames"]))[index]
            world = Euler([math.radians(a) for a in deg], "XYZ").to_matrix()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (m.inverted() @ world @ m).to_quaternion()
            pb.location = m.inverted() @ Vector((0, 0, spec["lift"][index] if pb.name == "hips" else 0.0))
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, int(spec["frames"][0]), action)  # the exporter samples each action on its own
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
for obj in meshes:
    obj.select_set(True)
options = dict(filepath=os.path.join(OUT, "character.glb"), export_format="GLB", use_selection=True,
               export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
               export_texcoords=False, export_materials="EXPORT", export_skins=True, export_animations=True,
               export_morph=False)
try:
    bpy.ops.export_scene.gltf(**options, export_animation_mode="ACTIONS")
except TypeError:
    bpy.ops.export_scene.gltf(**options)  # Blender < 3.6: every action is exported by default
faces = sum(len(o.data.polygons) for o in meshes)
print("CHARACTER_DONE", OUT, "nodes", sorted(nodes), "faces", faces, "clips", sorted(CLIPS))
