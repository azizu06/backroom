"""Layout-driven hall. Blender 4.0.2 CPU; the only authored input is --layout JSON.

Pure hall_plan() is also exercised without Blender by the office contract tests.
All dimensions are metres in web coordinates (+x east, +z south, y up).
"""
import json
import math
import os
import sys


def hall_plan(layout):
    """Boxes/cones in web coordinates, with no furniture or ground-level supports."""
    building = layout["BUILDING"]
    height, thickness = layout["WALL_HEIGHT"], layout["WALL_THICKNESS"]
    x0, x1, z0, z1 = (building[k] for k in ("minX", "maxX", "minZ", "maxZ"))
    parts = []

    def box(group, role, at, size, shape="box"):
        if min(size) > 0:
            parts.append(dict(group=group, role=role, at=at, size=size, shape=shape))

    box("floor", "floor", [(x0 + x1) / 2, -0.1, (z0 + z1) / 2], [x1 - x0, 0.2, z1 - z0])
    for pod in layout["POD_BOUNDS"]:
        box("floor", "rug" if pod["id"] % 2 == 0 else "roomPad",
            [(pod["minX"] + pod["maxX"]) / 2, 0.006, (pod["minZ"] + pod["maxZ"]) / 2],
            [pod["maxX"] - pod["minX"] + 0.4, 0.012, pod["maxZ"] - pod["minZ"] + 0.4])

    for wall in layout["WALLS"]:
        axis, fixed = wall["axis"], wall["fixed"]
        # BUILDING is the inner face. The thickness extends outside it, never into a pod/board.
        if wall["exterior"]:
            low = x0 if axis == "z" else z0
            fixed += (-1 if abs(fixed - low) < 0.001 else 1) * thickness / 2
        group = "wall_" + wall["id"]

        def strip(group, role, start, end, bottom, top, depth=thickness):
            mid, y = (start + end) / 2, (bottom + top) / 2
            if axis == "x":
                box(group, role, [mid, y, fixed], [end - start, top - bottom, depth])
            else:
                box(group, role, [fixed, y, mid], [depth, top - bottom, end - start])

        openings = []
        for door in layout["DOORWAYS"]:
            along, across = (door["at"] if axis == "x" else reversed(door["at"]))
            if door["axis"] == axis and abs(across - wall["fixed"]) < 0.001:
                openings.append((along - door["width"] / 2, along + door["width"] / 2, 0, layout["DOOR_OPENING_HEIGHT"]))
        for window in layout["WINDOWS"]:
            if window["wall"] != wall["id"]:
                continue
            start, end = window["at"] - window["width"] / 2, window["at"] + window["width"] / 2
            sill, head = layout["WINDOW_SILL"], layout["WINDOW_HEAD"]
            openings.append((start, end, sill, head))
            # Open glazing: frames cast into the lightmap; no opaque baked pane over the outdoor view.
            for a, b in ((start, start + 0.045), (end - 0.045, end)):
                strip("windows", "frame", a, b, sill, head)
            for a, b in ((sill, sill + 0.045), (head - 0.045, head)):
                strip("windows", "frame", start, end, a, b)
        # A 2D grid handles overlapping openings without accidentally filling part of a doorway.
        cuts = sorted({wall["from"], wall["to"], *[max(wall["from"], min(wall["to"], p)) for o in openings for p in o[:2]]})
        for start, end in zip(cuts, cuts[1:]):
            spans = sorted((bottom, top) for a, b, bottom, top in openings if a < end and b > start)
            cursor = 0
            for bottom, top in spans:
                strip(group, "wall", start, end, cursor, min(bottom, height))
                cursor = max(cursor, top)
            strip(group, "wall", start, end, cursor, height)

    box("ceiling", "ceiling", [(x0 + x1) / 2, height + 0.06, (z0 + z1) / 2], [x1 - x0, 0.12, z1 - z0])
    count = max(2, math.ceil((x1 - x0) / 4))
    for i in range(count):
        x = x0 + (i + 0.5) * (x1 - x0) / count
        box("beams", "desk", [x, height - 0.09, (z0 + z1) / 2], [0.18, 0.18, z1 - z0])
        for fraction in (0.3, 0.7):
            z = z0 + (z1 - z0) * fraction
            y = max(2.4, height - 0.5)
            box("lamps", "frame", [x, (y + height) / 2, z], [0.018, height - y, 0.018])
            box("lamps", "lampLight", [x, y, z], [0.38, 0.18, 0.38], "cone")
    return parts


def validate_clearance(layout, parts):
    for part in parts:
        if part["group"] == "floor":  # floor/rugs intentionally sit below the occupied pod volume
            continue
        x, y, z = part["at"]
        sx, sy, sz = part["size"]
        for pod in layout["POD_BOUNDS"]:
            if (x + sx / 2 > pod["minX"] and x - sx / 2 < pod["maxX"]
                    and z + sz / 2 > pod["minZ"] and z - sz / 2 < pod["maxZ"]
                    and y + sy / 2 > pod["minY"] and y - sy / 2 < pod["maxY"]):
                raise ValueError("shell intersects pod " + str(pod["id"]))


