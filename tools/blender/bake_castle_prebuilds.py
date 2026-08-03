#!/usr/bin/env python3
"""Bake Unity Prebuilds/*.prefab into combined textured glTFs.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/blender/bake_castle_prebuilds.py
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SRC = Path("/Users/champion/My project/Assets/_ASSETS/3d Castle Pack")
DEFAULT_OUT = REPO / "packages/client/public/assets/models/buildings/castle_pack"

# Reuse material map / texture rewrite from the piece importer.
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "import_castle_pack",
    REPO / "tools/blender/import_castle_pack.py",
)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)

ensure_shared_textures = _mod.ensure_shared_textures
fix_material = _mod.fix_material
rewrite_gltf_to_shared_textures = _mod.rewrite_gltf_to_shared_textures
patch_fbx_light_import = _mod.patch_fbx_light_import


def build_guid_map(src: Path) -> dict[str, Path]:
    guid_map: dict[str, Path] = {}
    for meta in src.rglob("*.meta"):
        text = meta.read_text(errors="ignore")
        m = re.search(r"^guid:\s*([a-f0-9]+)", text, re.M)
        if m:
            guid_map[m.group(1)] = Path(str(meta)[:-5])
    return guid_map


def parse_prefab_instances(prefab_path: Path, guid_map: dict[str, Path]) -> list[dict]:
    text = prefab_path.read_text(errors="ignore")
    parts = re.split(r"\n--- !u!1001 &", text)
    out: list[dict] = []
    for part in parts[1:]:
        src = re.search(r"m_SourcePrefab:.*?guid:\s*([a-f0-9]+)", part, re.S)
        if not src:
            continue
        g = src.group(1)

        def prop(path: str) -> float | None:
            m = re.search(rf"propertyPath: {re.escape(path)}\n\s+value: ([^\n]+)", part)
            if not m:
                return None
            raw = m.group(1).strip()
            try:
                return float(raw)
            except ValueError:
                return None

        pos = [prop("m_LocalPosition.x"), prop("m_LocalPosition.y"), prop("m_LocalPosition.z")]
        rot = [
            prop("m_LocalRotation.x"),
            prop("m_LocalRotation.y"),
            prop("m_LocalRotation.z"),
            prop("m_LocalRotation.w"),
        ]
        scale = [prop("m_LocalScale.x"), prop("m_LocalScale.y"), prop("m_LocalScale.z")]
        if any(v is None for v in pos):
            pos = [0.0, 0.0, 0.0]
        if any(v is None for v in rot):
            rot = [0.0, 0.0, 0.0, 1.0]
        if any(v is None for v in scale):
            scale = [1.0, 1.0, 1.0]
        name_m = re.search(r"propertyPath: m_Name\n\s+value: ([^\n]+)", part)
        asset = guid_map.get(g)
        out.append(
            {
                "asset": asset,
                "name": name_m.group(1) if name_m else (asset.stem if asset else g),
                "pos": [float(v) for v in pos],  # type: ignore[arg-type]
                "rot": [float(v) for v in rot],  # type: ignore[arg-type]
                "scale": [float(v) for v in scale],  # type: ignore[arg-type]
            }
        )
    return out


def unity_trs_matrix(pos, rot_xyzw, scale) -> Matrix:
    """Unity local TRS → matrix in Unity space (Y-up, left-handed intent as numbers)."""
    q = Quaternion((rot_xyzw[3], rot_xyzw[0], rot_xyzw[1], rot_xyzw[2]))  # wxyz
    return Matrix.LocRotScale(Vector(pos), q, Vector(scale))


def unity_matrix_to_blender(m: Matrix) -> Matrix:
    """Convert a Unity (Y-up) transform into Blender (Z-up) space.

    Position/basis remap: (x, y, z)_unity → (x, -z, y)_blender
    """
    # Basis change matrix C: blender = C * unity
    c = Matrix(
        (
            (1, 0, 0, 0),
            (0, 0, -1, 0),
            (0, 1, 0, 0),
            (0, 0, 0, 1),
        )
    )
    c_inv = c.inverted()
    return c @ m @ c_inv


def compose(parent: Matrix, child: Matrix) -> Matrix:
    return parent @ child


def flatten_prefab(
    asset: Path | None,
    guid_map: dict[str, Path],
    parent: Matrix,
    depth: int = 0,
) -> list[tuple[Path, Matrix]]:
    """Return (fbx_path, blender_world_matrix) leaves."""
    if asset is None or not asset.exists():
        return []
    if asset.suffix.lower() == ".fbx":
        return [(asset, unity_matrix_to_blender(parent))]
    if asset.suffix.lower() != ".prefab":
        return []
    if depth > 12:
        print("MAX_DEPTH", asset)
        return []
    leaves: list[tuple[Path, Matrix]] = []
    for inst in parse_prefab_instances(asset, guid_map):
        local = unity_trs_matrix(inst["pos"], inst["rot"], inst["scale"])
        world = compose(parent, local)
        child = inst["asset"]
        if child is None:
            continue
        if child.suffix.lower() == ".fbx":
            leaves.append((child, unity_matrix_to_blender(world)))
        else:
            leaves.extend(flatten_prefab(child, guid_map, world, depth + 1))
    return leaves


def slugify_prebuild(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def import_fbx_at(fbx: Path, world: Matrix, tex_dir: Path, cache: dict) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(fbx), use_image_search=False, automatic_bone_orientation=True)
    new_objs = [o for o in bpy.data.objects if o not in before]
    new_set = set(new_objs)
    mesh_objs = [o for o in new_objs if o.type == "MESH"]

    # Unity piece prefabs force the FBX root to identity (pos/rot). Blender's FBX
    # importer leaves large file-space translations and a 0.01 scale on the root.
    # Clear translation on imported roots only (keep child local offsets), bake
    # rot/scale into verts, then parent under an empty with the Unity world matrix.
    roots = [o for o in new_objs if o.parent is None or o.parent not in new_set]
    for root in roots:
        _loc, rot, scale = root.matrix_world.decompose()
        root.matrix_world = Matrix.LocRotScale(Vector((0.0, 0.0, 0.0)), rot, scale)
    bpy.context.view_layer.update()

    piece_locals: dict = {}
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = mw
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for slot in obj.material_slots:
            if slot.material:
                fix_material(slot.material, tex_dir, cache)
        piece_locals[obj] = obj.matrix_world.copy()
        obj.select_set(False)

    for obj in new_objs:
        if obj.type != "MESH" and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    empty = bpy.data.objects.new(f"xfer_{fbx.stem}", None)
    bpy.context.scene.collection.objects.link(empty)
    empty.matrix_world = world
    for obj in mesh_objs:
        local = piece_locals[obj]
        obj.parent = empty
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world @ local
    return mesh_objs + [empty]


def center_assembly() -> dict:
    import mathutils

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return {"height": 0, "footprint": [0, 0], "meshCount": 0}
    mins = mathutils.Vector((1e9, 1e9, 1e9))
    maxs = mathutils.Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    center = (mins + maxs) * 0.5
    offset = mathutils.Vector((-center.x, -center.y, -mins.z))
    # Move root empties / unparented objects
    roots = [o for o in bpy.data.objects if o.parent is None]
    for obj in roots:
        obj.location += offset
    bpy.context.view_layer.update()
    size = maxs - mins
    return {
        "meshCount": len(meshes),
        "height": round(size.z, 4),
        "footprint": [round(size.x, 4), round(size.y, 4)],
        "size": [round(v, 4) for v in size],
    }


def bake_prebuild(prefab: Path, out_gltf: Path, src: Path, guid_map: dict[str, Path], tex_dir: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    patch_fbx_light_import()
    leaves = flatten_prefab(prefab, guid_map, Matrix.Identity(4))
    print(f"  leaves={len(leaves)}")
    cache: dict = {}
    for fbx, world in leaves:
        if not fbx.exists():
            print("  MISSING_FBX", fbx)
            continue
        import_fbx_at(fbx, world, tex_dir, cache)

    # Fix any materials that arrived without our remap
    for mat in list(bpy.data.materials):
        fix_material(mat, tex_dir, cache)

    bounds = center_assembly()
    out_gltf.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_gltf),
        export_format="GLTF_SEPARATE",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_yup=True,
        export_apply=True,
    )
    rewrite_gltf_to_shared_textures(out_gltf)
    return bounds


def main() -> None:
    src = Path(os.environ.get("CASTLE_PACK_SRC", str(DEFAULT_SRC)))
    out = Path(os.environ.get("CASTLE_PACK_OUT", str(DEFAULT_OUT)))
    force = os.environ.get("CASTLE_PACK_FORCE", "0") == "1"
    tex_dir = out / "textures"
    ensure_shared_textures(src, tex_dir)
    guid_map = build_guid_map(src)

    prebuild_dir = src / "Prefabs" / "Prebuilds"
    prefabs = sorted(prebuild_dir.glob("*.prefab"))
    print(f"PREBUILDS {len(prefabs)}")

    manifest_path = out / "prebuilds_manifest.json"
    manifest: dict[str, dict] = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except Exception:
            manifest = {}

    for prefab in prefabs:
        name = f"prebuild_{slugify_prebuild(prefab.stem)}"
        gltf = out / f"{name}.gltf"
        bin_path = out / f"{name}.bin"
        if gltf.exists() and bin_path.exists() and not force:
            print(f"SKIP {name}")
            continue
        print(f"BAKE {name} <- {prefab.name}")
        try:
            bounds = bake_prebuild(prefab, gltf, src, guid_map, tex_dir)
            manifest[name] = {
                "file": f"{name}.gltf",
                "source": prefab.name,
                **bounds,
                "bytes": (gltf.stat().st_size if gltf.exists() else 0)
                + (bin_path.stat().st_size if bin_path.exists() else 0),
            }
            print(f"  OK h={bounds.get('height')} fp={bounds.get('footprint')} meshes={bounds.get('meshCount')}")
        except Exception as e:
            print(f"  FAIL {name}: {e}")
            import traceback

            traceback.print_exc()

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"DONE prebuilds={len(manifest)}")


if __name__ == "__main__":
    main()
