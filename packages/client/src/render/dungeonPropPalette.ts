/** Curated, prefix-grouped subset of the KayKit prop catalog for the
 *  dungeon editor's asset palette (packages/client/src/ui/DungeonEditor.svelte)
 *  -- the full props directory has ~456 files spanning several unrelated
 *  KayKit packs (medieval village, weapons, fishing, etc); only the
 *  dungeon-relevant groups below are worth surfacing here. */
export interface PropPaletteGroup {
  label: string;
  models: string[];
}

export const DUNGEON_PROP_PALETTE: PropPaletteGroup[] = [
  {
    label: "Floors",
    models: [
      "floor_tile_large.gltf",
      "floor_tile_large_rocks.gltf",
      "floor_tile_small.gltf",
      "floor_tile_small_broken_A.gltf",
      "floor_tile_small_broken_B.gltf",
      "floor_tile_small_decorated.gltf",
      "floor_tile_big_grate.gltf",
      "floor_tile_big_grate_open.gltf",
      "floor_tile_big_spikes.gltf",
      "floor_dirt_large.gltf",
      "floor_dirt_large_rocky.gltf",
    ],
  },
  {
    label: "Stairs",
    models: [
      "stairs_modular_center.gltf",
      "stairs_modular_left.gltf",
      "stairs_modular_right.gltf",
      "stairs_long_modular_center.gltf",
      "stairs_long_modular_left.gltf",
      "stairs_long_modular_right.gltf",
      "stairs_wide.gltf",
      "stairs_narrow.gltf",
      "stairs_long.gltf",
      "stairs_walled.gltf",
      "stairs_wall_left.gltf",
      "stairs_wall_right.gltf",
      "stairs_wood.gltf",
      "stairs_wood_decorated.gltf",
    ],
  },
  {
    label: "Walls",
    models: [
      "wall.gltf",
      "wall_half.gltf",
      "wall_corner.gltf",
      "wall_corner_small.gltf",
      "wall_endcap.gltf",
      "wall_half_endcap.gltf",
      "wall_crossing.gltf",
      "wall_Tsplit.gltf",
      "wall_doorway.gltf",
      "wall_doorway_Tsplit.gltf",
      "wall_doorway_sides.gltf",
      "wall_arched.gltf",
      "wall_archedwindow_open.gltf",
      "wall_window_open.gltf",
      "wall_window_closed.gltf",
      "wall_broken.gltf",
      "wall_cracked.gltf",
      "wall_sloped.gltf",
      "wall_inset.gltf",
      "wall_inset_candles.gltf",
      "wall_inset_shelves.gltf",
      "wall_pillar.gltf",
      "wall_shelves.gltf",
      "wall_gated.gltf",
    ],
  },
  {
    label: "Torches & Light",
    models: ["torch_mounted.gltf", "torch_lit.gltf", "torch.gltf", "torch_burnt.gltf", "candle_thin_lit.gltf"],
  },
  {
    label: "Chests",
    models: ["chest.gltf", "chest_gold.gltf", "chest_large.gltf", "chest_large_gold.gltf", "chest_mimic.gltf"],
  },
  {
    label: "Pillars & Columns",
    models: ["pillar.gltf", "pillar_decorated.gltf", "column.gltf"],
  },
  {
    label: "Rubble & Debris",
    models: ["rubble_half.gltf", "rubble_large.gltf"],
  },
  {
    label: "Banners",
    models: [
      "banner_red.gltf", "banner_blue.gltf", "banner_green.gltf", "banner_brown.gltf",
      "banner_white.gltf", "banner_yellow.gltf",
      "banner_shield_red.gltf", "banner_shield_blue.gltf", "banner_shield_green.gltf",
      "banner_triple_red.gltf", "banner_triple_blue.gltf",
    ],
  },
  {
    label: "Tables & Barrels",
    models: [
      "table_long.gltf", "table_long_decorated_A.gltf", "table_medium.gltf", "table_small.gltf",
      "table_round_medium.gltf", "barrel_large.gltf", "barrel_small.gltf", "barrel_small_stack.gltf",
    ],
  },
  {
    label: "Barriers & Locks",
    models: ["barrier.gltf", "barrier_column.gltf", "barrier_corner.gltf", "key_gold.gltf", "lock_A.gltf"],
  },
];

/** Real measured vertical spans (world units) for the stairs models above,
 *  extracted from each glTF's POSITION accessor bounding box -- these are
 *  just sensible starting points for the editor's per-instance `rise`
 *  field, not enforced; the author can override to match what they see. */
export const STAIRS_RISE_DEFAULTS: Record<string, number> = {
  "stairs_wide.gltf": 5.1,
  "stairs_modular_center.gltf": 4.0,
  "stairs_modular_left.gltf": 5.1,
  "stairs_modular_right.gltf": 5.1,
  "stairs_long.gltf": 5.1,
  "stairs_long_modular_center.gltf": 4.0,
  "stairs_long_modular_left.gltf": 5.1,
  "stairs_long_modular_right.gltf": 5.1,
  "stairs_narrow.gltf": 5.1,
  "stairs_wood.gltf": 4.05,
  "stairs_wood_decorated.gltf": 4.05,
  "stairs_walled.gltf": 5.1,
  "stairs_wall_left.gltf": 5.1,
  "stairs_wall_right.gltf": 5.1,
};

export const DEFAULT_STAIRS_RISE = 4.0;
