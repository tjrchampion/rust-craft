"""Builds a swamp-biome concept diorama in Blender and renders a preview.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
        tools/blender/build_swamp_scene.py -- <out_dir>

Produces <out_dir>/swamp_biome_concept.blend and .png.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import swamp_props as sp  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else SCRIPT_DIR

random.seed(7)

# ---------------------------------------------------------------------------
# Clear scene
# ---------------------------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block_type in (bpy.data.meshes, bpy.data.curves):
    for block in list(block_type):
        if block.users == 0:
            block_type.remove(block)

GROUND_SIZE = 26.0
GRID_N = 100

# ---------------------------------------------------------------------------
# River path (world space, XY) — a gentle S-curve across the ground
# ---------------------------------------------------------------------------
RIVER_POINTS = [
    Vector((-GROUND_SIZE / 2 - 2, -3.0)),
    Vector((-4.0, -1.5)),
    Vector((-0.5, 1.0)),
    Vector((3.5, 0.5)),
    Vector((7.0, -2.0)),
    Vector((GROUND_SIZE / 2 + 2, -1.0)),
]
RIVER_WIDTH = 2.6


def dist_to_polyline(p, points):
    best = 1e9
    best_t_global = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        ab = b - a
        ab_len2 = ab.length_squared
        t = 0.0 if ab_len2 < 1e-9 else max(0.0, min(1.0, (p - a).dot(ab) / ab_len2))
        proj = a + ab * t
        d = (p - proj).length
        if d < best:
            best = d
            best_t_global = (i + t) / (len(points) - 1)
    return best, best_t_global


# ---------------------------------------------------------------------------
# Ground: boggy, uneven terrain with a carved river channel
# ---------------------------------------------------------------------------
bm = bmesh.new()
grid_verts = {}
half = GROUND_SIZE / 2
for iy in range(GRID_N + 1):
    for ix in range(GRID_N + 1):
        x = -half + GROUND_SIZE * ix / GRID_N
        y = -half + GROUND_SIZE * iy / GRID_N
        d, _t = dist_to_polyline(Vector((x, y)), RIVER_POINTS)
        bog = noise.noise(Vector((x * 0.15, y * 0.15, 0.0))) * 0.35
        bog += noise.noise(Vector((x * 0.6, y * 0.6, 5.0))) * 0.1
        river_t = max(0.0, 1.0 - d / (RIVER_WIDTH * 1.6))
        z = bog - river_t * 1.4
        v = bm.verts.new((x, y, z))
        grid_verts[(ix, iy)] = v

for iy in range(GRID_N):
    for ix in range(GRID_N):
        a = grid_verts[(ix, iy)]
        b = grid_verts[(ix + 1, iy)]
        c = grid_verts[(ix + 1, iy + 1)]
        d = grid_verts[(ix, iy + 1)]
        bm.faces.new((a, b, c, d))

bm.normal_update()
ground_obj = sp.new_mesh_object("ground", bm)

mud = sp.make_material("Swamp_Mud", (0.085, 0.07, 0.045), roughness=0.95)
moss_ground = sp.make_material("Swamp_Ground_Moss", (0.10, 0.145, 0.055), roughness=0.9)
ground_obj.data.materials.append(mud)
ground_obj.data.materials.append(moss_ground)

# vertex-driven material blend: mossy on high ground, mud near the river/low spots
for poly in ground_obj.data.polygons:
    zs = [ground_obj.data.vertices[i].co.z for i in poly.vertices]
    avg_z = sum(zs) / len(zs)
    poly.material_index = 1 if avg_z > -0.05 else 0

bpy.ops.object.select_all(action="DESELECT")
ground_obj.select_set(True)
bpy.context.view_layer.objects.active = ground_obj
bpy.ops.object.shade_smooth()

# ---------------------------------------------------------------------------
# River water ribbon
# ---------------------------------------------------------------------------
bm_w = bmesh.new()
samples = 40
left_chain, right_chain = [], []
for i in range(samples + 1):
    t = i / samples
    fi = t * (len(RIVER_POINTS) - 1)
    seg = min(int(fi), len(RIVER_POINTS) - 2)
    local_t = fi - seg
    a, b = RIVER_POINTS[seg], RIVER_POINTS[seg + 1]
    center = a.lerp(b, local_t)
    tangent = (b - a).normalized()
    normal = Vector((-tangent.y, tangent.x))
    w = RIVER_WIDTH * (0.85 + 0.3 * noise.noise(Vector((t * 5.0, 0, 9.0))))
    left = center + normal * (w / 2)
    right = center - normal * (w / 2)
    left_chain.append(bm_w.verts.new((left.x, left.y, -0.35)))
    right_chain.append(bm_w.verts.new((right.x, right.y, -0.35)))

for i in range(samples):
    bm_w.faces.new((left_chain[i], right_chain[i], right_chain[i + 1], left_chain[i + 1]))

water_obj = sp.new_mesh_object("river_water", bm_w)
water_mat = sp.make_material("Swamp_Water", (0.04, 0.09, 0.06), roughness=0.12, alpha=0.88)
bsdf = water_mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Transmission Weight"].default_value = 0.85
bsdf.inputs["IOR"].default_value = 1.33
water_mat.blend_method = "BLEND"
water_mat.show_transparent_back = False
water_obj.data.materials.append(water_mat)
bpy.ops.object.select_all(action="DESELECT")
water_obj.select_set(True)
bpy.context.view_layer.objects.active = water_obj
bpy.ops.object.shade_smooth()

# ---------------------------------------------------------------------------
# Scatter: large trees, flower clumps, lily pads
# ---------------------------------------------------------------------------
placed = []


def far_enough(x, y, min_dist=2.2):
    for px, py in placed:
        if (px - x) ** 2 + (py - y) ** 2 < min_dist * min_dist:
            return False
    return True


def clear_of_river(x, y, margin=1.4):
    d, _t = dist_to_polyline(Vector((x, y)), RIVER_POINTS)
    return d > RIVER_WIDTH / 2 + margin


tree_seed = 100
trees_placed = 0
attempts = 0
while trees_placed < 6 and attempts < 400:
    attempts += 1
    x = random.uniform(-half + 1.5, half - 1.5)
    y = random.uniform(-half + 1.5, half - 1.5)
    if not clear_of_river(x, y, margin=1.8) or not far_enough(x, y, 3.2):
        continue
    height = random.uniform(7.5, 10.5)
    tree = sp.build_swamp_tree(seed=tree_seed, height=height, name=f"swamp_tree_{trees_placed}")
    tree.location = (x, y, 0.15)
    tree.rotation_euler = (0, 0, random.uniform(0, math.tau))
    placed.append((x, y))
    tree_seed += 1
    trees_placed += 1

flower_seed = 200
flowers_placed = 0
attempts = 0
while flowers_placed < 16 and attempts < 400:
    attempts += 1
    x = random.uniform(-half + 0.5, half - 0.5)
    y = random.uniform(-half + 0.5, half - 0.5)
    if not clear_of_river(x, y, margin=0.6) or not far_enough(x, y, 1.1):
        continue
    d, _t = dist_to_polyline(Vector((x, y)), RIVER_POINTS)
    z = -0.05 if d < 4 else 0.05
    clump = sp.build_flower_clump(seed=flower_seed, name=f"flower_{flowers_placed}")
    clump.location = (x, y, z)
    clump.rotation_euler = (0, 0, random.uniform(0, math.tau))
    scale = random.uniform(0.8, 1.3)
    clump.scale = (scale, scale, scale)
    placed.append((x, y))
    flower_seed += 1
    flowers_placed += 1

for i in range(7):
    t = 0.12 + i * 0.11 + random.uniform(-0.02, 0.02)
    fi = t * (len(RIVER_POINTS) - 1)
    seg = min(int(fi), len(RIVER_POINTS) - 2)
    local_t = fi - seg
    a, b = RIVER_POINTS[seg], RIVER_POINTS[seg + 1]
    center = a.lerp(b, local_t)
    tangent = (b - a).normalized()
    normal = Vector((-tangent.y, tangent.x))
    off = random.uniform(-1, 1) * RIVER_WIDTH * 0.3
    pos = center + normal * off
    pad = sp.build_lily_pad(seed=300 + i, name=f"lily_pad_{i}", radius=random.uniform(0.28, 0.42))
    pad.location = (pos.x, pos.y, -0.33)
    pad.rotation_euler = (0, 0, random.uniform(0, math.tau))

# ---------------------------------------------------------------------------
# Atmosphere: hazy world + volumetric fog
# ---------------------------------------------------------------------------
world = bpy.data.worlds[0]
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.42, 0.47, 0.42, 1.0)
bg.inputs["Strength"].default_value = 0.55

vol_node = world.node_tree.nodes.new("ShaderNodeVolumeScatter")
vol_node.inputs["Color"].default_value = (0.55, 0.58, 0.5, 1.0)
vol_node.inputs["Density"].default_value = 0.018
world.node_tree.links.new(vol_node.outputs["Volume"], world.node_tree.nodes["World Output"].inputs["Volume"])

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"

# ---------------------------------------------------------------------------
# Lighting
# ---------------------------------------------------------------------------
sun_data = bpy.data.lights.new("SwampSun", type="SUN")
sun_data.energy = 2.2
sun_data.angle = math.radians(6.0)
sun_data.color = (0.95, 0.88, 0.65)
sun_obj = bpy.data.objects.new("SwampSun", sun_data)
bpy.context.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (math.radians(58), 0, math.radians(35))

fill_data = bpy.data.lights.new("SwampFill", type="AREA")
fill_data.energy = 60.0
fill_data.size = 12.0
fill_data.color = (0.55, 0.65, 0.75)
fill_obj = bpy.data.objects.new("SwampFill", fill_data)
bpy.context.collection.objects.link(fill_obj)
fill_obj.location = (-8, -10, 10)
fill_obj.rotation_euler = (math.radians(45), 0, math.radians(-30))

# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------
cam_data = bpy.data.cameras.new("SwampCam")
cam_data.lens = 32
cam_obj = bpy.data.objects.new("SwampCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (11.5, -13.0, 3.4)
target = Vector((-1.0, 1.5, 2.0))
direction = target - cam_obj.location
cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam_obj

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
if os.environ.get("SWAMP_DEBUG_EXPOSURE") != "1":
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
else:
    scene.render.resolution_percentage = 30
    scene.cycles.samples = 16
    bpy.context.view_layer.update()
    print("CAM_ROT_EULER", tuple(cam_obj.rotation_euler))
    print("CAM_LOC", tuple(cam_obj.location))
    print("CAM_FWD", tuple(cam_obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))))
    print("SUN_DIR", tuple(sun_obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))))
    bbox_min = Vector((1e9, 1e9, 1e9))
    bbox_max = Vector((-1e9, -1e9, -1e9))
    for o in bpy.data.objects:
        if o.type == "MESH":
            for corner in o.bound_box:
                world_co = o.matrix_world @ Vector(corner)
                bbox_min.x, bbox_min.y, bbox_min.z = min(bbox_min.x, world_co.x), min(bbox_min.y, world_co.y), min(bbox_min.z, world_co.z)
                bbox_max.x, bbox_max.y, bbox_max.z = max(bbox_max.x, world_co.x), max(bbox_max.y, world_co.y), max(bbox_max.z, world_co.z)
    print("SCENE_BBOX", tuple(bbox_min), tuple(bbox_max))

os.makedirs(OUT_DIR, exist_ok=True)
blend_path = os.path.join(OUT_DIR, "swamp_biome_concept.blend")
png_path = os.path.join(OUT_DIR, "swamp_biome_concept.png")

bpy.ops.wm.save_as_mainfile(filepath=blend_path)

scene.render.filepath = png_path
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)

print(f"SAVED_BLEND={blend_path}")
print(f"SAVED_PNG={png_path}")
