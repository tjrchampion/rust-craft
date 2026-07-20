<script lang="ts">
  import { onMount } from "svelte";
  import { game, type CharacterTab } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon, spellIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import { wikiMarkdown } from "./wikiContent";

  const KBM_LABELS = ["1", "2", "3", "4", "5", "6", "Q", "Z", "X", "C"];
  const PAD_LABELS = ["LB+A", "LB+B", "LB+X", "LB+Y", "LB+↑", "LB+↓", "LB+←", "LB+→", "RB+A", "RB+B"];

  function keyLabel(i: number): string {
    return promptLabel(PAD_LABELS[i] ?? "", KBM_LABELS[i] ?? "");
  }
  import {
    RECIPES,
    itemDef,
    spellDef,
    mobDef,
    auraDef,
    classDef,
    INVENTORY_SLOTS,
    HOTBAR_SLOTS,
    EQUIP_SLOTS,
    computeActorStats,
    type ItemSnap,
    type ItemDef,
    type GearSlot,
    type SpellDef,
    type StatModifiers,
    type RecipeDef,
  } from "@rustcraft/shared";

  const SPELL_PREFIX = "spell:";
  function spellIdOf(item: ItemSnap | undefined): string | null {
    return item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
  }

  const TABS: { id: CharacterTab; label: string }[] = [
    { id: "inventory", label: "Inventory" },
    { id: "quests", label: "Quests" },
    { id: "spellbook", label: "Spell Book" },
    { id: "craft", label: "Crafting" },
    { id: "party", label: "Party" },
    { id: "system", label: "System" },
  ];
  const EQUIP_LABELS: Record<string, string> = {
    weapon: "Weapon",
    head: "Head/Helmet",
    chest: "Chest/Body",
    arms: "Hands/Gloves",
    legs: "Legs/Pants",
    feet: "Feet/Boots"
  };
  const recipes = Object.values(RECIPES);

  let invCursor = $state(0);
  let equipCursor = $state(0);
  let craftCursor = $state(0);
  let spellCursor = $state(0);
  let spellBookFocus = $state<"spells" | "hotbar">("spells");
  let spellHotbarCursor = $state(0);
  let questsCursor = $state(0);
  let questSubFocus = $state<"track" | "share">("track");
  let craftTabFocus = $state<"inventory" | "grid" | "output" | "clear" | "recipes">("inventory");
  let craftGridCursor = $state(0);
  let clearBtnFocus = $state(0);
  let systemCursor = $state(0);
  let systemSubTabIdx = $state(0); // 0 = game, 1 = wiki
  const systemTabSub = $derived(systemSubTabIdx === 0 ? "game" : "wiki");
  let systemSubFocus = $state<"sidebar" | "content">("sidebar");
  let wikiScrollContainer = $state<HTMLDivElement | null>(null);

  interface WikiLine {
    type: "h1" | "h2" | "h3" | "p" | "li" | "hr";
    text: string;
  }

  function parseWiki(md: string): WikiLine[] {
    const lines = md.split("\n");
    const parsed: WikiLine[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "---") {
        parsed.push({ type: "hr", text: "" });
      } else if (trimmed.startsWith("### ")) {
        parsed.push({ type: "h3", text: trimmed.slice(4) });
      } else if (trimmed.startsWith("## ")) {
        parsed.push({ type: "h2", text: trimmed.slice(3) });
      } else if (trimmed.startsWith("# ")) {
        parsed.push({ type: "h1", text: trimmed.slice(2) });
      } else if (trimmed.startsWith("- ")) {
        parsed.push({ type: "li", text: trimmed.slice(2) });
      } else {
        parsed.push({ type: "p", text: trimmed });
      }
    }
    return parsed;
  }

  const wikiParsed = parseWiki(wikiMarkdown);

  function formatBoldText(text: string): string {
    return text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }
  /** Item picked up from inv/hotbar/equip (moved via sendMoveItem) -- also
   *  covers rearranging a spell already slotted in the hotbar, since both
   *  ends are "hotbar" and moveItem tolerates the "spell:" marker. */
  let moving = $state<{ container: "inventory" | "hotbar" | "equip" | "crafting"; slot: number } | null>(null);
  /** A spell picked from the Spell Book list (or an already-slotted hotbar
   *  cell), waiting for a hotbar slot to land on via sendAssignSpell. */
  let movingSpell = $state<string | null>(null);
  /** Floating spell tooltip -- fixed-position (viewport-relative, computed
   *  from the hovered row's own rect) rather than CSS :hover + absolute, so
   *  it always renders above everything with no ancestor overflow/scroll
   *  container able to clip it. */
  let hoveredSpell = $state<string | null>(null);
  let tooltipPos = $state({ x: 0, y: 0 });
  /** Floating item tooltip -- structurally parallel to hoveredSpell/tooltipPos
   *  above, reusing the same fixed-position/rect-based approach and the
   *  .floating-tooltip CSS shell. */
  let hoveredItem = $state<{ itemId: string; durability: number | null } | null>(null);
  let itemTooltipPos = $state({ x: 0, y: 0 });
  let isFullscreen = $state(!!document.fullscreenElement);

  $effect(() => {
    const _tab = game.activeTab;
    moving = null;
    movingSpell = null;
    spellBookFocus = "spells";
    spellHotbarCursor = 0;
    questsCursor = 0;
    questSubFocus = "track";
    craftTabFocus = "inventory";
    craftGridCursor = 0;
    clearBtnFocus = 0;
    systemSubTabIdx = 0;
    systemSubFocus = "sidebar";
  });

  const invSlots = $derived(
    Array.from({ length: INVENTORY_SLOTS }, (_, i) => game.inventory.find((it) => it.container === "inventory" && it.slot === i)),
  );
  const hotbarSlots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) => game.inventory.find((it) => it.container === "hotbar" && it.slot === i)),
  );
  const equipSlots = $derived(
    Array.from({ length: EQUIP_SLOTS.length }, (_, i) => game.inventory.find((it) => it.container === "equip" && it.slot === i)),
  );
  const learnedSpells = $derived(game.learnedSpells);

  let spellElements = $state<(HTMLElement | null)[]>([]);
  let hotbarElements = $state<(HTMLElement | null)[]>([]);

  // Expose system state to window for controller fullscreen support
  $effect(() => {
    (window as any).__systemTabSub = systemTabSub;
    (window as any).__systemSubFocus = systemSubFocus;
    (window as any).__systemCursor = systemCursor;
  });

  const classInfo = $derived(game.classId ? classDef(game.classId) : null);
  const computedStats = $derived.by(() => {
    if (!classInfo || !game.self) return null;
    const gearMods = game.inventory
      .filter((i) => i.container === "equip")
      .map((i) => itemDef(i.itemId).statModifiers)
      .filter((m): m is StatModifiers => !!m);
    return computeActorStats(classInfo.baseStats, game.self.level, gearMods, []);
  });
  const classSpells = $derived(classInfo ? classInfo.startingSpells : []);
  const spellsToShow = $derived.by(() => {
    const list = [...classSpells];
    for (const spellId of game.learnedSpells) {
      if (!list.includes(spellId)) {
        list.push(spellId);
      }
    }
    return list;
  });

  const equippedWeapon = $derived(game.inventory.find((i) => i.container === "equip" && i.slot === 0));
  const equippedWeaponType = $derived(equippedWeapon ? itemDef(equippedWeapon.itemId).weaponType : undefined);

  function weaponTypeLabel(t: string): string {
    return t[0]!.toUpperCase() + t.slice(1);
  }

  const isSpellLocked = (spellId: string) => {
    const def = spellDef(spellId);
    const req = def.requiredLevel ?? 1;
    const playerLvl = game.self?.level ?? 1;
    if (playerLvl < req) return true;
    if (def.allowedWeaponTypes && (!equippedWeaponType || !def.allowedWeaponTypes.includes(equippedWeaponType))) return true;
    return false;
  };

  /** Human-readable reason the spell row is locked/greyed out, for the badge. */
  function spellLockReason(spellId: string): string {
    const def = spellDef(spellId);
    const req = def.requiredLevel ?? 1;
    const playerLvl = game.self?.level ?? 1;
    if (playerLvl < req) return `Req. Lvl ${req}`;
    if (def.allowedWeaponTypes && (!equippedWeaponType || !def.allowedWeaponTypes.includes(equippedWeaponType))) {
      return `Requires: ${def.allowedWeaponTypes.map(weaponTypeLabel).join(", ")}`;
    }
    return "";
  }

  // Controller-driven spell tooltip synchronization
  $effect(() => {
    const tab = game.activeTab;
    const focus = spellBookFocus;
    const cursor = spellCursor;
    const hotbarCursor = spellHotbarCursor;

    // Reset/clear tooltip when tab changes or if not focused on spells/hotbar
    hoveredSpell = null;

    if (tab === "spellbook") {
      if (focus === "spells") {
        const spellId = spellsToShow[cursor];
        const el = spellElements[cursor];
        if (spellId && el) {
          hoveredSpell = spellId;
          const r = el.getBoundingClientRect();
          tooltipPos = { x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top };
        }
      } else if (focus === "hotbar") {
        const spellId = slotSpellId(hotbarCursor);
        const el = hotbarElements[hotbarCursor];
        if (spellId && el) {
          hoveredSpell = spellId;
          const r = el.getBoundingClientRect();
          tooltipPos = { x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top };
        }
      }
    }
  });

  const craftingSlots = $derived(
    Array.from({ length: 9 }, (_, i) => game.inventory.find((it) => it.container === "crafting" && it.slot === i))
  );

  // Exact match: the grid's distinct item ids must equal a recipe's
  // ingredient id set precisely (not just "at least enough of everything
  // it needs"), otherwise a low-threshold recipe (e.g. torch, wood-only)
  // hijacks the match the moment its own bar is cleared, regardless of
  // other unrelated items also sitting in the grid for a different recipe.
  const matchedRecipe = $derived.by(() => {
    const active = craftingSlots.filter(it => it !== undefined && it.qty > 0);
    if (active.length === 0) return null;
    const totals: Record<string, number> = {};
    for (const it of active) {
      if (it) totals[it.itemId] = (totals[it.itemId] ?? 0) + it.qty;
    }
    const gridItemIds = Object.keys(totals);
    for (const recipe of Object.values(RECIPES)) {
      if (recipe.ingredients.length !== gridItemIds.length) continue;
      if (!gridItemIds.every((id) => recipe.ingredients.some((ing) => ing.itemId === id))) continue;
      if (recipe.ingredients.every((ing) => (totals[ing.itemId] ?? 0) >= ing.qty)) return recipe;
    }
    return null;
  });

  const partyMemberIds = $derived(new Set((game.party ?? []).map((m) => m.id)));
  const invitablePlayers = $derived(game.roster.filter((p) => p.id !== game.selfId && !partyMemberIds.has(p.id)));
  const amLeader = $derived((game.party ?? []).find((m) => m.id === game.selfId)?.leader ?? false);

  function count(itemId: string): number {
    return game.inventory.reduce((n, it) => (it.itemId === itemId ? n + it.qty : n), 0);
  }
  function canCraft(recipeId: string): boolean {
    const r = RECIPES[recipeId]!;
    return r.ingredients.every((ing) => count(ing.itemId) >= ing.qty);
  }

  /** Return every grid slot to the inventory -- topping off an existing
   *  stack of the same item (up to its stack cap) before falling back to a
   *  fresh empty slot, so clearing doesn't fragment stackable resources
   *  across the backpack. No partial reuse *within* the grid, no "history"
   *  left behind -- every slot empties out completely. Tracks stacks/claimed
   *  slots locally (not by re-reading game.inventory mid-loop) since
   *  sendMoveItem is fire-and-forget -- otherwise multiple grid items would
   *  all target the same "first empty slot" the reactive state hasn't
   *  caught up to yet, colliding with each other. */
  function clearCraftingGrid(): void {
    const g = getGame();
    if (!g) return;
    const stacks = game.inventory
      .filter((it) => it.container === "inventory")
      .map((it) => ({ itemId: it.itemId, qty: it.qty, slot: it.slot }));
    const usedInventorySlots = new Set(stacks.map((s) => s.slot));

    for (let i = 0; i < 9; i++) {
      const item = craftingSlots[i];
      if (!item) continue;
      let remaining = item.qty;
      const cap = itemDef(item.itemId).stack;
      for (const stack of stacks) {
        if (remaining <= 0) break;
        if (stack.itemId !== item.itemId || stack.qty >= cap) continue;
        const take = Math.min(cap - stack.qty, remaining);
        g.sendMoveItem("crafting", i, "inventory", stack.slot, take);
        stack.qty += take;
        remaining -= take;
      }
      if (remaining <= 0) continue;
      let targetSlot = -1;
      for (let s = 0; s < INVENTORY_SLOTS; s++) {
        if (!usedInventorySlots.has(s)) {
          targetSlot = s;
          break;
        }
      }
      if (targetSlot === -1) continue; // inventory full
      g.sendMoveItem("crafting", i, "inventory", targetSlot, remaining);
      usedInventorySlots.add(targetSlot);
      stacks.push({ itemId: item.itemId, qty: remaining, slot: targetSlot });
    }
  }

  function close(): void {
    clearCraftingGrid();
    game.inventoryOpen = false;
    getGame()?.setUiMode(false);
  }

  function selectTab(tab: CharacterTab): void {
    if (game.activeTab === "craft" && tab !== "craft") {
      clearCraftingGrid();
    }
    game.activeTab = tab;
    moving = null;
    movingSpell = null;
    spellBookFocus = "spells";
    spellHotbarCursor = 0;
    questsCursor = 0;
    craftTabFocus = "inventory";
    craftGridCursor = 0;
    clearBtnFocus = 0;
  }

  // ------------------------------------------------------------------- quests
  function objectiveText(kind: "kill" | "gather", target: string): string {
    return kind === "kill" ? mobDef(target).name : itemDef(target).name;
  }

  // ---------------------------------------------------------------- inventory
  function activateInv(container: "inventory" | "hotbar" | "equip" | "crafting", idx: number): void {
    const g = getGame();
    if (!g) return;
    const slots =
      container === "inventory"
        ? invSlots
        : container === "hotbar"
          ? hotbarSlots
          : container === "crafting"
            ? craftingSlots
            : equipSlots;
    if (moving) {
      g.sendMoveItem(moving.container, moving.slot, container, idx);
      moving = null;
      return;
    }
    const item = slots[idx];
    if (!item) return;
    if (spellIdOf(item)) {
      // A spell already slotted -- rearrange it via the item path (both
      // ends "hotbar", moveItem tolerates the "spell:" marker). Assigning a
      // *new* spell happens from the Spell Book tab instead.
      moving = { container, slot: idx };
      return;
    }
    const def = itemDef(item.itemId);
    if (container !== "crafting" && (def.type === "consumable" || def.type === "tome")) {
      g.sendConsume(container, idx);
    } else if (container !== "crafting" && def.type === "placeable") {
      g.sendPlace(container, idx);
      close();
    } else {
      moving = { container, slot: idx };
    }
  }

  // ---------------------------------------------------------------- spellbook
  function slotSpellId(idx: number): string | null {
    return spellIdOf(hotbarSlots[idx]);
  }
  function pickSpell(spellId: string): void {
    if (isSpellLocked(spellId)) return;
    movingSpell = movingSpell === spellId ? null : spellId;
  }
  function activateHotbarForSpell(idx: number): void {
    const g = getGame();
    if (!g) return;
    if (movingSpell) {
      g.sendAssignSpell(movingSpell, idx);
      movingSpell = null;
      return;
    }
    const existing = slotSpellId(idx);
    if (existing) movingSpell = existing;
  }
  function clearHotbarSpell(idx: number, e?: MouseEvent): void {
    e?.stopPropagation();
    getGame()?.sendAssignSpell(null, idx);
    if (movingSpell && slotSpellId(idx) === movingSpell) movingSpell = null;
  }

  function showTooltip(spellId: string, e: MouseEvent): void {
    hoveredSpell = spellId;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipPos = { x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top };
  }
  function hideTooltip(): void {
    hoveredSpell = null;
  }

  function showItemTooltip(itemId: string, durability: number | null, e: MouseEvent): void {
    hoveredItem = { itemId, durability };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    itemTooltipPos = { x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top };
  }
  function hideItemTooltip(): void {
    hoveredItem = null;
  }

  const STAT_LABELS: Record<string, string> = {
    power: "Power",
    armor: "Armor",
    agility: "Agility",
    vitality: "Vitality",
    maxHp: "Max HP",
    maxMana: "Max Resource",
    critChance: "Crit",
    moveSpeedMult: "Move Speed",
  };
  // critChance/moveSpeedMult are stored as fractions (0.05, 1.1) -- display
  // them as +/- percentage points instead of raw decimals.
  const PERCENT_STAT_KEYS = new Set(["critChance", "moveSpeedMult"]);

  function equippedItemForSlot(slot: GearSlot): ItemSnap | undefined {
    const idx = EQUIP_SLOTS.indexOf(slot);
    return game.inventory.find((i) => i.container === "equip" && i.slot === idx);
  }

  interface ItemTooltipInfo {
    def: ItemDef;
    statDiff: { label: string; current: number; next: number; delta: number; isPercent: boolean }[];
    classWarning: string | null;
    weaponTypeLine: string | null;
    consumableLines: string[];
    toolLines: string[];
  }

  /** Everything the item tooltip needs: for gear, a per-stat diff against
   *  whatever's currently equipped in the same slot (reusing the gearMods
   *  assembly pattern from computedStats above); for consumables/tools,
   *  their flat restore/gather/durability values instead of a diff. */
  function itemTooltipInfo(itemId: string, durability: number | null): ItemTooltipInfo {
    const def = itemDef(itemId);
    const statDiff: ItemTooltipInfo["statDiff"] = [];
    if (def.slot) {
      const current = equippedItemForSlot(def.slot);
      const currentDef = current ? itemDef(current.itemId) : undefined;
      const next = def.statModifiers ?? {};
      const curr = currentDef?.statModifiers ?? {};
      const keys = new Set([...Object.keys(next), ...Object.keys(curr)]);
      for (const key of keys) {
        const n = (next as Record<string, number>)[key] ?? 0;
        const c = (curr as Record<string, number>)[key] ?? 0;
        if (n === 0 && c === 0) continue;
        const isPercent = PERCENT_STAT_KEYS.has(key);
        const scale = isPercent ? 100 : 1;
        statDiff.push({
          label: STAT_LABELS[key] ?? key,
          current: c * scale,
          next: n * scale,
          delta: (n - c) * scale,
          isPercent,
        });
      }
    }
    const classWarning =
      def.requiredClasses && classInfo && !def.requiredClasses.includes(classInfo.id)
        ? `Not ideal for ${classInfo.name} (best for ${def.requiredClasses.map((c) => classDef(c).name).join(", ")})`
        : null;
    const weaponTypeLine = def.weaponType ? `Type: ${weaponTypeLabel(def.weaponType)}` : null;
    const consumableLines: string[] = [];
    if (def.restore) {
      if (def.restore.hp) consumableLines.push(`Restores ${def.restore.hp} HP`);
      if (def.restore.mana) consumableLines.push(`Restores ${def.restore.mana} Resource`);
      if (def.restore.hunger) consumableLines.push(`Restores ${def.restore.hunger} Hunger`);
      if (def.restore.thirst) consumableLines.push(`Restores ${def.restore.thirst} Thirst`);
    }
    if (def.applyAuraOnConsume) consumableLines.push(`Applies ${auraDef(def.applyAuraOnConsume).name}`);
    const toolLines: string[] = [];
    if (def.damage) toolLines.push(`Damage: ${def.damage}`);
    if (def.gatherPower) {
      const gp = Object.entries(def.gatherPower)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      if (gp) toolLines.push(`Gather: ${gp}`);
    }
    if (def.maxDurability) toolLines.push(`Durability: ${durability ?? def.maxDurability}/${def.maxDurability}`);
    return { def, statDiff, classWarning, weaponTypeLine, consumableLines, toolLines };
  }

  function targetLabel(spell: SpellDef): string {
    const t = spell.targeting;
    if (t.kind === "self") return "Self";
    if (t.kind === "melee") return `Melee · ${t.range}m`;
    if (t.kind === "projectile") return `Ranged · ${t.range}m`;
    return `AoE · ${t.radius}m radius`;
  }
  function effectLines(spell: SpellDef): string[] {
    const out: string[] = [];
    for (const e of spell.effects) {
      if (e.type === "damage") {
        let s = `${e.base ?? 0} + ${e.powerScale ?? 0}× Power ${e.damageType ?? ""} damage`.replace(/\s+/g, " ").trim();
        if (e.executeScale) s += ` (up to +${Math.round(e.executeScale * 100)}% vs low HP)`;
        if (e.lifestealPct) s += `, drains ${Math.round(e.lifestealPct * 100)}% as healing`;
        out.push(s);
      } else if (e.type === "heal") {
        out.push(`${e.base ?? 0} + ${e.powerScale ?? 0}× Power healing${e.landsOn === "caster" ? "" : " to allies"}`);
      } else if (e.type === "applyAura" && e.auraId) {
        const aura = auraDef(e.auraId);
        const kind = aura.silences ? "silence" : aura.tick ? (aura.tick.type === "heal" ? "HoT" : "DoT") : aura.statModifiers ? "buff/debuff" : "";
        out.push(`Applies ${aura.name}${kind ? ` (${kind})` : ""} · ${aura.durationS}s`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------- craft
  /** Clears whatever's currently in the grid back to the inventory, then
   *  fills it with exactly this recipe's ingredients -- always a full
   *  clear-and-refill, never a top-up on top of a previously-selected
   *  recipe's leftovers ("no history"), so the grid only ever holds one
   *  recipe's exact ingredients and always matches the one just clicked.
   *
   *  Builds a simulated post-clear inventory (real inventory slots plus
   *  wherever the just-cleared grid items are being sent) instead of
   *  re-reading game.inventory/craftingSlots between the two steps, since
   *  sendMoveItem is a fire-and-forget WS message and the reactive state
   *  won't reflect either move until the server's snapshot round-trips
   *  back -- without this, refilling right after clearing would fail to
   *  see (and reuse) whatever was just freed from the grid. */
  function quickFillRecipe(recipe: RecipeDef): void {
    const g = getGame();
    if (!g) return;

    interface Stack { itemId: string; qty: number; slot: number }
    const simulated: Stack[] = game.inventory
      .filter((it) => it.container === "inventory")
      .map((it) => ({ itemId: it.itemId, qty: it.qty, slot: it.slot }));
    const usedInventorySlots = new Set(simulated.map((s) => s.slot));

    // 1) Clear: send every occupied grid slot back to the inventory --
    // topping off an existing stack of the same item first (so clearing
    // doesn't fragment stackable resources), falling back to a fresh empty
    // slot for whatever's left -- and fold the result into the simulated
    // pool so step 2 can immediately treat it as available.
    for (let i = 0; i < 9; i++) {
      const item = craftingSlots[i];
      if (!item) continue;
      let remaining = item.qty;
      const cap = itemDef(item.itemId).stack;
      for (const stack of simulated) {
        if (remaining <= 0) break;
        if (stack.itemId !== item.itemId || stack.qty >= cap) continue;
        const take = Math.min(cap - stack.qty, remaining);
        g.sendMoveItem("crafting", i, "inventory", stack.slot, take);
        stack.qty += take;
        remaining -= take;
      }
      if (remaining <= 0) continue;
      let targetSlot = -1;
      for (let s = 0; s < INVENTORY_SLOTS; s++) {
        if (!usedInventorySlots.has(s)) {
          targetSlot = s;
          break;
        }
      }
      if (targetSlot === -1) continue; // inventory full; leave it in the grid
      g.sendMoveItem("crafting", i, "inventory", targetSlot, remaining);
      usedInventorySlots.add(targetSlot);
      simulated.push({ itemId: item.itemId, qty: remaining, slot: targetSlot });
    }

    // 2) Refill: pull exactly this recipe's ingredients from the simulated
    // inventory into the now-empty grid, splitting stacks so the grid ends
    // up with precisely the required amount of each -- never more, which
    // would let it also match a different, cheaper recipe by mistake.
    const claimedSlots = new Set<number>();
    let gridSlot = 0;
    for (const ing of recipe.ingredients) {
      let have = 0;
      for (const stack of simulated) {
        if (have >= ing.qty) break;
        if (stack.itemId !== ing.itemId || claimedSlots.has(stack.slot)) continue;
        if (gridSlot >= 9) break;
        claimedSlots.add(stack.slot);
        const needed = ing.qty - have;
        const take = Math.min(needed, stack.qty);
        g.sendMoveItem("inventory", stack.slot, "crafting", gridSlot, take < stack.qty ? take : undefined);
        gridSlot++;
        have += take;
      }
    }
  }

  function activateCraft(idx: number): void {
    const recipe = recipes[idx];
    if (recipe) quickFillRecipe(recipe);
  }

  // ------------------------------------------------------------------ system
  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
  function exitToCharacterSelect(): void {
    app.leaveWorld();
  }
  const systemActions = [toggleFullscreen, exitToCharacterSelect];

  onMount(() => {
    const onChange = () => (isFullscreen = !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  });

  function nav(dx: number, dy: number): void {
    if (game.activeTab === "inventory") {
      const cols = 8;
      const rows = INVENTORY_SLOTS / cols;
      const col = Math.min(cols - 1, Math.max(0, (invCursor % cols) + dx));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(invCursor / cols) + dy));
      invCursor = row * cols + col;
    } else if (game.activeTab === "quests") {
      if (dx < 0) {
        questSubFocus = "track";
      } else if (dx > 0 && game.party && game.party.length > 0) {
        questSubFocus = "share";
      } else if (dy !== 0) {
        questsCursor = Math.min(game.questLog.length - 1, Math.max(0, questsCursor + dy));
      }
    } else if (game.activeTab === "spellbook") {
      if (spellBookFocus === "spells") {
        if (dy > 0 && spellCursor === learnedSpells.length - 1) {
          spellBookFocus = "hotbar";
          spellHotbarCursor = 0;
        } else {
          spellCursor = Math.min(learnedSpells.length - 1, Math.max(0, spellCursor + dy));
        }
      } else if (spellBookFocus === "hotbar") {
        if (dy < 0) {
          spellBookFocus = "spells";
          spellCursor = learnedSpells.length - 1;
        } else {
          spellHotbarCursor = Math.min(9, Math.max(0, spellHotbarCursor + dx));
        }
      }
    } else if (game.activeTab === "craft") {
      if (craftTabFocus === "inventory") {
        const cols = 4;
        const rows = INVENTORY_SLOTS / cols;
        const col = (invCursor % cols);
        const row = Math.floor(invCursor / cols);
        if (dx > 0 && col === cols - 1) {
          craftTabFocus = "grid";
          craftGridCursor = Math.min(2, Math.floor(row / 2.5)) * 3;
        } else {
          const nextCol = Math.min(cols - 1, Math.max(0, col + dx));
          const nextRow = Math.min(rows - 1, Math.max(0, row + dy));
          invCursor = nextRow * cols + nextCol;
        }
      } else if (craftTabFocus === "grid") {
        const cols = 3;
        const rows = 3;
        const col = (craftGridCursor % cols);
        const row = Math.floor(craftGridCursor / cols);
        if (dx < 0 && col === 0) {
          craftTabFocus = "inventory";
          invCursor = Math.min(7, Math.round(row * 3)) * 4 + 3;
        } else if (dx > 0 && col === cols - 1) {
          craftTabFocus = "output";
        } else if (dy > 0 && row === rows - 1) {
          craftTabFocus = "clear";
          clearBtnFocus = 0;
        } else {
          const nextCol = Math.min(cols - 1, Math.max(0, col + dx));
          const nextRow = Math.min(rows - 1, Math.max(0, row + dy));
          craftGridCursor = nextRow * cols + nextCol;
        }
      } else if (craftTabFocus === "output") {
        if (dx < 0) {
          craftTabFocus = "grid";
          craftGridCursor = 5;
        } else if (dy > 0) {
          craftTabFocus = "clear";
          clearBtnFocus = 0;
        }
      } else if (craftTabFocus === "clear") {
        if (dy < 0) {
          craftTabFocus = "grid";
          craftGridCursor = 7;
        } else if (dx !== 0) {
          clearBtnFocus = clearBtnFocus === 0 ? 1 : 0;
        }
      }
    } else if (game.activeTab === "system") {
      if (systemSubFocus === "sidebar") {
        if (dy !== 0) {
          systemSubTabIdx = systemSubTabIdx === 0 ? 1 : 0;
        } else if (dx > 0) {
          systemSubFocus = "content";
          systemCursor = 0;
        }
      } else if (systemSubFocus === "content") {
        if (dx < 0) {
          systemSubFocus = "sidebar";
        } else {
          if (systemTabSub === "game") {
            systemCursor = Math.min(systemActions.length - 1, Math.max(0, systemCursor + dy));
          } else if (systemTabSub === "wiki") {
            if (wikiScrollContainer) {
              wikiScrollContainer.scrollTop += dy * 40;
            }
          }
        }
      }
    }
    // Party tab has no gamepad cursor yet -- mouse/click only for now.
  }

  function confirm(): void {
    if (game.activeTab === "inventory") activateInv("inventory", invCursor);
    else if (game.activeTab === "quests") {
      const q = game.questLog[questsCursor];
      if (q) {
        if (questSubFocus === "track") {
          game.toggleQuestTrack(q.id);
        } else if (questSubFocus === "share") {
          getGame()?.sendShareQuest(q.id);
        }
      }
    } else if (game.activeTab === "spellbook") {
      if (spellBookFocus === "spells") {
        const spellId = learnedSpells[spellCursor];
        if (spellId) pickSpell(spellId);
      } else {
        activateHotbarForSpell(spellHotbarCursor);
      }
    } else if (game.activeTab === "craft") {
      if (craftTabFocus === "inventory") {
        activateInv("inventory", invCursor);
      } else if (craftTabFocus === "grid") {
        activateInv("crafting", craftGridCursor);
      } else if (craftTabFocus === "output") {
        if (matchedRecipe) getGame()?.sendCraft(matchedRecipe.id);
      } else if (craftTabFocus === "clear") {
        if (clearBtnFocus === 0) {
          if (matchedRecipe) getGame()?.sendCraft(matchedRecipe.id);
        } else {
          clearCraftingGrid();
        }
      }
    }
    else if (game.activeTab === "system") {
      if (systemSubFocus === "sidebar") {
        systemSubFocus = "content";
        systemCursor = 0;
      } else {
        if (systemTabSub === "game") {
          systemActions[systemCursor]?.();
        }
      }
    }
  }

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; cancel: boolean; clear?: boolean }>).detail;
      if (d.cancel) {
        if (moving || movingSpell) {
          moving = null;
          movingSpell = null;
        } else close();
        return;
      }
      if (d.clear) {
        if (game.activeTab === "spellbook" && spellBookFocus === "hotbar") {
          clearHotbarSpell(spellHotbarCursor);
        }
      }
      if (d.up) nav(0, -1);
      if (d.down) nav(0, 1);
      if (d.left) nav(-1, 0);
      if (d.right) nav(1, 0);
      if (d.confirm) confirm();
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hintKeys = $derived(
    promptLabel(
      game.activeTab === "spellbook" && spellBookFocus === "hotbar"
        ? "Ⓐ select · Ⓑ close · Ⓧ clear · LB/RB switch tabs · d-pad navigate"
        : "Ⓐ select · Ⓑ close · LB/RB switch tabs · d-pad navigate",
      "Click to select · press again or click ✕ to close",
    ),
  );
</script>

<div class="screen-bg">
  <div class="screen rc-frame">
    <div class="tabs">
      {#each TABS as tab (tab.id)}
        <button class="tab" class:active={game.activeTab === tab.id} onclick={() => selectTab(tab.id)}>
          {tab.label}
        </button>
      {/each}
      <button class="close-btn" onclick={close}>✕</button>
    </div>

    <div class="content">
      {#if game.activeTab === "inventory"}
        <div class="col equip-col">
          <h3>Equipment</h3>
          <div class="equip-list">
            {#each equipSlots as item, i (i)}
              <button
                class="equip-row"
                class:cursor={equipCursor === i}
                class:moving={moving?.container === "equip" && moving.slot === i}
                onclick={() => {
                  equipCursor = i;
                  activateInv("equip", i);
                }}
                onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                onmouseleave={hideItemTooltip}
              >
                <span class="equip-label">{EQUIP_LABELS[EQUIP_SLOTS[i]!]}</span>
                <span class="equip-value">
                  {#if item}
                    <IconGlyph value={itemIcon(item.itemId)} size={20} itemId={item.itemId} />
                    {itemDef(item.itemId).name}
                  {:else}
                    Empty
                  {/if}
                </span>
              </button>
            {/each}
          </div>
          <div class="char-info">
            <div class="char-level-class">Level {game.self?.level ?? 1} · {classInfo?.name ?? "Adventurer"}</div>
            <div class="char-vitals">
              <div>HP: {Math.round(game.self?.hp ?? 0)}/{Math.round(game.self?.maxHp ?? 0)}</div>
              <div>{classInfo?.resourceLabel ?? "Mana"}: {Math.round(game.self?.mana ?? 0)}/{Math.round(game.self?.maxMana ?? 0)}</div>
            </div>
            {#if computedStats}
              <div class="stats-grid">
                <div class="stat-item"><span class="stat-name">Power:</span> <span class="stat-val">{Math.round(computedStats.power)}</span></div>
                <div class="stat-item"><span class="stat-name">Agility:</span> <span class="stat-val">{Math.round(computedStats.agility)}</span></div>
                <div class="stat-item"><span class="stat-name">Vitality:</span> <span class="stat-val">{Math.round(computedStats.vitality)}</span></div>
                <div class="stat-item"><span class="stat-name">Armor:</span> <span class="stat-val">{Math.round(computedStats.armor)}</span></div>
                <div class="stat-item"><span class="stat-name">Crit:</span> <span class="stat-val">{Math.round(computedStats.critChance * 100)}%</span></div>
                <div class="stat-item"><span class="stat-name">Speed:</span> <span class="stat-val">x{computedStats.moveSpeedMult.toFixed(2)}</span></div>
              </div>
            {/if}
          </div>
        </div>
        <div class="col backpack-col">
          <h3>Backpack</h3>
          <div class="grid">
            {#each invSlots as item, i (i)}
              <button
                class="cell"
                class:cursor={invCursor === i}
                class:moving={moving?.container === "inventory" && moving.slot === i}
                onclick={() => {
                  invCursor = i;
                  activateInv("inventory", i);
                }}
                onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                onmouseleave={hideItemTooltip}
              >
                {#if item}
                  <IconGlyph value={itemIcon(item.itemId)} itemId={item.itemId} />
                  {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                {/if}
              </button>
            {/each}
          </div>
          <h3>Hotbar</h3>
          <div class="hotbar-row">
            {#each hotbarSlots as item, i (i)}
              {@const spellId = spellIdOf(item)}
              <button
                class="cell small"
                class:first={i === 6}
                class:moving={moving?.container === "hotbar" && moving.slot === i}
                onclick={() => activateInv("hotbar", i)}
                onmouseenter={(e) => !spellId && item && showItemTooltip(item.itemId, item.durability, e)}
                onmouseleave={hideItemTooltip}
              >
                {#if spellId}
                  <IconGlyph value={spellIcon(spellId)} size={20} />
                {:else if item}
                  <IconGlyph value={itemIcon(item.itemId)} size={20} itemId={item.itemId} />
                  {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                {/if}
                <span class="num">{keyLabel(i)}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if game.activeTab === "quests"}
        <div class="quests-tab">
          <h3>Active Quests</h3>
          <div class="quest-list">
            {#each game.questLog as q, i (q.id)}
              <div
                class="quest-row"
                class:row-active={questsCursor === i}
              >
                <!-- Tracking toggle -->
                <button
                  class="quest-row-main"
                  class:sub-cursor={questsCursor === i && questSubFocus === "track"}
                  onclick={() => {
                    questsCursor = i;
                    questSubFocus = "track";
                    game.toggleQuestTrack(q.id);
                  }}
                >
                  <div class="quest-row-title">
                    <span class="quest-row-check">{game.untrackedQuests.has(q.id) ? "☐" : "☑"}</span>
                    <span class="quest-row-name" class:done={q.status === "complete"}>{q.name}</span>
                    <span class="quest-row-status" class:done={q.status === "complete"}>
                      {q.status === "complete" ? "Complete" : "In Progress"}
                    </span>
                  </div>
                  <div class="quest-row-desc">
                    {objectiveText(q.objectiveKind, q.objectiveTarget)}
                    <span class="quest-row-count">({q.progress}/{q.objectiveCount})</span>
                  </div>
                </button>

                <!-- Actions -->
                <div class="quest-row-actions">
                  {#if game.party && game.party.length > 0}
                    <button
                      class="rc-btn share-btn"
                      class:selected={questsCursor === i && questSubFocus === "share"}
                      disabled={q.status === "complete"}
                      onclick={() => {
                        questsCursor = i;
                        questSubFocus = "share";
                        getGame()?.sendShareQuest(q.id);
                      }}
                    >
                      Share
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="empty-quests">No active quests. Visit NPCs in towns to accept tasks.</div>
            {/each}
          </div>
        </div>
      {:else if game.activeTab === "spellbook"}
        <div class="spellbook-tab">
          <h3>Known Spells</h3>
          <div class="spell-list">
            {#each spellsToShow as spellId, i (spellId)}
              {@const spell = spellDef(spellId)}
              {@const locked = isSpellLocked(spellId)}
              <button
                bind:this={spellElements[i]}
                class="spell-row"
                class:cursor={spellBookFocus === "spells" && spellCursor === i}
                class:moving={movingSpell === spellId}
                class:locked={locked}
                disabled={locked}
                onmouseenter={(e) => showTooltip(spellId, e)}
                onmouseleave={hideTooltip}
                onclick={() => {
                  spellBookFocus = "spells";
                  spellCursor = i;
                  pickSpell(spellId);
                }}
              >
                <IconGlyph value={spellIcon(spellId)} size={26} />
                <span class="name">{spell.name}</span>
                {#if locked}
                  <span class="lock-req">{spellLockReason(spellId)} 🔒</span>
                {/if}
              </button>
            {/each}
          </div>
          <h3>Hotbar</h3>
          <div class="hotbar-row roomy">
            {#each hotbarSlots as item, i (i)}
              {@const spellId = slotSpellId(i)}
              <button
                bind:this={hotbarElements[i]}
                class="cell big"
                class:spell={spellId !== null}
                class:moving={spellId !== null && movingSpell === spellId}
                class:cursor={spellBookFocus === "hotbar" && spellHotbarCursor === i}
                class:first={i === 6}
                onclick={() => {
                  spellBookFocus = "hotbar";
                  spellHotbarCursor = i;
                  activateHotbarForSpell(i);
                }}
              >
                {#if spellId}
                  <IconGlyph value={spellIcon(spellId)} size={28} />
                  <span class="clear" onclick={(e) => clearHotbarSpell(i, e)}>✕</span>
                {:else if item}
                  <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
                {/if}
                <span class="num">{keyLabel(i)}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if game.activeTab === "craft"}
        <div class="craft-container">
          <!-- Left: Backpack -->
          <div class="col backpack-col">
            <h3>Backpack</h3>
            <div class="grid">
              {#each invSlots as item, i (i)}
                <button
                  class="cell"
                  class:cursor={craftTabFocus === "inventory" && invCursor === i}
                  class:moving={moving?.container === "inventory" && moving.slot === i}
                  onclick={() => {
                    craftTabFocus = "inventory";
                    invCursor = i;
                    activateInv("inventory", i);
                  }}
                  onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                  onmouseleave={hideItemTooltip}
                >
                  {#if item}
                    <IconGlyph value={itemIcon(item.itemId)} itemId={item.itemId} />
                    {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <!-- Middle: Crafting Area -->
          <div class="col crafting-area-col">
            <h3>Crafting Grid</h3>
            <div class="crafting-area-main">
              <!-- 3x3 Grid -->
              <div class="crafting-grid">
                {#each Array.from({ length: 9 }) as _, i}
                  {@const item = craftingSlots[i]}
                  <button
                    class="cell big"
                    class:cursor={craftTabFocus === "grid" && craftGridCursor === i}
                    class:moving={moving?.container === "crafting" && moving.slot === i}
                    onclick={() => {
                      craftTabFocus = "grid";
                      craftGridCursor = i;
                      activateInv("crafting", i);
                    }}
                    onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                    onmouseleave={hideItemTooltip}
                  >
                    {#if item}
                      <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
                      {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                    {/if}
                  </button>
                {/each}
              </div>

              <!-- Arrow -->
              <div class="crafting-arrow">➜</div>

              <!-- Output Slot -->
              <div class="crafting-output-container">
                <button
                  class="cell big output-cell"
                  class:cursor={craftTabFocus === "output"}
                  class:has-item={matchedRecipe !== null}
                  onclick={() => {
                    craftTabFocus = "output";
                    if (matchedRecipe) {
                      getGame()?.sendCraft(matchedRecipe.id);
                    }
                  }}
                  onmouseenter={(e) => matchedRecipe && showItemTooltip(matchedRecipe.output, null, e)}
                  onmouseleave={hideItemTooltip}
                >
                  {#if matchedRecipe}
                    <IconGlyph value={itemIcon(matchedRecipe.output)} size={28} itemId={matchedRecipe.output} />
                    {#if matchedRecipe.outputQty > 1}
                      <span class="qty">{matchedRecipe.outputQty}</span>
                    {/if}
                  {/if}
                </button>
                <div class="output-label">
                  {matchedRecipe ? itemDef(matchedRecipe.output).name : "Empty"}
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="crafting-actions">
              <button
                class="rc-btn primary craft-btn"
                class:selected={craftTabFocus === "clear" && clearBtnFocus === 0}
                disabled={matchedRecipe === null}
                onclick={() => {
                  craftTabFocus = "clear";
                  clearBtnFocus = 0;
                  if (matchedRecipe) getGame()?.sendCraft(matchedRecipe.id);
                }}
              >
                Craft
              </button>
              <button
                class="rc-btn ghost clear-btn"
                class:selected={craftTabFocus === "clear" && clearBtnFocus === 1}
                disabled={craftingSlots.filter(it => it !== undefined).length === 0}
                onclick={() => {
                  craftTabFocus = "clear";
                  clearBtnFocus = 1;
                  clearCraftingGrid();
                }}
              >
                Clear Grid
              </button>
            </div>
          </div>

          <!-- Right: Recipe Book -->
          <div class="col recipe-book-col">
            <h3>Recipe Book</h3>
            <div class="recipes-list">
              {#each recipes as recipe, idx}
                {@const outputDef = itemDef(recipe.output)}
                <button
                  type="button"
                  class="recipe-entry"
                  class:selected={craftTabFocus === "recipes" && craftCursor === idx}
                  class:matched={matchedRecipe?.id === recipe.id}
                  class:unaffordable={!canCraft(recipe.id)}
                  onclick={() => {
                    craftTabFocus = "recipes";
                    craftCursor = idx;
                    quickFillRecipe(recipe);
                  }}
                  onmouseenter={(e) => showItemTooltip(recipe.output, null, e)}
                  onmouseleave={hideItemTooltip}
                >
                  <div class="recipe-header">
                    <span class="recipe-icon"><IconGlyph value={itemIcon(recipe.output)} size={16} itemId={recipe.output} /></span>
                    <span class="recipe-name">{outputDef.name}</span>
                    {#if recipe.station}
                      <span class="recipe-station">🏕️</span>
                    {/if}
                  </div>
                  <div class="recipe-ingredients">
                    {#each recipe.ingredients as ing}
                      <span class="recipe-ing">
                        {itemDef(ing.itemId).name} x{ing.qty}
                      </span>
                    {/each}
                  </div>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {:else if game.activeTab === "party"}
        <div class="col party-tab-col">
          <h3>Your Party</h3>
          {#if game.pendingInvite}
            <div class="pending-invite-box rc-frame">
              <div class="pending-invite-text">
                <strong>{game.pendingInvite}</strong> invites you to a party
              </div>
              <div class="pending-invite-actions">
                <button class="rc-btn primary" onclick={() => getGame()?.sendParty("accept")}>Accept</button>
                <button class="rc-btn ghost" onclick={() => getGame()?.sendParty("decline")}>Decline</button>
              </div>
            </div>
          {:else if game.party && game.party.length > 0}
            <div class="party-list">
              {#each game.party as member (member.id)}
                <div class="party-member" class:offline={!member.online}>
                  <span class="pm-name">
                    {#if member.leader}<span class="crown" title="Party leader">👑</span>{/if}
                    {member.name} <span class="lvl">lv{member.level}</span>
                  </span>
                  <div class="pm-bar">
                    <div class="pm-fill" style="width: {Math.min(100, (member.hp / member.maxHp) * 100)}%"></div>
                  </div>
                </div>
              {/each}
            </div>
            {#if amLeader}
              <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("disband")}>Disband Party</button>
            {:else}
              <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("leave")}>Leave Party</button>
            {/if}
          {:else}
            <div class="empty-note">You're not in a party yet.</div>
          {/if}
        </div>
        <div class="col roster-col">
          <h3>Online Players</h3>
          <div class="roster-list">
            {#each invitablePlayers as p (p.id)}
              <div class="roster-row">
                <span class="roster-name">{p.name} <span class="lvl">lv{p.level}</span></span>
                <button class="rc-btn invite-btn" onclick={() => getGame()?.sendParty("invite", p.name)}>Invite</button>
              </div>
            {/each}
            {#if invitablePlayers.length === 0}
              <div class="empty-note">No other players online right now.</div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="system-menu-container">
          <!-- Sidebar sub-navigation -->
          <div class="system-sidebar">
            <button
              class="sub-tab-btn"
              class:active={systemTabSub === "game"}
              class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 0}
              onclick={() => {
                systemSubTabIdx = 0;
                systemSubFocus = "sidebar";
              }}
            >
              Game Options
            </button>
            <button
              class="sub-tab-btn"
              class:active={systemTabSub === "wiki"}
              class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 1}
              onclick={() => {
                systemSubTabIdx = 1;
                systemSubFocus = "sidebar";
              }}
            >
              Wiki Guide
            </button>
          </div>

          <!-- Content display area -->
          <div class="system-content-panel">
            {#if systemTabSub === "game"}
              <div class="col system-col">
                <h3>Game Options</h3>
                <button
                  class="rc-btn"
                  class:selected={systemSubFocus === "content" && systemCursor === 0}
                  onclick={toggleFullscreen}
                >
                  {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                </button>
                <button
                  class="rc-btn ghost"
                  class:selected={systemSubFocus === "content" && systemCursor === 1}
                  onclick={exitToCharacterSelect}
                >
                  Exit to Character Select
                </button>
              </div>
            {:else if systemTabSub === "wiki"}
              <div class="wiki-panel">
                <h3>Game Wiki Guide</h3>
                <div class="wiki-scrollable" bind:this={wikiScrollContainer}>
                  {#each wikiParsed as item}
                    {#if item.type === "h1"}
                      <h1 class="wiki-h1">{item.text}</h1>
                    {:else if item.type === "h2"}
                      <h2 class="wiki-h2">{item.text}</h2>
                    {:else if item.type === "h3"}
                      <h3 class="wiki-h3">{item.text}</h3>
                    {:else if item.type === "li"}
                      <li class="wiki-li">{@html formatBoldText(item.text)}</li>
                    {:else if item.type === "p"}
                      <p class="wiki-p">{@html formatBoldText(item.text)}</p>
                    {:else if item.type === "hr"}
                      <hr class="wiki-hr" />
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <div class="hints">{hintKeys}</div>
  </div>
  {#if hoveredSpell}
    {@const spell = spellDef(hoveredSpell)}
    <div class="floating-tooltip" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;">
      <div class="tt-title">{spell.name}</div>
      <div class="tt-stats">
        <span>Cast: {spell.castTimeS > 0 ? `${spell.castTimeS}s` : "Instant"}</span>
        <span>Cost: {spell.resourceCost}</span>
        <span>Cooldown: {spell.cooldownS}s</span>
        <span>{targetLabel(spell)}</span>
      </div>
      {#if spell.allowedWeaponTypes}
        <div class="tt-weapon-req" class:tt-weapon-unmet={!equippedWeaponType || !spell.allowedWeaponTypes.includes(equippedWeaponType)}>
          Requires: {spell.allowedWeaponTypes.map(weaponTypeLabel).join(", ")}
        </div>
      {/if}
      <div class="tt-effects">
        {#each effectLines(spell) as line (line)}
          <div class="tt-effect">{line}</div>
        {/each}
      </div>
    </div>
  {/if}
  {#if hoveredItem}
    {@const info = itemTooltipInfo(hoveredItem.itemId, hoveredItem.durability)}
    <div class="floating-tooltip" style="left: {itemTooltipPos.x}px; top: {itemTooltipPos.y}px;">
      <div class="tt-title">{info.def.name}</div>
      {#if info.weaponTypeLine}
        <div class="tt-weapon-req">{info.weaponTypeLine}</div>
      {/if}
      {#if info.classWarning}
        <div class="tt-weapon-req tt-weapon-unmet">{info.classWarning}</div>
      {/if}
      {#if info.statDiff.length > 0}
        <div class="tt-effects">
          {#each info.statDiff as line (line.label)}
            <div class="tt-effect">
              {line.label}: {line.current}{line.isPercent ? "%" : ""} → {line.next}{line.isPercent ? "%" : ""}
              <span class:tt-delta-pos={line.delta > 0} class:tt-delta-neg={line.delta < 0}>
                ({line.delta > 0 ? "+" : ""}{line.delta}{line.isPercent ? "%" : ""})
              </span>
            </div>
          {/each}
        </div>
      {/if}
      {#if info.consumableLines.length > 0}
        <div class="tt-effects">
          {#each info.consumableLines as line (line)}
            <div class="tt-effect">{line}</div>
          {/each}
        </div>
      {/if}
      {#if info.toolLines.length > 0}
        <div class="tt-effects">
          {#each info.toolLines as line (line)}
            <div class="tt-effect">{line}</div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .screen-bg {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .screen {
    display: flex;
    flex-direction: column;
    width: min(920px, 92vw);
    height: min(600px, 86vh);
    padding: 0;
  }
  .tabs {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--rc-gold-dim);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 5px 5px 0 0;
    overflow: hidden;
  }
  .tab {
    background: none;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    color: #9fb0c4;
    font-family: var(--rc-display);
    font-size: 13px;
    letter-spacing: 1px;
    padding: 12px 22px;
    cursor: pointer;
  }
  .tab.active {
    color: var(--rc-gold-bright);
    background: rgba(255, 214, 110, 0.08);
    box-shadow: inset 0 -2px 0 var(--rc-gold-bright);
  }
  .tab:hover {
    color: #fff;
  }
  .close-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: #9fb0c4;
    font-size: 15px;
    cursor: pointer;
    padding: 10px 18px;
  }
  .close-btn:hover {
    color: #fff;
  }
  .content {
    flex: 1;
    display: flex;
    gap: 24px;
    padding: 20px 26px;
    min-height: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-family: var(--rc-display);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
  /* ---- Inventory tab ---- */
  .equip-col {
    width: 260px;
  }
  .equip-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .equip-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    color: #dce6f2;
    text-align: left;
  }
  .equip-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6b7686;
  }
  .equip-value {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .char-info {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 12.5px;
    color: #b9c6d6;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .char-level-class {
    font-weight: bold;
    color: var(--rc-gold-bright, #ffe9a8);
    font-family: var(--rc-display, serif);
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .char-vitals {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    opacity: 0.95;
    margin-bottom: 6px;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
    padding-bottom: 6px;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 10px;
    background: rgba(0, 0, 0, 0.15);
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .stat-item {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }
  .stat-name {
    color: rgba(255, 255, 255, 0.5);
  }
  .stat-val {
    font-weight: 500;
    color: var(--rc-parchment, #e3d2b7);
  }
  .backpack-col {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 46px);
    gap: 5px;
    overflow-y: auto;
  }
  .hotbar-row {
    display: flex;
    gap: 5px;
    margin-top: 8px;
  }
  .cell {
    position: relative;
    width: 46px;
    height: 46px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .cell.small {
    width: 42px;
    height: 42px;
  }
  .cell.first {
    margin-left: 10px;
  }
  .cell.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .cell.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .cell.spell {
    border-color: rgba(200, 120, 255, 0.55);
  }
  .qty {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .num {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 9px;
    font-family: var(--rc-display);
    font-weight: 700;
    color: var(--rc-gold);
    text-shadow: 0 1px 2px #000;
  }
  /* ---- Spellbook tab ---- */
  .spellbook-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .spell-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
    flex: 1;
  }
  .spell-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    color: #dce6f2;
    text-align: left;
  }
  .spell-row.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .spell-row.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .spell-row .name {
    font-size: 13px;
    font-weight: 600;
  }
  .spell-row.locked {
    opacity: 0.5;
    filter: grayscale(80%);
    cursor: not-allowed !important;
  }
  .lock-req {
    margin-left: auto;
    font-size: 11px;
    font-weight: bold;
    color: var(--rc-gold-dim);
  }
  /* Floating tooltip -- fixed-position (viewport coordinates set inline via
     JS from the hovered row's own rect), so it renders above absolutely
     everything with no ancestor scroll/overflow container able to clip it. */
  .floating-tooltip {
    position: fixed;
    z-index: 9999;
    width: 260px;
    background: rgba(10, 12, 18, 0.97);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    text-align: left;
    pointer-events: none;
  }
  .tt-title {
    font-family: var(--rc-display);
    font-size: 13px;
    color: var(--rc-gold-bright);
    margin-bottom: 6px;
  }
  .tt-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    font-size: 11px;
    color: #9fb0c4;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .tt-weapon-req {
    font-size: 11px;
    color: #9fd0a8;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .tt-weapon-req.tt-weapon-unmet {
    color: #e08a8a;
  }
  .tt-effects {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tt-effect {
    font-size: 11.5px;
    color: #dce6f2;
    line-height: 1.35;
  }
  .tt-delta-pos {
    color: #7bd88f;
  }
  .tt-delta-neg {
    color: #e08a8a;
  }
  .clear {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #ffb0b0;
    font-size: 9px;
    line-height: 13px;
    text-align: center;
    cursor: pointer;
  }
  .clear:hover {
    background: #a33;
    color: #fff;
  }
  .hotbar-row.roomy {
    gap: 8px;
    margin-top: 4px;
  }
  .cell.big {
    width: 52px;
    height: 52px;
  }
  .cell.big.first {
    margin-left: 16px;
  }
  /* ---- Party tab ---- */
  .party-tab-col {
    width: 260px;
  }
  .pending-invite-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 2px dashed rgba(201, 162, 75, 0.3);
    border-radius: 6px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .pending-invite-text {
    font-size: 13px;
    color: var(--rc-parchment);
    line-height: 1.5;
  }
  .pending-invite-text strong {
    color: var(--rc-gold-bright);
  }
  .pending-invite-actions {
    display: flex;
    gap: 8px;
  }
  .pending-invite-actions .rc-btn {
    padding: 6px 12px;
    font-size: 12.5px;
    flex: 1;
  }
  .party-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .party-member {
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
  }
  .party-member.offline {
    opacity: 0.45;
  }
  .pm-name {
    display: block;
    font-size: 13px;
    color: #dce6f2;
    margin-bottom: 5px;
  }
  .crown {
    font-size: 11px;
    margin-right: 2px;
  }
  .pm-bar {
    height: 8px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 3px;
    overflow: hidden;
  }
  .pm-fill {
    height: 100%;
    background: linear-gradient(180deg, #5ec46a, #2e8a3a);
    transition: width 0.3s ease-out;
  }
  .leave-btn {
    margin-top: 4px;
    padding: 8px 12px;
    font-size: 12px;
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
  }
  .roster-col {
    flex: 1;
  }
  .roster-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
  }
  .roster-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    color: #dce6f2;
  }
  .roster-name {
    font-size: 13px;
  }
  .invite-btn {
    padding: 5px 12px;
    font-size: 11px;
  }
  .lvl {
    color: var(--rc-ink-dim);
    font-size: 10px;
  }
  .empty-note {
    color: #6b7686;
    font-size: 12.5px;
    font-style: italic;
  }
  /* ---- Quests tab ---- */
  .quests-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .quest-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    padding-right: 4px;
  }
  .quest-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px 12px;
    color: #dce6f2;
    transition: background-color 0.2s, border-color 0.2s;
  }
  .quest-row.row-active {
    background: rgba(255, 255, 255, 0.07);
  }
  .quest-row-main {
    background: none;
    border: none;
    padding: 6px 8px;
    margin: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    flex: 1;
    border-radius: 4px;
    transition: background-color 0.2s;
  }
  .quest-row-main:hover, .quest-row-main.sub-cursor {
    background: rgba(255, 255, 255, 0.06);
  }
  .quest-row-main:hover .quest-row-check,
  .quest-row-main.sub-cursor .quest-row-check {
    color: var(--rc-gold-bright);
    text-shadow: 0 0 8px rgba(255, 214, 110, 0.6);
  }
  .quest-row-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .share-btn {
    padding: 5px 10px;
    font-size: 11px;
    font-family: var(--rc-display);
    font-weight: 700;
  }
  .quest-row-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .quest-row-check {
    font-size: 16px;
    color: var(--rc-gold);
    line-height: 1;
  }
  .quest-row-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--rc-parchment);
  }
  .quest-row-name.done {
    color: #8fd48f;
    text-decoration: line-through;
    opacity: 0.8;
  }
  .quest-row-desc {
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
  .quest-row-count {
    color: var(--rc-gold);
    font-weight: 700;
    margin-left: 4px;
  }
  .quest-row-status {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--rc-gold);
    background: rgba(201, 162, 75, 0.12);
    border: 1px solid rgba(201, 162, 75, 0.25);
    padding: 3px 8px;
    border-radius: 4px;
  }
  .quest-row-status.done {
    color: #8fd48f;
    background: rgba(143, 212, 143, 0.12);
    border-color: rgba(143, 212, 143, 0.25);
  }
  .empty-quests {
    font-size: 13px;
    color: var(--rc-ink-dim);
    text-align: center;
    padding: 40px 20px;
    font-style: italic;
  }

  /* ---- Crafting Board ---- */
  .craft-container {
    display: flex;
    gap: 20px;
    flex: 1;
    min-height: 0;
  }
  .craft-container .grid {
    grid-template-columns: repeat(4, 46px);
  }
  .crafting-area-col {
    flex: 1.2;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .crafting-area-main {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    margin-top: 15px;
    margin-bottom: 20px;
  }
  .crafting-grid {
    display: grid;
    grid-template-columns: repeat(3, 52px);
    gap: 6px;
  }
  .crafting-arrow {
    font-size: 24px;
    color: var(--rc-gold-dim);
    text-shadow: 0 1px 3px #000;
  }
  .crafting-output-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 90px;
  }
  .output-cell {
    border-color: var(--rc-gold-dim) !important;
    background: rgba(201, 162, 75, 0.05) !important;
    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5) !important;
  }
  .output-cell.has-item {
    border-color: var(--rc-gold-bright) !important;
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.25) !important;
  }
  .output-label {
    font-size: 11px;
    color: var(--rc-ink-dim);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .crafting-actions {
    display: flex;
    gap: 10px;
    width: 100%;
    justify-content: center;
    margin-top: auto;
    padding-bottom: 10px;
  }
  .crafting-actions .rc-btn {
    flex: 1;
    max-width: 130px;
  }
  .recipe-book-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .recipes-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    padding-right: 4px;
  }
  .recipe-entry {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 8px 10px;
    transition: background 0.12s, border-color 0.12s;
  }
  .recipe-entry:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .recipe-entry.selected {
    border-color: var(--rc-gold);
  }
  .recipe-entry.matched {
    background: rgba(120, 200, 140, 0.1);
    border-color: rgba(120, 200, 140, 0.5);
  }
  .recipe-entry.unaffordable {
    opacity: 0.55;
  }
  .recipe-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .recipe-icon {
    display: inline-flex;
    vertical-align: middle;
  }
  .recipe-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12.5px;
    color: var(--rc-parchment);
  }
  .recipe-station {
    font-size: 10px;
    margin-left: auto;
    opacity: 0.8;
  }
  .recipe-ingredients {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 10.5px;
    color: var(--rc-ink-dim);
  }
  .recipe-ing {
    background: rgba(0, 0, 0, 0.2);
    padding: 1px 5px;
    border-radius: 4px;
  }

  /* ---- System tab ---- */
  .system-menu-container {
    display: flex;
    gap: 20px;
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  .system-sidebar {
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    padding-right: 20px;
  }
  .sub-tab-btn {
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid rgba(255, 255, 255, 0.08);
    color: var(--rc-ink-dim);
    padding: 10px 14px;
    border-radius: 6px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  }
  .sub-tab-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--rc-parchment);
  }
  .sub-tab-btn.active {
    background: rgba(201, 162, 75, 0.08);
    border-color: var(--rc-gold-dim);
    color: var(--rc-gold-bright);
  }
  .sub-tab-btn.cursor {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.25);
  }
  .system-content-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .system-col {
    width: 280px;
    gap: 10px;
  }
  .wiki-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding-right: 10px;
  }
  .wiki-panel h3 {
    margin-bottom: 12px;
  }
  .wiki-scrollable {
    flex: 1;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 15px;
    font-size: 12.5px;
    line-height: 1.6;
    color: #cbd5e1;
  }
  .wiki-h1 {
    font-family: var(--rc-display);
    font-size: 18px;
    color: var(--rc-gold-bright);
    margin-top: 0;
    margin-bottom: 12px;
    border-bottom: 1px dashed rgba(201, 162, 75, 0.2);
    padding-bottom: 6px;
  }
  .wiki-h2 {
    font-family: var(--rc-display);
    font-size: 15px;
    color: var(--rc-parchment);
    margin-top: 18px;
    margin-bottom: 8px;
  }
  .wiki-h3 {
    font-family: var(--rc-display);
    font-size: 13.5px;
    color: var(--rc-gold-dim);
    margin-top: 12px;
    margin-bottom: 6px;
  }
  .wiki-p {
    margin-top: 0;
    margin-bottom: 10px;
  }
  .wiki-p :global(strong), .wiki-li :global(strong) {
    color: var(--rc-parchment);
  }
  .wiki-li {
    margin-left: 15px;
    margin-bottom: 6px;
    list-style-type: square;
  }
  .wiki-hr {
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 15px 0;
  }
  .rc-btn {
    padding: 11px 14px;
    font-size: 14px;
  }
  .rc-btn.ghost {
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
  }
  .rc-btn.selected {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.35);
  }
  .hints {
    padding: 10px 26px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    color: #9fb0c4;
    text-shadow: 0 1px 3px #000;
  }
</style>
