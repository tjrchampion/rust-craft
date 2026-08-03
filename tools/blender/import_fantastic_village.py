#!/usr/bin/env python3
"""Convert Fantastic Village Pack FBX → glTF with shared textures.

Imports buildings/, props/, and environment/ (skips collision_* and UE-only).
Materials are named M_* and map to 2d/textures/T_*_BC / T_*_N.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/blender/import_fantastic_village.py

Env:
  VILLAGE_PACK_SRC   Pack root (contains 2d/ and 3d/)
  VILLAGE_PACK_FORCE=1  Re-convert existing pieces
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
DEFAULT_SRC = Path("/Users/champion/Development/Assets/fbx_and_textures_fantastic_village_pack")
MODELS = REPO / "packages/client/public/assets/models"

# category → (source subdir under 3d/, dest under assets/models/)
SOURCES: list[tuple[str, Path, Path]] = [
    ("building", Path("3d/buildings"), MODELS / "buildings" / "fantastic_village"),
    ("prop", Path("3d/props"), MODELS / "props" / "fantastic_village"),
    ("foliage", Path("3d/environment"), MODELS / "foliage" / "fantastic_village"),
]


def slugify(name: str) -> str:
    s = name
    s = re.sub(r"^SM_(BLD|PROP|ENV)_", "", s, flags=re.I)
    s = s.lower()
    s = re.sub(r"\.fbx$", "", s, flags=re.I)
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def ensure_shared_textures(src: Path, tex_dir: Path) -> None:
    """Copy pack textures into a real directory (not a symlink)."""
    if tex_dir.is_symlink():
        tex_dir.unlink()
    tex_dir.mkdir(parents=True, exist_ok=True)
    src_tex = src / "2d" / "textures"
    for f in src_tex.iterdir():
        if not f.is_file():
            continue
        if f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".tga", ".webp"}:
            continue
        dest = tex_dir / f.name
        if dest.exists() and dest.stat().st_size == f.stat().st_size:
            continue
        shutil.copy2(f, dest)
        print("TEX", f.name)


def link_textures_dir(master: Path, dest: Path) -> None:
    """Point dest/textures at the shared master textures folder (when dest differs)."""
    dest.mkdir(parents=True, exist_ok=True)
    link = dest / "textures"
    master = master.resolve()
    if link.resolve() == master and link.is_dir() and not link.is_symlink():
        # Master folder itself — already a real textures directory.
        return
    if link.is_symlink() or link.exists():
        if link.is_symlink() and link.resolve() == master:
            return
        if link.is_dir() and not link.is_symlink():
            shutil.rmtree(link)
        else:
            link.unlink()
    link.symlink_to(master, target_is_directory=True)


CUTOUT_HINTS = (
    "plant",
    "grass",
    "leaf",
    "flag",
    "laundry",
    "paper",
    "signs",
    "potplants",
    "sprite",
)

# Solid vertex/emissive colors used by the pack (no albedo texture).
SOLID_COLORS: dict[str, tuple[float, float, float]] = {
    "CLR_yellow_E": (1.0, 0.85, 0.2),
    "CLR_yellow": (1.0, 0.85, 0.2),
    "CLR_blue": (0.25, 0.45, 0.85),
    "CLR_red": (0.85, 0.2, 0.15),
    "CLR_white": (0.92, 0.92, 0.9),
    "CLR_black": (0.05, 0.05, 0.05),
    "CLR_green": (0.25, 0.55, 0.2),
}


def is_cutout_material(mat_name: str, color_tex: str = "") -> bool:
    blob = f"{mat_name} {color_tex}".lower()
    return any(h in blob for h in CUTOUT_HINTS)


def material_stem(mat_name: str) -> str:
    """M_rooftiles_01 → rooftiles_01 ; M_PROP_hay → PROP_hay."""
    name = mat_name.split(".")[0].strip()
    if name.startswith("M_"):
        name = name[2:]
    return name


def resolve_from_fbx_image_name(tex_dir: Path, image_name: str) -> dict[str, str]:
    """Map a broken FBX image basename (e.g. T_stonebrick_02.png) onto files we have."""
    base = Path(image_name).name
    if (tex_dir / base).exists():
        out: dict[str, str] = {"color": base}
    else:
        stem = Path(base).stem
        # T_stonebrick_02.png → T_stonebrick_02_BC.png
        candidates = [
            f"{stem}_BC.png",
            f"{stem}_BC.jpg",
            f"{stem}.png",
            f"{stem}.jpg",
            f"{stem}.tga",
        ]
        color = next((c for c in candidates if (tex_dir / c).exists()), None)
        if color is None:
            matches = sorted(tex_dir.glob(f"{stem}*"))
            # Prefer BC over N/E
            matches = [m for m in matches if "_N." not in m.name and "_E." not in m.name and "_H." not in m.name]
            color = matches[0].name if matches else None
        if not color:
            return {}
        out = {"color": color}

    color = out["color"]
    stem = re.sub(r"(_BC)?\.(png|jpg|jpeg|tga)$", "", color, flags=re.I)
    for nname in (f"{stem}_N.png", f"{stem}_N.jpg"):
        if (tex_dir / nname).exists():
            out["normal"] = nname
            break
    return out


def find_texture_pair(tex_dir: Path, stem: str) -> dict[str, str]:
    """Resolve color (+ optional normal) filenames for a material stem."""
    candidates_color = [
        f"T_{stem}_BC.png",
        f"T_{stem}_BC.jpg",
        f"T_{stem}.png",
        f"T_{stem}.jpg",
        f"T_{stem}.tga",
        f"T_PROP_{stem}.png",
        f"T_ENV_{stem}_BC.png",
        f"T_ENV_{stem}.png",
    ]
    alt = stem
    for prefix in ("PROP_", "ENV_", "FX_", "BLD_"):
        if alt.startswith(prefix):
            rest = alt[len(prefix) :]
            candidates_color = [
                f"T_{prefix}{rest}.png",
                f"T_{prefix}{rest}_BC.png",
                f"T_{rest}_BC.png",
                f"T_{rest}.png",
            ] + candidates_color
            break

    color = next((c for c in candidates_color if (tex_dir / c).exists()), None)
    if color is None:
        matches = sorted(tex_dir.glob(f"T_{stem}*"))
        matches = [m for m in matches if "_N." not in m.name and "_E." not in m.name]
        color = matches[0].name if matches else None

    out: dict[str, str] = {}
    if color:
        out["color"] = color
        base = re.sub(r"(_BC)?\.(png|jpg|jpeg|tga)$", "", color, flags=re.I)
        for nname in (f"{base}_N.png", f"{base}_N.jpg", f"T_{stem}_N.png"):
            if (tex_dir / nname).exists():
                out["normal"] = nname
                break
    return out


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
    """Basenames referenced by the FBX (paths are usually broken Windows Dropbox paths)."""
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

    # Prefer the texture basename the FBX author assigned.
    texset: dict[str, str] = {}
    for img_name in fbx_intended_images(mat):
        texset = resolve_from_fbx_image_name(tex_dir, img_name)
        if texset:
            break
    if not texset:
        texset = find_texture_pair(tex_dir, stem)
    if not texset:
        texset = find_texture_pair(tex_dir, stem.lower())

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

    # Solid color materials (lamps, accents) — no albedo map.
    if stem in SOLID_COLORS or stem.startswith("CLR_"):
        rgb = SOLID_COLORS.get(stem, (0.8, 0.8, 0.8))
        if "Base Color" in principled.inputs:
            principled.inputs["Base Color"].default_value = (*rgb, 1.0)
        if "Emission Color" in principled.inputs and stem.endswith("_E"):
            principled.inputs["Emission Color"].default_value = (*rgb, 1.0)
            if "Emission Strength" in principled.inputs:
                principled.inputs["Emission Strength"].default_value = 2.0
        mat.blend_method = "OPAQUE"
        try:
            mat.surface_render_method = "DITHERED"
        except Exception:
            pass
        return {"solid": f"{rgb[0]},{rgb[1]},{rgb[2]}"}

    if not texset:
        print("NO_TEX_FOR", mat.name)
        return None

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

    cutout = is_cutout_material(mat.name, texset.get("color", ""))
    color = add_tex(texset["color"])
    if color:
        links.new(color.outputs["Color"], principled.inputs["Base Color"])
        # Only cutout atlases should drive alpha — wiring alpha on opaque PNG
        # albedos makes Blender export every material as alpha BLEND (ghostly).
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
        principled.inputs["Roughness"].default_value = 0.8
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
        if "solid" in texset:
            continue
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

        if texset and "solid" in texset:
            rgb = [float(x) for x in texset["solid"].split(",")]
            pbr["baseColorFactor"] = [rgb[0], rgb[1], rgb[2], 1.0]
            pbr.pop("baseColorTexture", None)
            mat.pop("normalTexture", None)
            mat["alphaMode"] = "OPAQUE"
            mat.pop("alphaCutoff", None)
            continue

        if not texset:
            # Keep whatever Blender wrote, but force opaque unless cutout name.
            if is_cutout_material(name):
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
        pbr["roughnessFactor"] = 0.8

        if is_cutout_material(name, texset.get("color", "")):
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
    """Castle-pack helper — some FBX lights crash Blender's importer."""
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

    # Bake FBX importer scale (0.01) + axis rotation into mesh data so the
    # glTF node is identity — avoids tiny/rotated pieces in the viewer.
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
    src = Path(os.environ.get("VILLAGE_PACK_SRC", str(DEFAULT_SRC)))
    force = os.environ.get("VILLAGE_PACK_FORCE", "0") == "1"
    only = os.environ.get("VILLAGE_PACK_ONLY", "")  # building|prop|foliage

    master_tex = MODELS / "buildings" / "fantastic_village" / "textures"
    ensure_shared_textures(src, master_tex)

    manifest: dict[str, dict] = {}
    for category, rel, out_dir in SOURCES:
        if only and category != only:
            continue
        link_textures_dir(master_tex, out_dir)
        fbx_dir = src / rel
        if not fbx_dir.is_dir():
            print("MISSING_DIR", fbx_dir)
            continue
        files = sorted(fbx_dir.glob("*.fbx")) + sorted(fbx_dir.glob("*.FBX"))
        print(f"CATEGORY {category} count={len(files)} → {out_dir}")
        for fbx in files:
            name = slugify(fbx.name)
            gltf = out_dir / f"{name}.gltf"
            bin_path = out_dir / f"{name}.bin"
            key = f"{category}/{name}"
            if gltf.exists() and bin_path.exists() and not force:
                print(f"SKIP {key}")
                continue
            print(f"CONV {key} <- {fbx.name}")
            try:
                bounds = export_piece(fbx, gltf, master_tex)
                manifest[key] = {
                    "file": f"{name}.gltf",
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

    manifest_path = MODELS / "buildings" / "fantastic_village" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    # Merge with existing if partial run
    if manifest_path.exists() and only:
        try:
            prev = json.loads(manifest_path.read_text())
            prev.update(manifest)
            manifest = prev
        except Exception:
            pass
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"DONE pieces={len(manifest)}")


if __name__ == "__main__":
    main()
