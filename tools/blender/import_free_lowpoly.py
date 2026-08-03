#!/usr/bin/env python3
"""Convert Fab Free Low Poly Pack FBX → glTF with shared textures.

Source layout (flat):
  fab_freelowpolypack/*.fbx
  fab_freelowpolypack/textures/T_*.{png,tga}

Dest:
  packages/client/public/assets/models/{foliage,props,buildings}/free_lowpoly/

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/blender/import_free_lowpoly.py

Env:
  FREE_LOWPOLY_SRC    Pack root
  FREE_LOWPOLY_FORCE=1  Re-convert existing pieces
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

import bpy
import mathutils

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SRC = Path("/Users/champion/Development/Assets/fab_freelowpolypack")
MODELS = REPO / "packages/client/public/assets/models"
PACK = "free_lowpoly"

# Filename stem (after SM_ strip) → category
FOLIAGE_PREFIXES = (
    "bush_",
    "fir_",
    "flower_",
    "foliage",
    "grass_",
    "mushroom_",
    "thorn_",
    "tree_",
    "fallentree_",
    "fallen_tree_",
    "stump_",
    "root_",
    "cobweb_",
    "rock_",
    "pebble_",
)
BUILDING_PREFIXES = (
    "bridge",
    "platform_",
    "stonewall_",
    "stone_wall_",
    "rockwall_",
    "rock_wall_",
    "mountain_",
    "terrainedge_",
    "terrain_edge_",
)

# Material name stem → texture basename (pack uses M_* vs T_* naming).
MATERIAL_TEX: dict[str, dict[str, str]] = {
    "M_Atlas": {"color": "T_Atlas_01.png", "normal": "T_BasePolygon_N.png"},
    "Atlas": {"color": "T_Atlas_01.png", "normal": "T_BasePolygon_N.png"},
    "M_Bush": {"color": "T_Bush_BCA.png"},
    "Bush": {"color": "T_Bush_BCA.png"},
    "M_Fir": {"color": "T_Fir_BCA.png"},
    "Fir": {"color": "T_Fir_BCA.png"},
    "M_WillowLeaves": {"color": "T_WillowTreeLeaves.png"},
    "WillowLeaves": {"color": "T_WillowTreeLeaves.png"},
    "M_TreeLeaves": {"color": "T_Fir_BCA.png"},
    "TreeLeaves": {"color": "T_Fir_BCA.png"},
    "M_TreeBark": {"color": "T_Atlas_01.png", "normal": "T_BasePolygon_N.png"},
    "TreeBark": {"color": "T_Atlas_01.png", "normal": "T_BasePolygon_N.png"},
    "M_Coweb_02": {"color": "T_Coweb_02_BCA.png", "normal": "T_Coweb_02_Normal.png"},
    "M_Coweb_03": {"color": "T_Coweb_03_BCA.png", "normal": "T_Coweb_03_Normal.png"},
}


def slugify(name: str) -> str:
    s = name
    s = re.sub(r"^SM_", "", s, flags=re.I)
    s = s.lower()
    s = re.sub(r"\.fbx(\.\d+)?$", "", s, flags=re.I)
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def category_for(slug: str) -> str:
    for p in FOLIAGE_PREFIXES:
        if slug.startswith(p) or slug == p.rstrip("_"):
            return "foliage"
    for p in BUILDING_PREFIXES:
        if slug.startswith(p) or slug == p.rstrip("_"):
            return "building"
    return "prop"


CUTOUT_HINTS = (
    "bush",
    "fir",
    "flower",
    "foliage",
    "grass",
    "leaf",
    "willow",
    "thorn",
    "cobweb",
    "coweb",
    "plant",
)


def is_cutout_name(blob: str) -> bool:
    b = blob.lower()
    return any(h in b for h in CUTOUT_HINTS)


def ensure_shared_textures(src: Path, tex_dir: Path) -> None:
    """Copy textures; convert TGA → PNG via macOS sips (or shutil for PNG)."""
    if tex_dir.is_symlink():
        tex_dir.unlink()
    tex_dir.mkdir(parents=True, exist_ok=True)
    src_tex = src / "textures"
    if not src_tex.is_dir():
        print("MISSING_TEX_DIR", src_tex)
        return

    import subprocess

    for f in sorted(src_tex.iterdir()):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg", ".tga", ".webp"}:
            continue
        if ext == ".tga":
            dest = tex_dir / f"{f.stem}.png"
            if dest.exists() and dest.stat().st_mtime >= f.stat().st_mtime:
                continue
            try:
                subprocess.run(
                    ["sips", "-s", "format", "png", str(f), "--out", str(dest)],
                    check=True,
                    capture_output=True,
                )
                print("TEX_TGA→PNG", f.name, "→", dest.name)
            except Exception as e:
                print("TGA_FAIL", f.name, e)
                # Last resort: copy TGA as-is (some viewers won't load it).
                shutil.copy2(f, tex_dir / f.name)
        else:
            dest = tex_dir / f.name
            if dest.exists() and dest.stat().st_size == f.stat().st_size:
                continue
            shutil.copy2(f, dest)
            print("TEX", f.name)


def link_textures_dir(master: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    link = dest / "textures"
    master = master.resolve()
    # Master lives at dest/textures — never delete or re-link it.
    if dest.resolve() == master.parent.resolve():
        return
    if link.exists() or link.is_symlink():
        if link.is_symlink() and link.resolve() == master:
            return
        if link.is_dir() and not link.is_symlink():
            shutil.rmtree(link)
        else:
            link.unlink()
    link.symlink_to(master, target_is_directory=True)


def material_stem(mat_name: str) -> str:
    return mat_name.split(".")[0].strip()


def resolve_texture(tex_dir: Path, image_name: str) -> dict[str, str]:
    """Map FBX image basename onto files in tex_dir (prefer PNG over TGA)."""
    base = Path(image_name).name
    stem = Path(base).stem
    # Prefer already-converted PNG for TGA stems.
    candidates = [
        base,
        f"{stem}.png",
        f"{stem}.jpg",
        f"{stem}.tga",
    ]
    # Common renames in this pack.
    aliases = {
        "T_Bush_BCA": ["T_Bush_BCA.png", "T_Bush_BCA.tga"],
        "T_Fir_BCA": ["T_Fir_BCA.png", "T_Fir_BCA.tga"],
        "T_WillowTreeLeaves": ["T_WillowTreeLeaves.png", "T_WillowTreeLeaves.tga"],
        "T_WillowTreeLeavesEmisssive": [
            "T_WillowTreeLeavesEmisssive.png",
            "T_WillowTreeLeavesEmisssive.tga",
        ],
    }
    if stem in aliases:
        candidates = aliases[stem] + candidates

    color = next((c for c in candidates if (tex_dir / c).exists()), None)
    if not color:
        # Fuzzy: stem prefix match
        matches = sorted(tex_dir.glob(f"{stem}*"))
        matches = [m for m in matches if "Normal" not in m.name and "_N." not in m.name and "_E." not in m.name]
        color = matches[0].name if matches else None
    if not color:
        return {}

    out: dict[str, str] = {"color": color}
    # Normal maps
    for nname in (
        f"{stem}_Normal.png",
        f"{stem}_N.png",
        "T_BasePolygon_N.png",
        "T_Coweb_02_Normal.png",
        "T_Coweb_03_Normal.png",
    ):
        if "Coweb" in stem or "Cobweb" in stem:
            if "02" in stem and (tex_dir / "T_Coweb_02_Normal.png").exists():
                out["normal"] = "T_Coweb_02_Normal.png"
                break
            if "03" in stem and (tex_dir / "T_Coweb_03_Normal.png").exists():
                out["normal"] = "T_Coweb_03_Normal.png"
                break
        if (tex_dir / nname).exists() and "Coweb" not in nname:
            out["normal"] = nname
            break
    # Atlas meshes often share BasePolygon normal.
    if "normal" not in out and "Atlas" in color and (tex_dir / "T_BasePolygon_N.png").exists():
        out["normal"] = "T_BasePolygon_N.png"
    return out


def fallback_atlas(tex_dir: Path) -> dict[str, str]:
    for name in ("T_Atlas_01.png", "T_Atlas_02.png"):
        if (tex_dir / name).exists():
            out = {"color": name}
            if (tex_dir / "T_BasePolygon_N.png").exists():
                out["normal"] = "T_BasePolygon_N.png"
            return out
    return {}


def load_image(path: Path, cache: dict[str, bpy.types.Image]) -> bpy.types.Image | None:
    key = str(path)
    if key in cache:
        return cache[key]
    if not path.exists():
        print("MISSING_TEX", path)
        return None
    img = bpy.data.images.load(str(path), check_existing=True)
    img.filepath = str(path)
    cache[key] = img
    return img


def fbx_intended_images(mat: bpy.types.Material) -> list[str]:
    if not mat or not mat.use_nodes:
        return []
    names: list[str] = []
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            names.append(Path(n.image.name).name)
    return names


def fix_material(mat: bpy.types.Material, tex_dir: Path, cache: dict[str, bpy.types.Image]) -> dict[str, str] | None:
    if mat is None:
        return None

    stem = material_stem(mat.name)
    texset: dict[str, str] = {}

    # Explicit pack material map first.
    for key in (mat.name, stem, stem.replace("M_", "")):
        mapped = MATERIAL_TEX.get(key) or MATERIAL_TEX.get(f"M_{key}")
        if mapped and all((tex_dir / v).exists() for v in mapped.values()):
            texset = dict(mapped)
            break

    if not texset:
        for img_name in fbx_intended_images(mat):
            texset = resolve_texture(tex_dir, img_name)
            if texset:
                break
    if not texset:
        texset = resolve_texture(tex_dir, mat.name)
    if not texset:
        texset = fallback_atlas(tex_dir)
    if not texset:
        print("NO_TEX_FOR", mat.name)
        return None

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

    cutout = is_cutout_name(f"{mat.name} {texset.get('color', '')}")
    color = add_tex(texset["color"])
    if color:
        links.new(color.outputs["Color"], principled.inputs["Base Color"])
        if cutout and "Alpha" in principled.inputs and color.outputs.get("Alpha"):
            links.new(color.outputs["Alpha"], principled.inputs["Alpha"])
            mat.blend_method = "CLIP"
            try:
                mat.shadow_method = "CLIP"
            except Exception:
                pass
        else:
            mat.blend_method = "OPAQUE"
            if "Alpha" in principled.inputs:
                principled.inputs["Alpha"].default_value = 1.0

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
    return texset


def rewrite_gltf_to_shared_textures(gltf_path: Path, mat_tex: dict[str, dict[str, str]]) -> None:
    data = json.loads(gltf_path.read_text(encoding="utf-8"))
    mat_to_tex: dict[int, dict[str, str]] = {}
    for i, mat in enumerate(data.get("materials", [])):
        name = mat.get("name", "")
        stem = material_stem(name)
        texset = mat_tex.get(name) or mat_tex.get(stem)
        if not texset:
            for k, v in mat_tex.items():
                if material_stem(k) == stem:
                    texset = v
                    break
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
        name = mat.get("name", "")
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr.pop("metallicRoughnessTexture", None)

        if not texset:
            if is_cutout_name(name):
                mat["alphaMode"] = "MASK"
                mat["alphaCutoff"] = 0.4
            else:
                mat["alphaMode"] = "OPAQUE"
                mat.pop("alphaCutoff", None)
            continue

        if "color" in texset and texset["color"] in index_of:
            pbr["baseColorTexture"] = {"index": index_of[texset["color"]]}
            pbr.pop("baseColorFactor", None)
        if "normal" in texset and texset["normal"] in index_of:
            mat["normalTexture"] = {"index": index_of[texset["normal"]]}
        else:
            mat.pop("normalTexture", None)
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.85

        if is_cutout_name(f"{name} {texset.get('color', '')}"):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.4
        else:
            mat["alphaMode"] = "OPAQUE"
            mat.pop("alphaCutoff", None)

    data["images"] = images
    data["textures"] = textures
    gltf_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    for p in list(gltf_path.parent.iterdir()):
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".tga"}:
            p.unlink(missing_ok=True)


def center_on_ground() -> dict:
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return {"meshCount": 0, "height": 0, "footprint": [0, 0]}
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
    for obj in meshes:
        obj.location += offset
    bpy.context.view_layer.update()

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
    size = maxs - mins
    return {
        "meshCount": len(meshes),
        "height": round(size.z, 4),
        "footprint": [round(size.x, 4), round(size.y, 4)],
        "size": [round(v, 4) for v in size],
    }


def patch_fbx_light_import() -> None:
    try:
        import io_scene_fbx.import_fbx as import_fbx  # type: ignore

        if getattr(import_fbx, "_rustcraft_light_patched", False):
            return

        orig = import_fbx.ElementImporter.gather_light

        def safe(self, *a, **k):  # noqa: ANN001
            try:
                return orig(self, *a, **k)
            except Exception:
                return None

        import_fbx.ElementImporter.gather_light = safe
        import_fbx._rustcraft_light_patched = True
    except Exception:
        pass


def export_piece(fbx_path: Path, out_gltf: Path, tex_dir: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    patch_fbx_light_import()
    bpy.ops.import_scene.fbx(filepath=str(fbx_path), use_image_search=False)

    cache: dict[str, bpy.types.Image] = {}
    mat_tex: dict[str, dict[str, str]] = {}
    for mat in list(bpy.data.materials):
        texset = fix_material(mat, tex_dir, cache)
        if texset:
            mat_tex[mat.name] = texset
            mat_tex[material_stem(mat.name)] = texset

    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)

    bounds = center_on_ground()
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
    rewrite_gltf_to_shared_textures(out_gltf, mat_tex)
    return bounds


def main() -> None:
    # Need a blank scene for TGA conversion before we wipe scenes per piece.
    bpy.ops.wm.read_factory_settings(use_empty=True)

    src = Path(os.environ.get("FREE_LOWPOLY_SRC", str(DEFAULT_SRC)))
    force = os.environ.get("FREE_LOWPOLY_FORCE", "0") == "1"

    master_tex = MODELS / "foliage" / PACK / "textures"
    ensure_shared_textures(src, master_tex)

    out_dirs = {
        "foliage": MODELS / "foliage" / PACK,
        "prop": MODELS / "props" / PACK,
        "building": MODELS / "buildings" / PACK,
    }
    for cat, d in out_dirs.items():
        link_textures_dir(master_tex, d)

    files = sorted(src.glob("SM_*.fbx")) + sorted(src.glob("SM_*.FBX"))
    # Dedupe weird duplicates like SM_Rock_11.fbx.001.fbx — keep the plain one.
    by_slug: dict[str, Path] = {}
    for fbx in files:
        slug = slugify(fbx.name)
        prev = by_slug.get(slug)
        if prev is None or len(fbx.name) < len(prev.name):
            by_slug[slug] = fbx

    print(f"FREE_LOWPOLY count={len(by_slug)} src={src}")
    manifest: dict[str, dict] = {}
    for slug, fbx in sorted(by_slug.items()):
        category = category_for(slug)
        out_dir = out_dirs[category]
        gltf = out_dir / f"{slug}.gltf"
        bin_path = out_dir / f"{slug}.bin"
        key = f"{category}/{slug}"
        if gltf.exists() and bin_path.exists() and not force:
            print(f"SKIP {key}")
            continue
        print(f"CONV {key} <- {fbx.name}")
        try:
            bounds = export_piece(fbx, gltf, master_tex)
            manifest[key] = {
                "file": f"{slug}.gltf",
                "category": category,
                "source": fbx.name,
                **bounds,
                "bytes": (gltf.stat().st_size if gltf.exists() else 0)
                + (bin_path.stat().st_size if bin_path.exists() else 0),
            }
            print(f"  OK h={bounds.get('height')} fp={bounds.get('footprint')}")
        except Exception as e:
            print(f"  FAIL {key}: {e}")
            import traceback

            traceback.print_exc()

    manifest_path = MODELS / "foliage" / PACK / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"DONE pieces={len(manifest)} → {manifest_path}")


if __name__ == "__main__":
    main()
