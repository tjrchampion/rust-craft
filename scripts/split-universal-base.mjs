#!/usr/bin/env node
/**
 * Splits the monolithic Superhero base-body mesh (Regular_Male.glb /
 * Regular_Female.glb) into separate per-region nodes so modular clothing can
 * *swap out* the covered skin instead of rendering on top of it.
 *
 * Why this exists: the Universal base character ships as ONE continuous
 * skinned mesh covering the whole body. Modular outfit pieces (Peasant/
 * Ranger Body/Arms/Legs/Feet…) are separate meshes drawn alongside it, so
 * without this split the only way to hide bare skin under equipped gear is
 * an all-or-nothing toggle of the *entire* body — which either leaves skin
 * poking through unclothed regions, or (worse) makes the whole character
 * disappear when only a single slot is equipped.
 *
 * This script buckets every vertex of the base mesh into an anatomical
 * region by its dominant skinning joint, splits the mesh's index buffer
 * into one sub-mesh per region (a triangle goes wherever most of its 3
 * corners voted), and re-emits each region as its own named node
 * ("Regular_Male_Torso", "Regular_Male_Arms", …) bound to the *same* shared
 * skin/skeleton and attribute accessors as before (no geometry is altered,
 * only how it's split across draw calls). At runtime, gltf.ts's
 * autoManageBodySkin() hides exactly the regions an equipped slot's own
 * mesh is authored to cover, matched against the same region table below.
 *
 * Region boundaries were derived empirically from the actual per-vertex
 * bone-weight coverage of every Peasant/Ranger outfit piece in
 * `Modular Parts/` (see PR discussion) — e.g. arms pieces always cover
 * upperarm+lowerarm together but only *some* (the glove-style "Ranger
 * Gloves") also cover the hand, and feet pieces always cover calf+foot
 * together (they're tall boots), which is why Thigh/Calf/Hands are their
 * own regions rather than lumped into one "Legs"/"Arms" bucket.
 *
 * Usage: node scripts/split-universal-base.mjs
 * (Re-run any time Regular_Male.glb / Regular_Female.glb is re-imported
 * from a fresh Superhero_*_FullBody.gltf export.)
 */
import { NodeIO } from "@gltf-transform/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, "..", "packages/client/public/assets/models/modular/base");

/** joint name -> region bucket. Any joint not listed here (there shouldn't
 *  be any on this rig) falls back to "Torso". */
function buildRegionOf() {
  const REGION_OF = {};
  const set = (names, region) => names.forEach((n) => (REGION_OF[n] = region));
  set(["Head"], "Head");
  // Neck is its own region, separate from Torso: no outfit collar in this
  // pack reliably covers the neck seam, so lumping neck_01 in with the
  // chest-hidden Torso bucket left a visible gap between chin and collar
  // whenever chest gear was equipped (which is effectively always). Keeping
  // it split out lets it stay permanently visible regardless of gear.
  set(["neck_01"], "Neck");
  set(["root", "pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"], "Torso");
  set(["upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"], "Arms");
  const handNames = [];
  for (const side of ["l", "r"]) {
    handNames.push(`hand_${side}`);
    for (const finger of ["index", "middle", "pinky", "ring", "thumb"]) {
      for (const seg of ["01", "02", "03", "04_leaf"]) handNames.push(`${finger}_${seg}_${side}`);
    }
  }
  set(handNames, "Hands");
  set(["thigh_l", "thigh_r"], "Thigh");
  set(["calf_l", "calf_r"], "Calf");
  set(["foot_l", "foot_r", "ball_l", "ball_r", "ball_leaf_l", "ball_leaf_r"], "Feet");
  return REGION_OF;
}

const REGIONS = ["Head", "Neck", "Torso", "Arms", "Hands", "Thigh", "Calf", "Feet"];

