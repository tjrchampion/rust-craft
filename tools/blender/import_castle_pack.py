#!/usr/bin/env python3
"""Convert the full 3d Castle Pack Meshes/ folder → glTF with shared textures.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/blender/import_castle_pack.py

Env:
  CASTLE_PACK_SRC   Unity pack root
  CASTLE_PACK_OUT   Destination under public/assets/models/buildings/
  CASTLE_PACK_FORCE=1  Re-convert pieces that already exist
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SRC = Path("/Users/champion/My project/Assets/_ASSETS/3d Castle Pack")
DEFAULT_OUT = REPO / "packages/client/public/assets/models/buildings/castle_pack"

# Stable names for pieces already referenced by castleGen / palette.
NAME_OVERRIDES: dict[str, str] = {
    "CastleRoundTower_NoInt.fbx": "tower_round",
    "CastleRoundTowerInt.fbx": "tower_round_interior",
    "CastleRoundTowerBottom.fbx": "tower_round_bottom",
    "TowerSquare.fbx": "tower_square",
    "CastleSquareTower_Int.fbx": "tower_square_interior",
    "SquareTowerBottom.fbx": "tower_square_bottom",
    "TowerTop_Square.fbx": "tower_square_top",
    "SmallTower.fbx": "tower_small",
    "TowerRoof_Cone.fbx": "roof_cone",
    "TowerRoof_RoundExtension.fbx": "roof_round_extension",
    "TowerRoof_RoundStone.fbx": "roof_round_stone",
    "TowerRoof_RoundStoneRock.fbx": "roof_round_stone_rock",
    "TowerRoof_Square.fbx": "roof_square",
    "TowerRoof_SquareEdge.fbx": "roof_square_edge",
    "TowerRoof_SquareHollow.fbx": "roof_square_hollow",
    "TowerRoof_SquareTop.fbx": "roof_square_block",
    "TowerRoof_SquareWood.fbx": "roof_square_wood",
    "ConeRoofCorner.fbx": "roof_corner_cone",
    "CastleWallLarge.fbx": "wall_large",
    "CastleWallChunk.fbx": "wall_chunk",
    "CastleWallShoot.fbx": "wall_shoot",
    "CastlWallLongSlit 1.fbx": "wall_slit",
    "CastleWallShoot_ArcherSlit.fbx": "wall_archer_slit_large",
    "CastleWallShoot_ArcherSlit_Small.fbx": "wall_archer_slit",
    "CastleWall_Lifter.fbx": "wall_lifter",
    "CastleWall_Lifter2.fbx": "wall_lifter2",
    "CastleGate 1.fbx": "gate",
    "SmallGate NoPortcullis.fbx": "gate_small",
    "SmallGate.fbx": "gate_portcullis",
}

# Shared texture prep: dest filename under textures/ → source relative to pack root.
SHARED_TEXTURES: dict[str, str] = {
    "castle_wall_color.png": "Textures/Castle Wall/Stone Wall Small_Base_Color.png",
    "castle_wall_normal.png": "Textures/Castle Wall/Stone Wall Small_Normal_OpenGL.png",
    "castle_wall_norocks_color.png": "Textures/Castle Wall Without Rocks/castle wall no rocks_Base_Color.png",
    "castle_wall_norocks_normal.png": "Textures/Castle Wall Without Rocks/castle wall no rocks_Normal_OpenGL.png",
    "stone_floor_color.png": "Textures/Stone Floor/Stone Floor_Base_Color.png",
    "stone_floor_normal.png": "Textures/Stone Floor/Stone Floor_Normal_OpenGL.png",
    "bricks_color.png": "Textures/Bricks/Bricks_Color.png",
    "bricks_normal.png": "Textures/Bricks/Bricks_Normal.png",
    "plaster_color.png": "Textures/Plaster/Plaster_Base_Color.png",
    "roof_round_color.png": "Textures/Roof Tiles Round/Roof Tiles Round_Base_Color.png",
    "roof_round_normal.png": "Textures/Roof Tiles Round/Roof Tiles Round_Normal_OpenGL.png",
    "roof_square_color.png": "Textures/Roof Tiles Square/Roof tiles Square_Base_Color.png",
    "roof_square_normal.png": "Textures/Roof Tiles Square/Roof tiles Square_Normal_OpenGL.png",
    "wood_planks_color.png": "Textures/Wooden Planks/Wooden Planks Weathered_Base_Color.png",
    "wood_weather_color.png": "Textures/Wood Weathered/Wood Weathered_Base_Color.png",
    "door_wood_color.jpg": "Textures/Door Wood/Planks005_2K_Color.jpg",
    "iron_color.png": "Textures/Iron/Iron_Base_Color.png",
    "metal_rough_color.png": "Textures/Metal Black Rough/metal black rough_Base_Color.png",
    "metal_smooth_color.png": "Textures/Metal Black Smooth/Metal Black Smooth_Base_Color.png",
    "chimney_color.png": "Textures/Chimney/Chimney_Base_Color.png",
    "rock_color.png": "Textures/Rock Stones/Rock Stone 2_Base_Color.png",
    "rock028_color.jpg": "Textures/Rock Stones/Rock028_2K_Color.jpg",
    "rock028_normal.jpg": "Textures/Rock Stones/Rock028_2K_Normal.jpg",
    "cobble_color.png": "Textures/CobbleStones/Cobble Stones_Base_Color.png",
    "cobble_normal.png": "Textures/CobbleStones/Cobble Stones_Normal_OpenGL.png",
    "hay1_color.png": "Textures/Hay/hay 1 color.png",
    "hay1_normal.png": "Textures/Hay/hay 1 normal.png",
    "hay2_color.png": "Textures/Hay/hay 2 color.png",
    "hay2_normal.png": "Textures/Hay/hay 2 normal.png",
    "hay3_color.png": "Textures/Hay/hay 3 color.png",
    "hay3_normal.png": "Textures/Hay/hay 3 normal.png",
    "hay4_color.png": "Textures/Hay/hay 4 color.png",
    "hay4_normal.png": "Textures/Hay/hay 4 normal.png",
    "hay5_color.png": "Textures/Hay/hay 5 color.png",
    "hay5_normal.png": "Textures/Hay/hay 5 normal.png",
    "hay6_color.png": "Textures/Hay/hay 6 color.png",
    "hay6_normal.png": "Textures/Hay/hay 6 normal.png",
    "mud_color.png": "Textures/Mud/Mud_Color.png",
    "grass_color.jpg": "Textures/Grass/Ground037_2K_Color.jpg",
}

MATERIAL_TEX: dict[str, dict[str, str]] = {
    "Castle Wall": {"color": "castle_wall_color.png", "normal": "castle_wall_normal.png"},
    "Castle Wall No Rocks": {"color": "castle_wall_norocks_color.png", "normal": "castle_wall_norocks_normal.png"},
    "Castle Wall Without Rocks": {"color": "castle_wall_norocks_color.png", "normal": "castle_wall_norocks_normal.png"},
    "Stone Floor": {"color": "stone_floor_color.png", "normal": "stone_floor_normal.png"},
    "Bricks": {"color": "bricks_color.png", "normal": "bricks_normal.png"},
    "Plaster": {"color": "plaster_color.png"},
    "Plastered Wall": {"color": "plaster_color.png"},
    "Roof Tiles Round": {"color": "roof_round_color.png", "normal": "roof_round_normal.png"},
    "Roof Tiles Square": {"color": "roof_square_color.png", "normal": "roof_square_normal.png"},
    "Roof Circle": {"color": "roof_round_color.png", "normal": "roof_round_normal.png"},
    "Roof Squared": {"color": "roof_square_color.png", "normal": "roof_square_normal.png"},
    "Wooden Planks": {"color": "wood_planks_color.png"},
    "Wood Weather": {"color": "wood_weather_color.png"},
    "Weathered Wood": {"color": "wood_weather_color.png"},
    "Door Wood": {"color": "door_wood_color.jpg"},
    "Regular Door": {"color": "door_wood_color.jpg"},
    "Iron": {"color": "iron_color.png"},
    "Metal Iron": {"color": "iron_color.png"},
    "Metal Black Rough": {"color": "metal_rough_color.png"},
    "Metal Black Smooth": {"color": "metal_smooth_color.png"},
    "Chimney": {"color": "chimney_color.png"},
    "Rock Stones": {"color": "rock_color.png"},
    "Rocks": {"color": "rock028_color.jpg", "normal": "rock028_normal.jpg"},
    "CobbleStones": {"color": "cobble_color.png", "normal": "cobble_normal.png"},
    "Cobblestone": {"color": "cobble_color.png", "normal": "cobble_normal.png"},
    "Hay 1": {"color": "hay1_color.png", "normal": "hay1_normal.png"},
    "Hay 2": {"color": "hay2_color.png", "normal": "hay2_normal.png"},
    "Hay 3": {"color": "hay3_color.png", "normal": "hay3_normal.png"},
    "Hay 4": {"color": "hay4_color.png", "normal": "hay4_normal.png"},
    "Hay 5": {"color": "hay5_color.png", "normal": "hay5_normal.png"},
    "Hay 6": {"color": "hay6_color.png", "normal": "hay6_normal.png"},
    "Mud": {"color": "mud_color.png"},
    "Grass": {"color": "grass_color.jpg"},
}


def slugify_fbx(filename: str) -> str:
    stem = Path(filename).stem
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", stem)
    s = re.sub(r"([A-Za-z])(\d)", r"\1_\2", s)
    s = re.sub(r"(\d)([A-Za-z])", r"\1_\2", s)
    s = s.replace(" ", "_").replace("-", "_")
    s = re.sub(r"_+", "_", s).strip("_").lower()
    return s


def discover_pieces(src: Path) -> dict[str, str]:
    meshes = sorted((src / "Meshes").glob("*.fbx"))
    out: dict[str, str] = {}
    used: set[str] = set()
    for fbx in meshes:
        name = NAME_OVERRIDES.get(fbx.name, slugify_fbx(fbx.name))
        base = name
        n = 2
        while name in used:
            name = f"{base}_{n}"
            n += 1
        used.add(name)
        out[name] = fbx.name
    return out


def ensure_shared_textures(src: Path, tex_dir: Path) -> None:
    tex_dir.mkdir(parents=True, exist_ok=True)
    for dest_name, rel in SHARED_TEXTURES.items():
        dest = tex_dir / dest_name
        src_path = src / rel
        if dest.exists():
            continue
        if not src_path.exists():
            print("MISSING_SRC_TEX", rel)
            continue
        shutil.copy2(src_path, dest)
        try:
            subprocess.run(["sips", "-Z", "1024", str(dest)], check=True, capture_output=True)
        except Exception as e:
            print("SIPS_WARN", dest_name, e)
        print("TEX", dest_name, dest.stat().st_size)


def patch_fbx_light_import() -> None:
    try:
        from io_scene_fbx import import_fbx  # type: ignore
    except Exception as e:
        print("FBX_PATCH_SKIP", e)
        return
    import_fbx.blen_read_light = lambda *_a, **_k: None  # type: ignore[attr-defined]


def load_image(path: Path, cache: dict[str, bpy.types.Image]) -> bpy.types.Image | None:
    key = str(path)
    if key in cache:
        return cache[key]
    if not path.exists():
        print("MISSING_TEX", path)
        return None
    img = bpy.data.images.load(str(path))
    img.filepath = str(path)
    cache[key] = img
    return img


def resolve_texset(mat_name: str) -> dict[str, str] | None:
    name = mat_name.split(".")[0].strip()
    if name in MATERIAL_TEX:
        return MATERIAL_TEX[name]
    lower = name.lower()
    for key, val in MATERIAL_TEX.items():
        if key.lower() in lower or lower in key.lower():
            return val
    if "roof" in lower and ("square" in lower or "squared" in lower):
        return MATERIAL_TEX["Roof Squared"]
    if "roof" in lower and ("circle" in lower or "round" in lower or "cone" in lower or "tile" in lower):
        return MATERIAL_TEX["Roof Circle"]
    if "weather" in lower and "wood" in lower:
        return MATERIAL_TEX["Weathered Wood"]
    if "plaster" in lower:
        return MATERIAL_TEX["Plaster"]
    if "hay" in lower:
        return MATERIAL_TEX.get("Hay 2")
    if "rock" in lower:
        return MATERIAL_TEX["Rocks"]
    if "cobble" in lower:
        return MATERIAL_TEX["Cobblestone"]
    if "door" in lower:
        return MATERIAL_TEX["Door Wood"]
    return None


def fix_material(mat: bpy.types.Material, tex_dir: Path, cache: dict[str, bpy.types.Image]) -> None:
    if mat is None:
        return
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    for n in list(nodes):
        if n.type in {"TEX_IMAGE", "NORMAL_MAP"}:
            nodes.remove(n)

    principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out:
            links.new(principled.outputs["BSDF"], out.inputs["Surface"])

    texset = resolve_texset(mat.name)
    if texset is None:
        return

    def add_tex(filename: str, non_color: bool = False):
        img = load_image(tex_dir / filename, cache)
        if img is None:
            return None
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        if non_color:
            try:
                img.colorspace_settings.name = "Non-Color"
            except Exception:
                pass
        return node

    color = add_tex(texset["color"])
    if color:
        links.new(color.outputs["Color"], principled.inputs["Base Color"])
    if "normal" in texset and "Normal" in principled.inputs:
        ntex = add_tex(texset["normal"], non_color=True)
        if ntex:
            nmap = nodes.new("ShaderNodeNormalMap")
            links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], principled.inputs["Normal"])
    if "Metallic" in principled.inputs:
        principled.inputs["Metallic"].default_value = 0.0
    if "Roughness" in principled.inputs:
        principled.inputs["Roughness"].default_value = 0.85


def rewrite_gltf_to_shared_textures(gltf_path: Path) -> None:
    data = json.loads(gltf_path.read_text(encoding="utf-8"))
    mat_to_tex: dict[int, dict[str, str]] = {}
    for i, mat in enumerate(data.get("materials", [])):
        texset = resolve_texset(mat.get("name", ""))
        if texset:
            mat_to_tex[i] = texset

    needed: list[str] = []
    for texset in mat_to_tex.values():
        for key in ("color", "normal"):
            if key in texset and texset[key] not in needed:
                needed.append(texset[key])

    images = [{"uri": f"textures/{name}"} for name in needed]
    textures = [{"source": i} for i in range(len(needed))]
    index_of = {name: i for i, name in enumerate(needed)}

    for i, mat in enumerate(data.get("materials", [])):
        texset = mat_to_tex.get(i)
        if not texset:
            continue
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr.pop("metallicRoughnessTexture", None)
        if "color" in texset and texset["color"] in index_of:
            pbr["baseColorTexture"] = {"index": index_of[texset["color"]]}
            pbr.pop("baseColorFactor", None)
        if "normal" in texset and texset["normal"] in index_of:
            mat["normalTexture"] = {"index": index_of[texset["normal"]]}
        else:
            mat.pop("normalTexture", None)
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.75

    data["images"] = images
    data["textures"] = textures
    gltf_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    for p in list(gltf_path.parent.iterdir()):
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            p.unlink(missing_ok=True)


def export_piece(fbx_path: Path, out_gltf: Path, tex_dir: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    patch_fbx_light_import()
    bpy.ops.import_scene.fbx(filepath=str(fbx_path), use_image_search=False)

    cache: dict[str, bpy.types.Image] = {}
    for mat in list(bpy.data.materials):
        fix_material(mat, tex_dir, cache)

    import mathutils

    mins = mathutils.Vector((1e9, 1e9, 1e9))
    maxs = mathutils.Vector((-1e9, -1e9, -1e9))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
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
    for obj in meshes:
        obj.location += offset
    bpy.context.view_layer.update()

    mins = mathutils.Vector((1e9, 1e9, 1e9))
    maxs = mathutils.Vector((-1e9, -1e9, -1e9))
    mesh_count = 0
    for obj in meshes:
        mesh_count += 1
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    size = maxs - mins
    bounds = {
        "meshCount": mesh_count,
        "min": [round(v, 4) for v in mins],
        "max": [round(v, 4) for v in maxs],
        "size": [round(v, 4) for v in size],
        "height": round(size.z, 4),
        "footprint": [round(size.x, 4), round(size.y, 4)],
    }

    out_gltf.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_gltf),
        export_format="GLTF_SEPARATE",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_yup=True,
    )
    rewrite_gltf_to_shared_textures(out_gltf)
    return bounds


def main() -> None:
    src = Path(os.environ.get("CASTLE_PACK_SRC", str(DEFAULT_SRC)))
    out = Path(os.environ.get("CASTLE_PACK_OUT", str(DEFAULT_OUT)))
    force = os.environ.get("CASTLE_PACK_FORCE", "0") == "1"
    tex_dir = out / "textures"
    ensure_shared_textures(src, tex_dir)

    pieces = discover_pieces(src)
    print(f"DISCOVERED {len(pieces)} meshes")

    manifest_path = out / "manifest.json"
    manifest: dict[str, dict] = {}
    if manifest_path.exists() and not force:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

    converted = skipped = failed = 0
    for name, fbx_name in pieces.items():
        fbx = src / "Meshes" / fbx_name
        gltf = out / f"{name}.gltf"
        bin_path = out / f"{name}.bin"
        if gltf.exists() and bin_path.exists() and not force:
            print(f"SKIP {name}")
            skipped += 1
            if name not in manifest:
                manifest[name] = {"file": f"{name}.gltf", "source": fbx_name}
            continue
        print(f"CONVERT {name} <- {fbx_name}")
        try:
            bounds = export_piece(fbx, gltf, tex_dir)
            manifest[name] = {
                "file": f"{name}.gltf",
                "source": fbx_name,
                **bounds,
                "bytes": (gltf.stat().st_size if gltf.exists() else 0)
                + (bin_path.stat().st_size if bin_path.exists() else 0),
            }
            converted += 1
            print(f"  OK h={bounds['height']} fp={bounds['footprint']}")
        except Exception as e:
            failed += 1
            print(f"  FAIL {name}: {e}")
            import traceback

            traceback.print_exc()

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"DONE converted={converted} skipped={skipped} failed={failed} total={len(pieces)}")


if __name__ == "__main__":
    main()
