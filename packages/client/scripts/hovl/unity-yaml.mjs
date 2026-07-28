// Minimal helpers for reading Unity's serialized YAML asset format (used by
// extract-effect.mjs to pull ParticleSystem data out of Hovl Studio's
// "Magic effects pack" .prefab files).
//
// Unity's YAML isn't quite spec-compliant multi-document YAML: it declares
// `%TAG !u! tag:unity3d.com,2011:` once at the top of the file and expects
// it to apply to every `--- !u!<classId> &<fileId>` document that follows,
// but per the YAML spec, directives don't carry across documents -- so a
// spec-compliant parser (js-yaml included) throws "undeclared tag handle"
// on the second document onward. We sidestep this by splitting the file on
// document boundaries ourselves, stripping the `!u!<classId> &<fileId>`
// marker (capturing classId/fileId directly via regex) before handing the
// remaining plain-YAML body to js-yaml.
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

/** Parse a Unity .prefab/.asset/.mat file into `fileId -> { classId, data }`. */
export function parseUnityYaml(text) {
  const parts = text.split(/^--- /m).slice(1);
  const objectsById = new Map();
  for (const part of parts) {
    const header = /^!u!(\d+) &(-?\d+)\n/.exec(part);
    if (!header) continue;
    const [, classId, fileId] = header;
    const body = part.slice(header[0].length);
    let data;
    try {
      data = yaml.load(body);
    } catch (e) {
      console.warn(`  ! yaml parse failed for classId ${classId} fileId ${fileId}: ${e.message}`);
      continue;
    }
    objectsById.set(fileId, { classId: Number(classId), data });
  }
  return objectsById;
}

export function readUnityFile(file) {
  return parseUnityYaml(fs.readFileSync(file, "utf8"));
}

/** Build a `guid -> absolute file path` index from every *.meta file under
 *  `root` (skipping the .meta suffix -- the guid always refers to the asset
 *  the .meta file describes, not the .meta file itself). */
export function buildGuidIndex(root) {
  const index = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.name.endsWith(".meta")) {
        const text = fs.readFileSync(p, "utf8");
        const m = /^guid: ([0-9a-f]+)/m.exec(text);
        if (m) index.set(m[1], p.slice(0, -".meta".length));
      }
    }
  }
  walk(root);
  return index;
}

/** Resolve a ParticleSystemRenderer's first material to its main texture's
 *  absolute path, by chasing material guid -> .mat file -> `_MainTex` guid
 *  -> texture file, all via the guid index. Returns null at any broken link
 *  (e.g. a material with no texture, a shader-only effect, a missing file)
 *  rather than throwing -- callers should treat that as "no texture". */
export function resolveMainTexture(materialGuid, guidIndex) {
  const matPath = guidIndex.get(materialGuid);
  if (!matPath) return null;
  const matObjs = readUnityFile(matPath);
  const matDoc = [...matObjs.values()].find((o) => o.classId === 21)?.data?.Material;
  if (!matDoc) return null;
  const texEnvs = matDoc.m_SavedProperties?.m_TexEnvs ?? [];
  const mainTexEntry = texEnvs.find((e) => "_MainTex" in e);
  const texRef = mainTexEntry?._MainTex?.m_Texture;
  if (!texRef?.guid) return null;
  const texPath = guidIndex.get(texRef.guid);
  return {
    materialName: matDoc.m_Name,
    shader: matDoc.m_Shader,
    keywords: matDoc.m_ValidKeywords ?? [],
    floats: Object.fromEntries((matDoc.m_SavedProperties?.m_Floats ?? []).map((f) => Object.entries(f)[0])),
    colors: Object.fromEntries((matDoc.m_SavedProperties?.m_Colors ?? []).map((c) => Object.entries(c)[0])),
    texturePath: texPath,
  };
}
