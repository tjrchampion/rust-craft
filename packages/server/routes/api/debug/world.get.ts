import { defineEventHandler, createError } from "h3";
import { generateVillages, generateMobSpawns, generateNpcQuestGivers, generatePois, generateBridges } from "@rustcraft/shared";
import { IS_DEV } from "../../../utils/env";

export default defineEventHandler(() => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  return {
    villages: generateVillages().map((v) => ({ id: v.id, name: v.name, x: v.x, z: v.z })),
    mobSpawns: generateMobSpawns(),
    npcs: generateNpcQuestGivers(),
    pois: generatePois(),
    bridges: generateBridges(),
  };
});
