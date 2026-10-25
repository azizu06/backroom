"""Pure geometry/input checks: python3 -B -m unittest discover -s tools/bake -p 'test_*.py'."""
import ast
import copy
import json
from pathlib import Path
import unittest

from hall import hall_plan, validate_clearance
from exterior import exterior_plan

ROOT = Path(__file__).parent
LAYOUT = json.loads((ROOT / "hall.layout.json").read_text())


def contains(part, point):
    return all(abs(v - at) < size / 2 - 1e-6 for v, at, size in zip(point, part["at"], part["size"]))


class HallGeometry(unittest.TestCase):
    def test_perimeter_faces_and_openings(self):
        solids = [p for p in hall_plan(LAYOUT) if p["group"].startswith("wall_")]
        for wall in LAYOUT["WALLS"]:
            axis = 2 if wall["axis"] == "x" else 0
            low = LAYOUT["BUILDING"]["minZ" if axis == 2 else "minX"]
            side = -1 if wall["fixed"] == low else 1
            pieces = [p for p in solids if p["group"] == "wall_" + wall["id"]]
            self.assertTrue(pieces)
            for p in pieces:
                self.assertLess(abs(p["at"][axis] - side * p["size"][axis] / 2 - wall["fixed"]), 0.02)

            def point(along, y):
                across = wall["fixed"] + side * LAYOUT["WALL_THICKNESS"] / 2
                return [along, y, across] if axis == 2 else [across, y, along]

            for w in (w for w in LAYOUT["WINDOWS"] if w["wall"] == wall["id"]):
                for u in (-0.49, 0, 0.49):
                    for y in (LAYOUT["WINDOW_SILL"] + 0.01, LAYOUT["WINDOW_HEAD"] - 0.01):
                        self.assertFalse(any(contains(p, point(w["at"] + u * w["width"], y)) for p in solids))
            for d in LAYOUT["DOORWAYS"]:
                if d["axis"] == wall["axis"] and d["at"][1 if axis == 2 else 0] == wall["fixed"]:
                    for u in (-0.49, 0, 0.49):
                        self.assertFalse(any(contains(p, point(d["at"][0 if axis == 2 else 1] + u * d["width"], 1)) for p in solids))

    def test_clearance_and_nodes(self):
        parts = hall_plan(LAYOUT)
        validate_clearance(LAYOUT, parts)
        self.assertEqual({p["group"] for p in parts}, {"floor", "wall_north", "wall_south", "wall_east", "wall_west", "ceiling", "beams", "windows", "lamps"})
        self.assertTrue(all(min(p["size"]) > 0 for p in parts))
        pod = LAYOUT["POD_BOUNDS"][0]
        obstruction = dict(group="beams", at=[(pod["minX"] + pod["maxX"]) / 2, 1, (pod["minZ"] + pod["maxZ"]) / 2], size=[1, 1, 1])
        with self.assertRaisesRegex(ValueError, "pod"):
            validate_clearance(LAYOUT, [obstruction])

    def test_exported_board_conflicts_are_explicit(self):
        board = LAYOUT["TICKET_BOARD"]
        conflicts = [w for w in LAYOUT["WINDOWS"] if w["wall"] == board["wall"]
                     and w["at"] + w["width"] / 2 > board["from"] and w["at"] - w["width"] / 2 < board["to"]]
        self.assertEqual(conflicts, LAYOUT["BOARD_WINDOW_CONFLICTS"])
        # No trims, columns or other decorative geometry anywhere along the north wall's board face.
        for p in hall_plan(LAYOUT):
            if p["group"] in ("floor", "wall_north", "ceiling", "windows", "beams"):
                continue
            self.assertFalse(p["at"][0] + p["size"][0] / 2 > board["from"] and p["at"][0] - p["size"][0] / 2 < board["to"]
                             and abs(p["at"][2] - board["fixed"]) < p["size"][2] / 2 + 0.2)

    def test_exterior_outside_half_metre_clearance(self):
        bounds, parts = exterior_plan(LAYOUT)
        b = LAYOUT["BUILDING"]
        self.assertEqual(bounds, {"minX": b["minX"] - 0.5, "maxX": b["maxX"] + 0.5, "minZ": b["minZ"] - 0.5, "maxZ": b["maxZ"] + 0.5})
        for p in parts:
            x, _, z = p["at"]
            sx, _, sz = p["size"]
            self.assertTrue(x + sx / 2 <= bounds["minX"] or x - sx / 2 >= bounds["maxX"]
                            or z + sz / 2 <= bounds["minZ"] or z - sz / 2 >= bounds["maxZ"])

    def test_translated_layout_has_no_hardcoded_room_origin(self):
        shifted = copy.deepcopy(LAYOUT)
        dx, dz = 3, 5
        for key in ("minX", "maxX"):
            shifted["BUILDING"][key] += dx
        for key in ("minZ", "maxZ"):
            shifted["BUILDING"][key] += dz
        for wall in shifted["WALLS"]:
            wall["fixed"] += dz if wall["axis"] == "x" else dx
            for key in ("from", "to"):
                wall[key] += dx if wall["axis"] == "x" else dz
        for door in shifted["DOORWAYS"]:
            door["at"][0] += dx
            door["at"][1] += dz
        for window in shifted["WINDOWS"]:
            wall = next(w for w in shifted["WALLS"] if w["id"] == window["wall"])
            window["at"] += dx if wall["axis"] == "x" else dz
        for pod in shifted["POD_BOUNDS"]:
            for key in ("minX", "maxX"):
                pod[key] += dx
            for key in ("minZ", "maxZ"):
                pod[key] += dz
        for before, after in zip(hall_plan(LAYOUT), hall_plan(shifted)):
            for i, offset in enumerate((dx, 0, dz)):
                self.assertAlmostEqual(before["at"][i] + offset, after["at"][i])
                self.assertAlmostEqual(before["size"][i], after["size"][i])

    def test_lightmap_active_before_unwrap(self):
        for name in ("hall.py", "exterior.py"):
            with self.subTest(script=name):
                source = (ROOT / name).read_text()
                created = source.index('shell.data.uv_layers.new(name="lightmap")')
                unwrap = source.index("bpy.ops.uv.smart_project(")
                self.assertLess(created, unwrap)
                setup = source[created:unwrap]
                self.assertIn('shell.data.uv_layers.active = shell.data.uv_layers["lightmap"]', setup)
                self.assertIn('shell.data.uv_layers["lightmap"].active_render = True', setup)

    def test_only_reviewed_imports_and_no_process_or_network_calls(self):
        for name in ("hall.py", "exterior.py"):
            tree = ast.parse((ROOT / name).read_text())
            imports = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
            imports.update(a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names)
            self.assertLessEqual(imports, {"bpy", "mathutils", "math", "os", "sys", "json"})
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, ("exec", "eval", "__import__"))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "os":
                    self.assertEqual(node.func.attr, "makedirs")


if __name__ == "__main__":
    unittest.main()
