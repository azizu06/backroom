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
def make_material(name, color, roughness=0.85, brick=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
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


def build():
    w, d = X1 - X0, Z1 - Z0
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    # Floor (planks come from the floor material) and a darker border so the room reads as set into the slab.
    box("floor", cx, FLOOR_TOP - 0.02, cz, w + 0.3, 0.04, d + 0.1)
    # Ceiling (hidden by the web layer in the orthographic overview).
    box("ceiling", cx, WALL_H + 0.03, cz, w + 0.3, 0.06, d + 0.3)
    # Far walls: west and north (north has a doorway). Near walls: east and south.
    box("wall_far", X0 - WALL_T / 2, WALL_H / 2, cz, WALL_T, WALL_H, d + WALL_T)
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
    box("sofa", -7.5, 0.28, 3.25, 0.8, 0.4, 1.7, bevel=0.07)        # seat
    box("sofa", -7.76, 0.62, 3.25, 0.28, 0.5, 1.7, bevel=0.07)      # back
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
