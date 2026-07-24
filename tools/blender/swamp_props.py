"""Shared prop generators for the Rust-Craft swamp biome.

Builds low-poly, flat-shaded meshes (gnarled tree, hanging moss, marsh
flower clump, lily pad) that match the game's existing stylized foliage
assets (packages/client/public/assets/models/foliage). Used by both
build_swamp_scene.py (concept diorama) and export_swamp_props.py
(game-ready GLB export).

Run only from inside Blender (bpy is not importable standalone):
    blender --background --python build_swamp_scene.py
    blender --background --python export_swamp_props.py
"""

import math
import random

import bmesh
import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def make_material(name, base_color, roughness=0.9, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    return mat


BARK = make_material("Swamp_Bark", (0.10, 0.075, 0.05), roughness=0.95)
BARK_MOSSY = make_material("Swamp_Bark_Mossy", (0.09, 0.10, 0.055), roughness=0.9)
CANOPY_DARK = make_material("Swamp_Canopy_Dark", (0.045, 0.11, 0.055), roughness=0.85)
CANOPY_LIGHT = make_material("Swamp_Canopy_Light", (0.09, 0.19, 0.08), roughness=0.8)
MOSS = make_material("Swamp_Moss", (0.13, 0.16, 0.07), roughness=0.95)
LILY_TOP = make_material("Swamp_Lily_Top", (0.06, 0.20, 0.08), roughness=0.4)
LILY_BOTTOM = make_material("Swamp_Lily_Bottom", (0.10, 0.06, 0.05), roughness=0.6)
STEM = make_material("Swamp_Stem", (0.10, 0.16, 0.06), roughness=0.85)

FLOWER_COLORS = [
    make_material("Swamp_Flower_White", (0.85, 0.85, 0.78), roughness=0.5),
    make_material("Swamp_Flower_Yellow", (0.85, 0.65, 0.08), roughness=0.5),
    make_material("Swamp_Flower_Pink", (0.72, 0.22, 0.38), roughness=0.5),
    make_material("Swamp_Flower_Purple", (0.36, 0.16, 0.46), roughness=0.5),
]
FLOWER_CENTER = make_material("Swamp_Flower_Center", (0.55, 0.42, 0.05), roughness=0.6)


def new_mesh_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def shade_flat(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = False


def join_objects(objs, name):
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name
    return result


# ---------------------------------------------------------------------------
# Gnarled swamp tree
# ---------------------------------------------------------------------------


def _tapered_trunk(bm, path, radii, mat_index_map=None):
    """Bridge a series of (center, radius) rings into a tapered tube."""
    rings = []
    segs = 7
    up = Vector((0, 0, 1))
    for i, (center, radius) in enumerate(zip(path, radii)):
        if i == 0:
            direction = (path[1] - path[0]).normalized()
        elif i == len(path) - 1:
            direction = (path[i] - path[i - 1]).normalized()
        else:
            direction = (path[i + 1] - path[i - 1]).normalized()
        tangent = direction.cross(up)
        if tangent.length < 1e-5:
            tangent = Vector((1, 0, 0))
        tangent.normalize()
        bitangent = direction.cross(tangent).normalized()
        ring = []
        for s in range(segs):
            a = (s / segs) * math.tau
            offset = tangent * math.cos(a) * radius + bitangent * math.sin(a) * radius
            ring.append(bm.verts.new(center + offset))
        rings.append(ring)

    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for s in range(segs):
            s2 = (s + 1) % segs
            bm.faces.new((a[s], a[s2], b[s2], b[s]))

    # cap top
    top = rings[-1]
    if len(top) >= 3:
        bm.faces.new(top)
    return rings[0]


def build_swamp_tree(seed=0, height=9.0, name="swamp_tree"):
    """A large gnarled cypress/mangrove-style swamp tree with buttress
    roots, a leaning twisted trunk, low spreading branches, dense dark
    canopy clumps and a few hanging moss strands."""
    rng = random.Random(seed)
    objs = []

    # --- trunk: leaning, twisting path from root to crown ---
    bm = bmesh.new()
    n = 9
    path = []
    radii = []
    lean_dir = rng.uniform(0, math.tau)
    lean = rng.uniform(0.35, 0.7)
    for i in range(n):
        t = i / (n - 1)
        h = t * height * 0.62
        wobble = math.sin(t * math.pi * 2.2 + seed) * 0.35 * t
        x = math.cos(lean_dir) * lean * t * t * height * 0.1 + math.cos(lean_dir + 1.7) * wobble
        y = math.sin(lean_dir) * lean * t * t * height * 0.1 + math.sin(lean_dir + 1.7) * wobble
        path.append(Vector((x, y, h)))
        base_r = height * 0.075
        if t < 0.18:
            # flared buttress roots near the waterline
            radii.append(base_r * (1.0 + (0.18 - t) * 5.0))
        else:
            radii.append(base_r * (1.0 - t) ** 0.7 + height * 0.012)
    _tapered_trunk(bm, path, radii)
    trunk_obj = new_mesh_object(f"{name}_trunk", bm)
    trunk_obj.data.materials.append(BARK)
    shade_flat(trunk_obj)
    objs.append(trunk_obj)

    crown = path[-1]
    branch_tips = []

    # --- low spreading branches ---
    branch_count = rng.randint(3, 4)
    for bidx in range(branch_count):
        bm2 = bmesh.new()
        start_t = rng.uniform(0.45, 0.85)
        start = path[int(start_t * (n - 1))]
        start_r = radii[int(start_t * (n - 1))]
        ang = rng.uniform(0, math.tau)
        reach = height * rng.uniform(0.28, 0.42)
        bpath = []
        bradii = []
        segs_b = 5
        for j in range(segs_b):
            t = j / (segs_b - 1)
            sag = -((t) ** 1.6) * height * 0.05
            rise = t * height * 0.08
            bx = start.x + math.cos(ang) * reach * t
            by = start.y + math.sin(ang) * reach * t
            bz = start.z + rise + sag
            bpath.append(Vector((bx, by, bz)))
            bradii.append(start_r * (1.0 - 0.8 * t) + 0.03)
        _tapered_trunk(bm2, bpath, bradii)
        b_obj = new_mesh_object(f"{name}_branch{bidx}", bm2)
        b_obj.data.materials.append(BARK_MOSSY)
        shade_flat(b_obj)
        objs.append(b_obj)
        branch_tips.append(bpath[-1])

    # --- canopy: dense overlapping foliage clumps at crown + branch tips ---
    canopy_objs = []
    canopy_points = [crown] + branch_tips
    for cidx, point in enumerate(canopy_points):
        cluster_r = height * rng.uniform(0.16, 0.22)
        blobs = rng.randint(4, 6)
        for k in range(blobs):
            bpy.ops.mesh.primitive_ico_sphere_add(
                subdivisions=1,
                radius=cluster_r * rng.uniform(0.5, 0.85),
                location=(
                    point.x + rng.uniform(-cluster_r, cluster_r) * 0.7,
                    point.y + rng.uniform(-cluster_r, cluster_r) * 0.7,
                    point.z + rng.uniform(-cluster_r, cluster_r) * 0.5 + cluster_r * 0.3,
                ),
            )
            blob = bpy.context.active_object
            blob.scale.z *= 0.75
            mat = CANOPY_LIGHT if rng.random() < 0.3 else CANOPY_DARK
            blob.data.materials.append(mat)
            shade_flat(blob)
            canopy_objs.append(blob)
    objs.extend(canopy_objs)

    # --- hanging moss strands from a few branch/trunk points ---
    moss_objs = []
    moss_sources = branch_tips + [path[int(0.7 * (n - 1))]]
    for midx, src in enumerate(moss_sources):
        if rng.random() < 0.35:
            continue
        curve = bpy.data.curves.new(f"{name}_moss{midx}", type="CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.02
        curve.bevel_resolution = 2
        spline = curve.splines.new("BEZIER")
        drop = height * rng.uniform(0.12, 0.28)
        n_pts = 3
        spline.bezier_points.add(n_pts - 1)
        for pi in range(n_pts):
            t = pi / (n_pts - 1)
            sway = math.sin(t * math.pi) * 0.15
            co = Vector((src.x + sway, src.y, src.z - drop * t))
            bp = spline.bezier_points[pi]
            bp.co = co
            bp.handle_left = co + Vector((0, 0, drop / n_pts * 0.4))
            bp.handle_right = co - Vector((0, 0, drop / n_pts * 0.4))
        moss_obj = bpy.data.objects.new(f"{name}_moss{midx}", curve)
        bpy.context.collection.objects.link(moss_obj)
        bpy.context.view_layer.objects.active = moss_obj
        moss_obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        moss_obj.data.materials.append(MOSS)
        moss_objs.append(moss_obj)
    objs.extend(moss_objs)

    result = join_objects(objs, name)
    result.location = (0, 0, 0)
    return result


# ---------------------------------------------------------------------------
# Marsh flower clump
# ---------------------------------------------------------------------------


def build_flower_clump(seed=0, name="flower_marsh"):
    rng = random.Random(seed + 1000)
    objs = []
    stems = rng.randint(5, 7)
    for i in range(stems):
        ang = rng.uniform(0, math.tau)
        dist = rng.uniform(0.0, 0.12)
        base = Vector((math.cos(ang) * dist, math.sin(ang) * dist, 0))
        stem_h = rng.uniform(0.22, 0.4)

        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.008, depth=stem_h, location=(base.x, base.y, stem_h / 2), vertices=5
        )
        stem = bpy.context.active_object
        stem.rotation_euler = (rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0)
        stem.data.materials.append(STEM)
        shade_flat(stem)
        objs.append(stem)

        top = Vector((base.x, base.y, stem_h))
        petal_color = FLOWER_COLORS[rng.randrange(len(FLOWER_COLORS))]
        petal_count = rng.randint(5, 6)
        petal_r = rng.uniform(0.045, 0.065)
        for p in range(petal_count):
            pang = (p / petal_count) * math.tau
            bpy.ops.mesh.primitive_ico_sphere_add(
                subdivisions=1,
                radius=petal_r,
                location=(
                    top.x + math.cos(pang) * petal_r * 0.9,
                    top.y + math.sin(pang) * petal_r * 0.9,
                    top.z,
                ),
            )
            petal = bpy.context.active_object
            petal.scale = (1.0, 1.0, 0.35)
            petal.data.materials.append(petal_color)
            shade_flat(petal)
            objs.append(petal)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=petal_r * 0.5, location=(top.x, top.y, top.z))
        center = bpy.context.active_object
        center.scale = (1.0, 1.0, 0.6)
        center.data.materials.append(FLOWER_CENTER)
        shade_flat(center)
        objs.append(center)

    result = join_objects(objs, name)
    result.location = (0, 0, 0)
    return result


# ---------------------------------------------------------------------------
# Lily pad
# ---------------------------------------------------------------------------


def build_lily_pad(seed=0, name="lily_pad", radius=0.35):
    rng = random.Random(seed + 2000)
    bm = bmesh.new()
    verts_top = []
    verts_bottom = []
    thickness = radius * 0.06
    notch = math.radians(18)
    n = 20
    center_top = bm.verts.new((0, 0, thickness / 2))
    center_bottom = bm.verts.new((0, 0, -thickness / 2))
    for i in range(n + 1):
        t = i / n
        a = notch + t * (math.tau - 2 * notch)
        r = radius * (0.92 + rng.uniform(-0.06, 0.06))
        x, y = math.cos(a) * r, math.sin(a) * r
        curl = -abs(t - 0.5) * 0  # keep flat; curl handled by edge verts below
        verts_top.append(bm.verts.new((x, y, thickness / 2 + curl)))
        verts_bottom.append(bm.verts.new((x, y, -thickness / 2 + curl)))

    for i in range(n):
        bm.faces.new((center_top, verts_top[i], verts_top[i + 1]))
        bm.faces.new((center_bottom, verts_bottom[i + 1], verts_bottom[i]))
    for i in range(n):
        a, b = verts_top[i], verts_top[i + 1]
        c, d = verts_bottom[i], verts_bottom[i + 1]
        bm.faces.new((a, b, d, c))
    # close the notch wedge
    bm.faces.new((center_top, verts_top[-1], verts_bottom[-1], center_bottom))
    bm.faces.new((center_top, center_bottom, verts_bottom[0], verts_top[0]))

    obj = new_mesh_object(name, bm)
    obj.data.materials.append(LILY_TOP)
    obj.data.materials.append(LILY_BOTTOM)
    for poly in obj.data.polygons:
        poly.material_index = 0 if poly.normal.z >= 0 else 1
    shade_flat(obj)
    return obj
