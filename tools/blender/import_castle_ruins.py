#!/usr/bin/env python3
"""Convert Castle Ruins OBJ + palette atlas → self-contained GLB for the region editor.

Usage (macOS):
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/blender/import_castle_ruins.py

Optional env overrides:
  CASTLE_RUINS_SRC  — folder with CastleRuins.obj + palette color.png
  CASTLE_RUINS_OUT  — destination folder under public/assets/models/buildings/
"""

from __future__ import annotations

import os
import shutil
import struct
import json
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SRC = Path("/Users/champion/Development/Assets/Castle Ruins")
DEFAULT_OUT = REPO / "packages/client/public/assets/models/buildings/castle_ruins"


def fix_material(mat, img) -> None:
    if mat is None:
        return
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out:
            links.new(principled.outputs["BSDF"], out.inputs["Surface"])
    tex_node = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
    if tex_node is None:
        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.location = (-300, 0)
    tex_node.image = img
    tex_node.interpolation = "Closest"
    for link in list(principled.inputs["Base Color"].links):
        links.remove(link)
    links.new(tex_node.outputs["Color"], principled.inputs["Base Color"])
    if "Metallic" in principled.inputs:
        principled.inputs["Metallic"].default_value = 0.0
    if "Roughness" in principled.inputs:
        principled.inputs["Roughness"].default_value = 0.85


def patch_glb_nearest_sampler(glb_path: Path) -> None:
    """Force NEAREST mag/min filters so the 100×100 palette doesn't bleed."""
    data = bytearray(glb_path.read_bytes())
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    assert ctype == b"JSON", ctype
    g = json.loads(bytes(data[20 : 20 + clen]).decode("utf-8").rstrip(" \x00"))
    for s in g.get("samplers", []):
        s["magFilter"] = 9728  # NEAREST
        s["minFilter"] = 9728
    new_json = json.dumps(g, separators=(",", ":")).encode("utf-8")
    pad = (4 - (len(new_json) % 4)) % 4
    new_json_padded = new_json + (b" " * pad)
    bin_chunk = bytes(data[20 + clen :])
    out = bytearray()
    out += b"glTF"
    total = 12 + 8 + len(new_json_padded) + len(bin_chunk)
    out += struct.pack("<II", 2, total)
    out += struct.pack("<I4s", len(new_json_padded), b"JSON")
    out += new_json_padded
    out += bin_chunk
    glb_path.write_bytes(out)


def main() -> None:
    src = Path(os.environ.get("CASTLE_RUINS_SRC", str(DEFAULT_SRC)))
    out = Path(os.environ.get("CASTLE_RUINS_OUT", str(DEFAULT_OUT)))
    out.mkdir(parents=True, exist_ok=True)

    obj_src = src / "CastleRuins.obj"
    palette_src = src / "palette color.png"
    if not obj_src.exists():
        raise SystemExit(f"Missing OBJ: {obj_src}")
    if not palette_src.exists():
        raise SystemExit(f"Missing palette: {palette_src}")

    work_obj = out / "CastleRuins.obj"
    work_mtl = out / "CastleRuins.mtl"
    work_tex = out / "palette_color.png"
    out_glb = out / "CastleRuins.glb"

    shutil.copy2(obj_src, work_obj)
    shutil.copy2(palette_src, work_tex)
    work_mtl.write_text(
        "\n".join(
            [
                "newmtl Material",
                "Ka 1.000 1.000 1.000",
                "Kd 1.000 1.000 1.000",
                "Ks 0.000 0.000 0.000",
                "Ns 10.000",
                "d 1.000",
                "illum 1",
                "map_Kd palette_color.png",
                "",
            ]
        ),
        encoding="utf-8",
    )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.wm.obj_import(filepath=str(work_obj))
    except Exception:
        bpy.ops.import_scene.obj(filepath=str(work_obj))

    img = bpy.data.images.load(str(work_tex))
    img.name = "palette_color"
    img.colorspace_settings.name = "sRGB"
    try:
        img.pack()
    except Exception as e:
        print("PACK_WARN", e)

    fallback = bpy.data.materials.new(name="CastleRuinsPalette")
    fallback.use_nodes = True
    fix_material(fallback, img)
    for mat in list(bpy.data.materials):
        fix_material(mat, img)
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if len(obj.data.materials) == 0:
            obj.data.materials.append(fallback)
        for i, slot in enumerate(obj.material_slots):
            if slot.material is None:
                obj.material_slots[i].material = fallback
            else:
                fix_material(slot.material, img)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"MESH_COUNT={len(meshes)} MATERIALS={len(bpy.data.materials)}")

    bpy.ops.export_scene.gltf(
        filepath=str(out_glb),
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    patch_glb_nearest_sampler(out_glb)

    # Drop intermediates — GLB is self-contained.
    for p in (work_obj, work_mtl, work_tex):
        try:
            p.unlink()
        except FileNotFoundError:
            pass

    print(f"WROTE={out_glb} size={out_glb.stat().st_size}")


if __name__ == "__main__":
    main()
