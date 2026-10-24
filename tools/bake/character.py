"""Stylized office character: one rounded base body the web layer recolours per agent. Exports character.glb.

Run (inside the sandbox, see tools/bake/README.md):
  blender --background --factory-startup --disable-autoexec --python character.py -- --out /bake/out

Coordinates are three.js metres (Y up, feet at y=0, facing -Z like the office agents). `B()` converts to Blender.
Nodes the web layer relies on: `body` (shirt, recoloured per agent), `skin` (head and hands), `hair`, `legs`,
`face` (eyes and a small smile). No lightmap: the character is lit live so it matches the procedural props.
Our own code only: no downloads, no network, no process spawning.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

bpy.ops.wm.read_factory_settings(use_empty=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(os.getcwd(), "out")
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene


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


# Palette (mirrors web/lib/office/palette.ts). The shirt is a neutral lavender the web layer replaces per agent.
MATS = {"body": material("body", "#D9CCFF"), "skin": material("skin", "#F6D3B8", 0.6),
        "hair": material("hair", "#4A5A7A", 0.8), "legs": material("legs", "#7C88A6"),
        "face": material("face", "#4A5A7A", 0.4)}
groups = {name: [] for name in MATS}


def add(group, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(group)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[group])
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(group, mesh)
    scene.collection.objects.link(obj)
    groups[group].append(obj)


def ball(group, x, y, z, r, sx=1.0, sy=1.0, sz=1.0, segs=20):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=bm.verts)
    add(group, bm)


def capsule(group, x, y0, y1, z, r, segs=16):
    """Vertical rounded capsule from y0 to y1 (centres of the end caps)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r, radius2=r, depth=y1 - y0)
    bmesh.ops.translate(bm, vec=B(x, (y0 + y1) / 2, z), verts=bm.verts)
    add(group, bm)
    ball(group, x, y0, z, r, segs=segs)
    ball(group, x, y1, z, r, segs=segs)


# Proportions: chunky and friendly, about 1.45 m tall, big head, short legs (between blocky and realistic).
capsule("legs", -0.09, 0.12, 0.42, 0, 0.075)
capsule("legs", 0.09, 0.12, 0.42, 0, 0.075)
ball("legs", -0.09, 0.05, -0.04, 0.08, sx=1.0, sy=0.6, sz=1.4)    # shoes
ball("legs", 0.09, 0.05, -0.04, 0.08, sx=1.0, sy=0.6, sz=1.4)
ball("body", 0, 0.72, 0, 0.24, sx=1.0, sy=1.25, sz=0.78)           # rounded torso
for side in (-1, 1):
    capsule("body", side * 0.27, 0.6, 0.86, 0, 0.065)                # arms (sleeves)
    ball("skin", side * 0.27, 0.53, 0, 0.065)                        # hands
ball("skin", 0, 1.17, 0, 0.21, sy=1.05)                              # head
ball("hair", 0, 1.26, 0.03, 0.215, sy=0.72, sz=1.02)                 # hair cap, slightly back
for side in (-1, 1):
    ball("face", side * 0.075, 1.19, -0.19, 0.026, sz=0.5, segs=12)  # eyes
bm = bmesh.new()                                                     # small smile: a thin flattened arc
bmesh.ops.create_circle(bm, cap_ends=True, segments=12, radius=0.045)
bmesh.ops.scale(bm, vec=(1.0, 1.0, 0.35), verts=bm.verts)
bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"), verts=bm.verts)
bmesh.ops.translate(bm, vec=B(0, 1.1, -0.2), verts=bm.verts)
add("face", bm)

# One node per material group so the web layer can recolour `body` per agent with one draw each.
for name, objs in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = name
    bpy.context.view_layer.objects.active.data.name = name

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "character.glb"), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
                          export_texcoords=False, export_materials="EXPORT")
tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print("CHARACTER_DONE", OUT, "faces", tris)
