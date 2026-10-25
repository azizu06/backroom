"""Reusable office prop kit, Blender 4.0.2 / CPU Cycles. No inputs, writes only --out.

Coordinates: web (x, y up, z), front +z, origin at floor centre for every node.
One 1024px colour+lighting atlas; twelve named, single-material meshes at the origin.
Run with run-gx10.sh; see propkit.bake.md. No downloads, file reads or subprocesses.
"""
import json
import math
import os
import sys
import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = arg("--out", None)
if not OUT:
    raise ValueError("--out is required")
SIZE = max(64, min(1024, int(arg("--size", "1024"))))
SAMPLES = max(1, int(arg("--samples", "64")))
THREADS = max(1, min(8, int(arg("--threads", "8"))))
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene

# Mirrors web/lib/office/palette.ts; every surface and light comes from these colours.
PALETTE = {
    "aqua": "9EF2FB", "cream": "FFF7EC", "peach": "F6D3B8", "butter": "FFF0B3",
    "blush": "FFC9D9", "lavender": "D9CCFF", "mint": "CDF2DC", "navy": "4A5A7A",
    "slate": "7C88A6", "coral": "E8727A",
}
# Conservative local envelopes, mirrored in PROPKIT_SPECS. Non-solids never enter Play collision.
SPECS = {
    "plant_tall": ((0.8, 1.65, 0.8), True), "plant_small": ((0.5, 0.85, 0.5), True),
    "bookshelf": ((1.1, 1.8, 0.42), True), "water_cooler": ((0.55, 1.5, 0.55), True),
    "coffee_station": ((1.1, 1.45, 0.6), True), "wall_art_a": ((1.1, 0.8, 0.08), False),
    "wall_art_b": ((0.8, 1.0, 0.08), False), "floor_lamp": ((0.5, 1.9, 0.5), True),
    "pendant_lamp": ((0.65, 0.7, 0.65), False), "rug_large": ((1, 0.012, 1), False),
    "office_tv": ((1.5, 0.9, 0.12), False), "arcade": ((0.8, 1.75, 0.8), True),
}


def B(x, y, z):
    return (x, -z, y)


def linear(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels)


MATS = {}
for name, color in PALETTE.items():
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*linear(color), 1)
    bsdf.inputs["Roughness"].default_value = 0.85
    MATS[name] = material
parts = []


def link(bm, color):
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new("part")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[color])
    obj = bpy.data.objects.new("part", mesh)
    scene.collection.objects.link(obj)
    parts.append(obj)
    return obj


def box(color, x, y, z, w, h, d, bevel=0.012):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=list(bm.verts))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(w, h, d) * 0.25),
                        segments=2, affect="EDGES")
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=list(bm.verts))
    return link(bm, color)


def cylinder(color, x, y, z, radius, height, top=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16,
                          radius1=radius, radius2=radius if top is None else top, depth=height)
    bmesh.ops.translate(bm, vec=B(x, y, z), verts=list(bm.verts))
    return link(bm, color)