def linear(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def bake(layout, out, size, samples, threads):
    import bpy
    from mathutils import Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    parts = hall_plan(layout)
    validate_clearance(layout, parts)
    roles, materials, group_of = layout["ROLES"], {}, {}
    for part in parts:
        group, role = part["group"], part["role"]
        key = group + ":" + role
        if key not in materials:
            mat = bpy.data.materials.new(key)
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs["Base Color"].default_value = (*linear(roles[role]), 1)
            bsdf.inputs["Roughness"].default_value = 0.85
            if role == "lampLight":
                bsdf.inputs["Emission Color"].default_value = (*linear(roles[role]), 1)
                bsdf.inputs["Emission Strength"].default_value = 0.4
            materials[key], group_of[key] = mat, group
        x, y, z = part["at"]
        sx, sy, sz = part["size"]
        if part["shape"] == "cone":
            bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=sx / 2, radius2=sx / 5, depth=sy, location=(x, -z, y))
        else:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
            bpy.context.object.scale = (sx, sz, sy)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj = bpy.context.object
        obj.data.materials.append(materials[key])
        # Small rounded edges catch baked light without moving any bounding face.
        bevel = obj.modifiers.new("soft_edges", "BEVEL")
        bevel.width, bevel.segments = min(0.008, min(sx, sy, sz) / 4), 2
        bpy.ops.object.modifier_apply(modifier=bevel.name)

    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()
    shell = bpy.context.object
    shell.data.uv_layers.new(name="lightmap")
    shell.data.uv_layers.active = shell.data.uv_layers["lightmap"]
    shell.data.uv_layers["lightmap"].active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    image = bpy.data.images.new("hall_lightmap", size, size, alpha=False)
    image.colorspace_settings.name = "sRGB"
    for mat in materials.values():
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        mat.node_tree.nodes.active = node

    world = bpy.data.worlds.new("cool_fill")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*linear(roles["fillLight"]), 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    scene.world = world
    sun = bpy.data.lights.new("south_west_sun", "SUN")
    sun.energy, sun.angle, sun.color = 1.0, math.radians(12), linear(roles["lampLight"])
    obj = bpy.data.objects.new("south_west_sun", sun)
    # Incoming sunlight travels north/east/down in web coordinates.
    obj.rotation_euler = Vector((1, 1, -1)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(obj)
    for i, part in enumerate(p for p in parts if p["shape"] == "cone"):
        x, y, z = part["at"]
        lamp = bpy.data.lights.new("warm_" + str(i), "AREA")
        lamp.energy, lamp.size, lamp.color = 30, 0.5, linear(roles["lampLight"])
        obj = bpy.data.objects.new(lamp.name, lamp)
        obj.location = (x, -z, y - 0.11)
        scene.collection.objects.link(obj)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.render.threads_mode = "FIXED"
    scene.render.threads = threads
    scene.view_settings.view_transform = "Standard"
    scene.render.bake.margin = 8
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.bake(type="COMBINED")
    image.filepath_raw, image.file_format = os.path.join(out, "hall_lightmap.png"), "PNG"
    image.save()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")

    final = bpy.data.materials.new("hall_baked")
    final.use_nodes = True
    tex = final.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    final.node_tree.links.new(tex.outputs["Color"], final.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    groups = {}
    for obj in list(scene.objects):
        if obj.type == "MESH":
            material = obj.material_slots[obj.data.polygons[0].material_index].material.name
            groups.setdefault(group_of[material], []).append(obj)
    wall_root = bpy.data.objects.new("walls", None)
    scene.collection.objects.link(wall_root)
    for name, members in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        obj.data.materials.clear()
        obj.data.materials.append(final)
        for face in obj.data.polygons:
            face.material_index = 0
        obj.data.uv_layers.active = obj.data.uv_layers["lightmap"]
        for layer in list(obj.data.uv_layers):
            if layer.name != "lightmap":
                obj.data.uv_layers.remove(layer)
        if name.startswith("wall_"):
            obj.parent = wall_root
    bpy.ops.object.select_all(action="DESELECT")
    for obj in scene.objects:
        if obj.type == "MESH" or obj == wall_root:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "hall.glb"), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_lights=False, export_cameras=False,
                              export_image_format="WEBP", export_jpeg_quality=85)
    with open(os.path.join(out, "hall.colliders.json"), "w") as stream:
        json.dump({"room": "hall", "boxes": layout["WALL_COLLIDERS"]}, stream, indent=2)
    print("HALL_DONE", len(groups), "mesh nodes; lightmap", size, "px")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    out = arg("--out")
    if not out:
        raise ValueError("--out is required")
    os.makedirs(out, exist_ok=True)
    with open(arg("--layout", "/bake/hall.layout.json")) as stream:
        layout = json.load(stream)
    if layout.get("BOARD_WINDOW_CONFLICTS"):
        print("PHASE_1_ONLY: north window overlaps ticket-board span; final layout must resolve this")
    bake(layout, out, max(64, min(2048, int(arg("--size", "2048")))), int(arg("--samples", "256")),
         max(1, min(8, int(arg("--threads", "8")))))


if __name__ == "__main__":
    main()
