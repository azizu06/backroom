"""Exterior backdrop derived only from hall.layout.json; every mesh stays outside BUILDING + 0.5 m."""
import json
import math
import os
import sys


def exterior_plan(layout):
    b = layout["BUILDING"]
    bounds = {"minX": b["minX"] - 0.5, "maxX": b["maxX"] + 0.5,
              "minZ": b["minZ"] - 0.5, "maxZ": b["maxZ"] + 0.5}
    x0, x1, z0, z1 = (bounds[k] for k in ("minX", "maxX", "minZ", "maxZ"))
    width, depth, reach = x1 - x0, z1 - z0, 12
    parts = []
    for name, x, z, sx, sz in (
        ("north", (x0 + x1) / 2, z0 - reach / 2, width + 2 * reach, reach),
        ("south", (x0 + x1) / 2, z1 + reach / 2, width + 2 * reach, reach),
        ("west", x0 - reach / 2, (z0 + z1) / 2, reach, depth),
        ("east", x1 + reach / 2, (z0 + z1) / 2, reach, depth),
    ):
        parts.append(dict(name="ground_" + name, at=[x, -0.16, z], size=[sx, 0.12, sz], color="mint"))
        # Low distant hedges, not walls beside the windows. Never an indoor wall_near.
        for i in range(8):
            if name in ("north", "south"):
                px, pz = x0 + (i + 0.5) * width / 8, z + (-1 if name == "north" else 1) * reach / 3
            else:
                px, pz = x + (-1 if name == "west" else 1) * reach / 3, z0 + (i + 0.5) * depth / 8
            h = 1.4 + (i % 3) * 0.35
            parts.append(dict(name="hedge_" + name, at=[px, h / 2, pz], size=[1.8, h, 1.8], color="mint" if i % 2 else "slate"))
    return bounds, parts


def bake(layout, out, size, samples, threads):
    import bpy
    from mathutils import Vector

    def linear(color):
        values = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bounds, parts = exterior_plan(layout)
    materials = {}
    for part in parts:
        color = part["color"]
        if color not in materials:
            material = bpy.data.materials.new(color)
            material.use_nodes = True
            material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*linear(layout["PALETTE"][color]), 1)
            materials[color] = material
        x, y, z = part["at"]
        sx, sy, sz = part["size"]
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
        obj = bpy.context.object
        obj.scale = (sx, sz, sy)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(materials[color])
        if part["name"].startswith("hedge"):
            bevel = obj.modifiers.new("soft_hedge", "BEVEL")
            bevel.width, bevel.segments = 0.35, 3
            bpy.ops.object.modifier_apply(modifier=bevel.name)
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()
    shell = bpy.context.object
    shell.name = "exterior"
    shell.data.uv_layers.new(name="lightmap")
    shell.data.uv_layers.active = shell.data.uv_layers["lightmap"]
    shell.data.uv_layers["lightmap"].active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.008)
    bpy.ops.object.mode_set(mode="OBJECT")
    image = bpy.data.images.new("exterior_lightmap", size, size, alpha=False)
    for material in materials.values():
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        material.node_tree.nodes.active = node
    world = bpy.data.worlds.new("cool_fill")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*linear(layout["ROLES"]["fillLight"]), 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.3
    scene.world = world
    light = bpy.data.lights.new("south_west_sun", "SUN")
    light.energy, light.angle, light.color = 1, math.radians(12), linear(layout["ROLES"]["lampLight"])
    obj = bpy.data.objects.new(light.name, light)
    obj.rotation_euler = Vector((1, 1, -1)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(obj)
    scene.render.engine = "CYCLES"
    scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising = "CPU", samples, False
    scene.render.threads_mode, scene.render.threads = "FIXED", threads
    scene.view_settings.view_transform = "Standard"
    scene.render.bake.margin = 8
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.bake(type="COMBINED")
    image.filepath_raw, image.file_format = os.path.join(out, "exterior_lightmap.png"), "PNG"
    image.save()
    material = bpy.data.materials.new("exterior_baked")
    material.use_nodes = True
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(tex.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    shell.data.materials.clear()
    shell.data.materials.append(material)
    for face in shell.data.polygons:
        face.material_index = 0
    shell.data.uv_layers.active = shell.data.uv_layers["lightmap"]
    for layer in list(shell.data.uv_layers):
        if layer.name != "lightmap":
            shell.data.uv_layers.remove(layer)
    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "exterior.glb"), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_lights=False, export_cameras=False,
                              export_image_format="WEBP", export_jpeg_quality=85)
    with open(os.path.join(out, "exterior.bounds.json"), "w") as stream:
        json.dump({"building": layout["BUILDING"], "exclusion": bounds}, stream, indent=2)
    print("EXTERIOR_DONE", bounds)


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
    bake(layout, out, max(64, min(1024, int(arg("--size", "1024")))), int(arg("--samples", "128")),
         max(1, min(8, int(arg("--threads", "8")))))


if __name__ == "__main__":
    main()