def leaf(angle, reach, bottom, height, width, color):
    """Closed folded blade: visibly pointed foliage, six vertices instead of a blocky canopy."""
    dx, dz = math.cos(angle), math.sin(angle)
    bm = bmesh.new()
    points = [(0, bottom, 0), (dx * reach, bottom + height, dz * reach),
              (dx * reach * 0.5 - dz * width, bottom + height * 0.55, dz * reach * 0.5 + dx * width),
              (dx * reach * 0.5 + dz * width, bottom + height * 0.55, dz * reach * 0.5 - dx * width),
              (dx * reach * 0.6, bottom + height * 0.58, dz * reach * 0.6),
              (dx * reach * 0.4, bottom + height * 0.52, dz * reach * 0.4)]
    verts = [bm.verts.new(B(*p)) for p in points]
    for face in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
                 (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
        bm.faces.new([verts[i] for i in face])
    link(bm, color)


def build(name):
    w, h, d = SPECS[name][0]
    if name.startswith("plant_"):
        pot = h * 0.3
        cylinder("peach", 0, pot / 2, 0, w * 0.26, pot, w * 0.34)
        cylinder("blush", 0, pot * 0.93, 0, w * 0.35, pot * 0.12)
        cylinder("navy", 0, pot, 0, w * 0.29, 0.008)
        for i in range(10):
            leaf(i * math.pi / 5, w * (0.45 if i % 2 else 0.28), pot,
                 (h - pot) * (0.65 + (i % 3) * 0.175), w * 0.09,
                 ("mint", "aqua", "mint", "butter")[i % 4])
    elif name == "bookshelf":
        box("peach", 0, h / 2, -d / 2 + 0.025, w, h, 0.05)
        for side in (-1, 1):
            box("peach", side * (w / 2 - 0.03), h / 2, 0, 0.06, h, d)
        for row in range(4):
            y = 0.03 + row * 0.55
            box("peach", 0, y, 0, w, 0.06, d)
            if row < 3:
                for i in range(6):
                    bh = 0.28 + (i % 3) * 0.04
                    box(("aqua", "blush", "butter", "lavender")[i % 4],
                        -0.4 + i * 0.15, y + 0.03 + bh / 2, 0, 0.1, bh, 0.3, 0.005)
    elif name == "water_cooler":
        box("cream", 0, 0.5, 0, w, 1, d, 0.035)
        cylinder("aqua", 0, 1.25, 0, 0.21, 0.5, 0.17)
        box("navy", 0, 0.69, 0.261, 0.26, 0.28, 0.028)
        for x, color in ((-0.075, "aqua"), (0.075, "coral")):
            box(color, x, 0.76, 0.27, 0.04, 0.05, 0.01)
        box("slate", 0, 0.53, 0.23, 0.3, 0.035, 0.09)
    elif name == "coffee_station":
        box("peach", 0, 0.43, 0, w, 0.86, d, 0.025)
        box("cream", 0, 0.88, 0, w, 0.04, d)
        for side in (-1, 1):
            box("mint", side * 0.26, 0.45, 0.294, 0.48, 0.74, 0.012)
            box("slate", side * 0.26, 0.72, 0.299, 0.16, 0.02, 0.002)
        box("navy", 0, 1.175, -0.02, 0.55, 0.55, 0.4, 0.035)
        box("aqua", 0, 1.29, 0.186, 0.36, 0.12, 0.012)
        box("slate", 0, 1.15, 0.2, 0.12, 0.07, 0.04)
        cylinder("cream", 0, 0.975, 0.2, 0.07, 0.15)
        cylinder("navy", 0, 1.049, 0.2, 0.055, 0.002)
    elif name in ("floor_lamp", "pendant_lamp"):
        hanging = name == "pendant_lamp"
        cylinder("slate", 0, h / 2, 0, 0.018, h)
        cylinder("butter", 0, 0.16 if hanging else h - 0.16, 0, w / 2, 0.32, w * 0.3)
        cylinder("cream", 0, 0.012 if hanging else h - 0.315, 0, w * 0.45, 0.01)
        if not hanging:
            cylinder("navy", 0, 0.025, 0, w / 2, 0.05, w * 0.42)
    elif name == "rug_large":
        box("blush", 0, 0.004, 0, 1, 0.008, 1, 0.002)
        box("cream", 0, 0.009, 0, 0.88, 0.004, 0.88, 0.001)
        for z in (-0.34, 0.34):
            box("aqua", 0, 0.0115, z, 0.8, 0.001, 0.045, 0)
    elif name == "arcade":
        box("lavender", 0, h / 2, 0, w, h, d, 0.04)
        box("navy", 0, 1.18, 0.375, 0.66, 0.68, 0.04)
        box("aqua", 0, 1.22, 0.398, 0.53, 0.43, 0.004)
        for i in range(5):
            box(("butter", "blush", "cream")[i % 3], -0.18 + i * 0.09,
                1.17 + (i % 2) * 0.08, 0.401, 0.05, 0.05, 0.002, 0)
        box("butter", 0, 1.62, 0.39, 0.65, 0.13, 0.02)
        box("navy", 0, 0.86, 0.3, 0.68, 0.06, 0.2)
        for x in (-0.18, 0.18):
            cylinder("coral", x, 0.91, 0.3, 0.035, 0.04)
    else:
        box("navy", 0, h / 2, 0, w, h, d, 0.02)
        box("aqua" if name == "office_tv" else "butter", 0, h / 2, d / 2 - 0.006,
            w - 0.1, h - 0.1, 0.008, 0.004)
        for i in range(3):
            box(("blush", "mint", "lavender")[i], (i - 1) * w * 0.23, h * (0.38 + 0.12 * i),
                d / 2 - 0.001, w * 0.18, h * 0.24, 0.002, 0.008)


objects = []
manifest = {}
for name, (size, solid) in SPECS.items():
    parts = []
    build(name)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = obj.data.name = name
    # Every helper builds vertices around (0,0,0); joining keeps that contact origin.
    coords = [Vector((v.co.x, v.co.z, -v.co.y)) for v in obj.data.vertices]
    bounds = {"min": [min(v[i] for v in coords) for i in range(3)],
              "max": [max(v[i] for v in coords) for i in range(3)]}
    w, h, d = size
    assert all(bounds["min"][i] >= (-w / 2, 0, -d / 2)[i] - 0.005 for i in range(3)), name
    assert all(bounds["max"][i] <= (w / 2, h, d / 2)[i] + 0.005 for i in range(3)), name
    footprint = {"minX": -w / 2, "maxX": w / 2, "minZ": -d / 2, "maxZ": d / 2}
    obj.data.calc_loop_triangles()
    manifest[name] = {"name": name, "bounds": bounds, "footprint": footprint,
                      "solid": solid, "triangles": len(obj.data.loop_triangles)}
    objects.append(obj)

# UV islands stay inside their own padded atlas tile; no prop shares texels with another.
image = bpy.data.images.new("propkit_lightmap", width=SIZE, height=SIZE, alpha=False)
image.generated_color = (*linear(PALETTE["cream"]), 1)
for material in MATS.values():
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    material.node_tree.nodes.active = node
for i, obj in enumerate(objects):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.uv_layers.active.name = "lightmap"
    for loop in obj.data.uv_layers.active.data:
        loop.uv.x = (i % 4 + 0.04 + loop.uv.x * 0.92) / 4
        loop.uv.y = (i // 4 + 0.04 + loop.uv.y * 0.92) / 3
    # Separate bake stations prevent unrelated props casting onto one another.
    obj.location = B((i % 4) * 4, 0, (i // 4) * 4)
    light = bpy.data.lights.new("softbox", "AREA")
    light.energy, light.size = 100, 3
    light.color = linear(PALETTE["butter"])
    lamp = bpy.data.objects.new("softbox", light)
    lamp.location = obj.location + Vector((0.5, 0.5, 3.5))
    scene.collection.objects.link(lamp)
world = bpy.data.worlds.new("propkit_ambient")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*linear(PALETTE["cream"]), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65
scene.world = world
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.render.threads_mode = "FIXED"
scene.render.threads = THREADS
scene.view_settings.view_transform = "Standard"
scene.render.bake.margin = 3
scene.render.bake.margin_type = "EXTEND"
scene.render.bake.use_clear = False
for obj in objects:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="COMBINED")
image.filepath_raw = os.path.join(OUT, "propkit_lightmap.png")
image.file_format = "PNG"
image.save()

final = bpy.data.materials.new("propkit_lightmap")
final.use_nodes = True
texture = final.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = image
final.node_tree.links.new(texture.outputs["Color"], final.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.location = (0, 0, 0)
    obj.data.materials.clear()
    obj.data.materials.append(final)
    for face in obj.data.polygons:
        face.material_index = 0
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "propkit.glb"), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
                          export_image_format="AUTO", export_texcoords=True, export_normals=True)
with open(os.path.join(OUT, "propkit.nodes.json"), "w") as handle:
    json.dump({"kit": "propkit", "lightmap": {"width": SIZE, "height": SIZE}, "nodes": manifest}, handle, indent=2)
with open(os.path.join(OUT, "propkit.colliders.json"), "w") as handle:
    json.dump({"kit": "propkit", "space": "node-local", "boxes": [
        {"name": name, **entry["footprint"]} for name, entry in manifest.items() if entry["solid"]
    ]}, handle, indent=2)
byte_size = os.path.getsize(os.path.join(OUT, "propkit.glb"))
if byte_size > 1500000:
    raise ValueError("propkit.glb exceeds 1.5 MB: " + str(byte_size))
print("PROPKIT_DONE", OUT, "nodes", len(objects), "bytes", byte_size,
      "triangles", sum(entry["triangles"] for entry in manifest.values()))
