export interface SpellDef {
  id: string;
  name: string;
  castTimeS: number;
  manaCost: number;
  cooldownS: number;
  range: number;
  damage: number;
  projectileSpeed: number;
}

export const SPELLS: Record<string, SpellDef> = {
  firebolt: {
    id: "firebolt",
    name: "Firebolt",
    castTimeS: 1.2,
    manaCost: 25,
    cooldownS: 3,
    range: 30,
    damage: 32,
    projectileSpeed: 26,
  },
};

export function spellDef(id: string): SpellDef {
  const def = SPELLS[id];
  if (!def) throw new Error(`Unknown spell: ${id}`);
  return def;
}
