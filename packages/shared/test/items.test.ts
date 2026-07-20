import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ITEMS } from "../src/content/items";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPS_DIR = join(__dirname, "../../client/public/assets/models/props");

describe("items", () => {
  it("every weapon-slot gear item declares a weaponType", () => {
    for (const item of Object.values(ITEMS)) {
      if (item.type !== "gear" || item.slot !== "weapon") continue;
      expect(item.weaponType, `${item.id} is missing weaponType`).toBeDefined();
    }
  });

  it("every weaponProp url (excluding legacy .glb-only assets) resolves to a real file under props/", () => {
    for (const item of Object.values(ITEMS)) {
      if (!item.weaponProp) continue;
      if (!item.weaponProp.url.endsWith(".gltf")) continue; // .glb assets are pre-existing, not part of this pass
      const filename = item.weaponProp.url.split("/").pop()!;
      const path = join(PROPS_DIR, filename);
      expect(existsSync(path), `${item.id}'s weaponProp file ${filename} does not exist`).toBe(true);
    }
  });
});