async function splitBase(fileName, baseMeshNodeMatcher) {
  const filePath = path.join(BASE_DIR, fileName);
  const io = new NodeIO();
  const doc = await io.read(filePath);
  const root = doc.getRoot();

  const bodyNode = root.listNodes().find((n) => n.getMesh() && baseMeshNodeMatcher(n.getName()));
  if (!bodyNode) {
    console.log(`[${fileName}] no matching body node — already split for this region set, skipping.`);
    return;
  }
  const parent = bodyNode.getParentNode();
  if (!parent) throw new Error(`[${fileName}] base body node has no parent`);

  const mesh = bodyNode.getMesh();
  const prims = mesh.listPrimitives();
  if (prims.length !== 1) {
    throw new Error(`[${fileName}] expected exactly 1 primitive on base mesh, found ${prims.length}`);
  }
  const prim = prims[0];
  const skin = bodyNode.getSkin();
  if (!skin) throw new Error(`[${fileName}] base body node has no skin`);
  const jointNames = skin.listJoints().map((j) => j.getName());

  const jointsAttr = prim.getAttribute("JOINTS_0");
  const weightsAttr = prim.getAttribute("WEIGHTS_0");
  const indicesAccessor = prim.getIndices();
  if (!jointsAttr || !weightsAttr || !indicesAccessor) {
    throw new Error(`[${fileName}] base primitive missing JOINTS_0/WEIGHTS_0/indices`);
  }
  const indices = indicesAccessor.getArray();
  const vertexCount = jointsAttr.getCount();

  const REGION_OF = buildRegionOf();

  // Per-vertex dominant-joint region.
  const vertexRegion = new Uint8Array(vertexCount);
  const regionIndex = new Map(REGIONS.map((r, i) => [r, i]));
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let v = 0; v < vertexCount; v++) {
    jointsAttr.getElement(v, j);
    weightsAttr.getElement(v, w);
    let bestW = -1;
    let bestJ = 0;
    for (let k = 0; k < 4; k++) {
      if (w[k] > bestW) {
        bestW = w[k];
        bestJ = j[k];
      }
    }
    const jointName = jointNames[bestJ];
    const region = REGION_OF[jointName] ?? "Torso";
    vertexRegion[v] = regionIndex.get(region);
  }

  // Per-triangle majority vote -> bucket of index-triples per region.
  const buckets = REGIONS.map(() => []);
  const votes = new Int32Array(REGIONS.length);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];
    votes.fill(0);
    votes[vertexRegion[i0]]++;
    votes[vertexRegion[i1]]++;
    votes[vertexRegion[i2]]++;
    let bestRegion = vertexRegion[i0];
    let bestCount = -1;
    for (let r = 0; r < REGIONS.length; r++) {
      if (votes[r] > bestCount) {
        bestCount = votes[r];
        bestRegion = r;
      }
    }
    const bucket = buckets[bestRegion];
    bucket.push(i0, i1, i2);
  }

  const IndicesCtor = indices.constructor;
  const baseName = fileName.replace(/\.glb$/i, "");
  const createdNodes = [];
  for (let r = 0; r < REGIONS.length; r++) {
    const triIndices = buckets[r];
    if (triIndices.length === 0) continue;
    const regionName = REGIONS[r];
    const nodeName = `${baseName}_${regionName}`;

    const idxAccessor = doc
      .createAccessor(`${nodeName}_indices`)
      .setArray(new IndicesCtor(triIndices))
      .setType("SCALAR");

    const regionPrim = doc.createPrimitive().setMode(prim.getMode()).setIndices(idxAccessor);
    for (const semantic of prim.listSemantics()) {
      regionPrim.setAttribute(semantic, prim.getAttribute(semantic));
    }
    const material = prim.getMaterial();
    if (material) regionPrim.setMaterial(material);

    const regionMesh = doc.createMesh(nodeName).addPrimitive(regionPrim);
    const regionNode = doc
      .createNode(nodeName)
      .setMesh(regionMesh)
      .setSkin(skin)
      .setTranslation(bodyNode.getTranslation())
      .setRotation(bodyNode.getRotation())
      .setScale(bodyNode.getScale());
    parent.addChild(regionNode);
    createdNodes.push([nodeName, triIndices.length / 3]);
  }

  parent.removeChild(bodyNode);
  bodyNode.dispose();
  mesh.dispose();

  await io.write(filePath, doc);
  console.log(`[${fileName}] split into ${createdNodes.length} regions:`);
  for (const [name, triCount] of createdNodes) {
    console.log(`  ${name}: ${triCount} triangles`);
  }
}

/** Re-carve the Neck out of an already-split file's combined Torso node,
 *  for bases that were split before Neck became its own region — without
 *  this, migrating an existing Regular_Male.glb/Regular_Female.glb would
 *  require re-importing from the original unsplit Superhero_*_FullBody
 *  source, which usually isn't lying around anymore. Skips (no-op) if this
 *  file's Neck region already exists. */
async function hasNode(fileName, nameMatcher) {
  const io = new NodeIO();
  const doc = await io.read(path.join(BASE_DIR, fileName));
  return doc.getRoot().listNodes().some((n) => nameMatcher(n.getName()));
}

for (const [fileName, gender] of [
  ["Regular_Male.glb", "male"],
  ["Regular_Female.glb", "female"],
]) {
  const monolithicMatcher = (name) => new RegExp(`^superhero_${gender}$`, "i").test(name);
  const neckExists = await hasNode(fileName, (name) => new RegExp(`^regular_${gender}_neck$`, "i").test(name));
  if (neckExists) {
    console.log(`[${fileName}] Neck region already present, nothing to do.`);
    continue;
  }
  if (await hasNode(fileName, monolithicMatcher)) {
    await splitBase(fileName, monolithicMatcher);
  } else {
    // Already split under the old (Neck-less) region set -- re-carve Neck
    // out of the existing combined Torso node instead of the full body.
    const torsoMatcher = (name) => new RegExp(`^regular_${gender}_torso$`, "i").test(name);
    await splitBase(fileName, torsoMatcher);
  }
}
console.log("Done.");
