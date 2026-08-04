<script lang="ts">
  import { onMount } from "svelte";
  import { game, parseCoins, type CharacterTab } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon, spellIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import { wikiMarkdown } from "./wikiContent";
  import { sound } from "../game/sound";
  import { music } from "../game/music";
  import { ClassPreviewScene } from "../render/ClassPreviewScene";

  const KBM_LABELS = ["1", "2", "3", "4", "5", "6", "Q", "Z", "X", "C"];
  const PAD_LABELS = ["LB+A", "LB+B", "LB+X", "LB+Y", "LB+↑", "LB+↓", "LB+←", "LB+→", "RB+A", "RB+B"];

  function keyLabel(i: number): string {
    return promptLabel(PAD_LABELS[i] ?? "", KBM_LABELS[i] ?? "");
  }
  let friendInputName = $state("");
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
    GRAPHICS_PRESET_IDS,
    GRAPHICS_PRESET_LABELS,
    streamRingMeters,
    type ItemSnap,
    type ItemDef,
    type GearSlot,
    type SpellDef,
    type StatModifiers,
    type RecipeDef,
    type ClassId,
    type GraphicsPresetId,
    type ShadowMapSize,
  } from "@rustcraft/shared";

  const SPELL_PREFIX = "spell:";
  function spellIdOf(item: ItemSnap | undefined): string | null {
    return item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
  }

  const TABS: { id: CharacterTab; label: string }[] = [
    { id: "inventory", label: "Inventory" },
    { id: "quests", label: "Quests" },
    { id: "achievements", label: "Achievements" },
    { id: "spellbook", label: "Spell Book" },
    { id: "craft", label: "Crafting" },
    { id: "party", label: "Party" },
    { id: "social", label: "Social & Friends" },
    { id: "system", label: "System" },
  ];
  const EQUIP_LABELS: Record<GearSlot, string> = {
    weapon: "Weapon",
    head: "Head",
    neck: "Neck",
    shoulders: "Shoulders",
    chest: "Chest",
    arms: "Hands",
    legs: "Legs",
    feet: "Feet",
  };
  /** WoW-style paperdoll columns (visual order; indices still come from EQUIP_SLOTS). */
  const PAPERDOLL_LEFT: GearSlot[] = ["head", "neck", "chest", "arms", "legs"];
  const PAPERDOLL_RIGHT: GearSlot[] = ["shoulders", "weapon", "feet"];
  const recipes = Object.values(RECIPES);

  let paperdollCanvas = $state<HTMLCanvasElement | null>(null);
  let paperdollScene: ClassPreviewScene | null = null;

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
  let systemSubTabIdx = $state(0); // 0 = settings, 1 = graphics, 2 = wiki
  const systemTabSub = $derived(
    systemSubTabIdx === 0 ? "game" : systemSubTabIdx === 1 ? "graphics" : "wiki",
  );
  let systemSubFocus = $state<"sidebar" | "content">("sidebar");
  let wikiScrollContainer = $state<HTMLDivElement | null>(null);
  let graphicsScrollContainer = $state<HTMLDivElement | null>(null);

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
  /** Right-click item context menu (Equip / Unequip / Use). */
  let itemContextMenu = $state<{
    x: number;
    y: number;
    container: "inventory" | "hotbar" | "equip";
    slot: number;
    itemId: string;
  } | null>(null);

  $effect(() => {
    const _tab = game.activeTab;
    moving = null;
    movingSpell = null;
    itemContextMenu = null;
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

  onMount(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!itemContextMenu) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".item-context-menu")) return;
      closeItemContextMenu();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
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
  const paperdollEquip = $derived.by(() => {
    const equip: Partial<Record<string, string>> = {};
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const item = equipSlots[i];
      if (item) equip[EQUIP_SLOTS[i]!] = item.itemId;
    }
    return equip;
  });
  const learnedSpells = $derived(game.learnedSpells);

  $effect(() => {
    const canvas = paperdollCanvas;
    const tab = game.activeTab;
    if (!canvas || tab !== "inventory") {
      paperdollScene?.dispose();
      paperdollScene = null;
      return;
    }
    if (!paperdollScene) {
      paperdollScene = new ClassPreviewScene(canvas, {
        pedestal: false,
        motes: false,
        spotlight: false,
      });
    }
    const classId = (game.classId || "warrior") as ClassId;
    paperdollScene.setClass(classId, game.gender, game.appearance, paperdollEquip);
    paperdollScene.resize();
  });

  onMount(() => {
    const onResize = () => paperdollScene?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      paperdollScene?.dispose();
      paperdollScene = null;
    };
  });

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
  function objectiveText(kind: string, target: string): string {
    if (kind === "escort") return "Escort NPC";
    try {
      return kind === "kill" ? mobDef(target).name : itemDef(target).name;
    } catch {
      return target;
    }
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

  function closeItemContextMenu(): void {
    itemContextMenu = null;
  }

  function openItemContextMenu(
    container: "inventory" | "hotbar" | "equip",
    slot: number,
    itemId: string,
    e: MouseEvent,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    moving = null;
    hideItemTooltip();
    const menuW = 160;
    const menuH = 120;
    itemContextMenu = {
      x: Math.min(e.clientX, window.innerWidth - menuW - 8),
      y: Math.min(e.clientY, window.innerHeight - menuH - 8),
      container,
      slot,
      itemId,
    };
  }

  function firstEmptyInventorySlot(): number {
    return invSlots.findIndex((s) => !s);
  }

  function contextMenuActions(menu: NonNullable<typeof itemContextMenu>): { id: string; label: string }[] {
    const def = itemDef(menu.itemId);
    const actions: { id: string; label: string }[] = [];
    if (menu.container === "equip") {
      actions.push({ id: "unequip", label: "Unequip" });
    } else if (def.slot && EQUIP_SLOTS.includes(def.slot)) {
      actions.push({ id: "equip", label: "Equip" });
    }
    if (def.type === "consumable" || def.type === "tome") {
      actions.push({ id: "use", label: def.type === "tome" ? "Learn" : "Use" });
    }
    if (def.type === "placeable") {
      actions.push({ id: "place", label: "Place" });
    }
    return actions;
  }

  function runContextAction(actionId: string): void {
    const menu = itemContextMenu;
    const g = getGame();
    if (!menu || !g) return;
    const def = itemDef(menu.itemId);
    if (actionId === "equip" && def.slot) {
      const equipIdx = EQUIP_SLOTS.indexOf(def.slot);
      if (equipIdx >= 0) g.sendMoveItem(menu.container, menu.slot, "equip", equipIdx);
    } else if (actionId === "unequip") {
      const empty = firstEmptyInventorySlot();
      if (empty < 0) {
        game.toast("Backpack is full");
      } else {
        g.sendMoveItem("equip", menu.slot, "inventory", empty);
      }
    } else if (actionId === "use") {
      g.sendConsume(menu.container === "equip" ? "inventory" : menu.container, menu.slot);
    } else if (actionId === "place") {
      g.sendPlace(menu.container === "equip" ? "inventory" : menu.container, menu.slot);
      closeItemContextMenu();
      close();
      return;
    }
    closeItemContextMenu();
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
          systemSubTabIdx = (systemSubTabIdx + (dy > 0 ? 1 : 2)) % 3;
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
          } else if (systemTabSub === "graphics") {
            if (graphicsScrollContainer) {
              graphicsScrollContainer.scrollTop += dy * 40;
            }
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
        <div class="col paperdoll-col">
          <h3>Character</h3>
          <div class="paperdoll">
            <div class="paperdoll-slots">
              {#each PAPERDOLL_LEFT as slotName (slotName)}
                {@const i = EQUIP_SLOTS.indexOf(slotName)}
                {@const item = equipSlots[i]}
                <button
                  class="equip-slot"
                  class:cursor={equipCursor === i}
                  class:filled={!!item}
                  class:moving={moving?.container === "equip" && moving.slot === i}
                  title={item ? itemDef(item.itemId).name : EQUIP_LABELS[slotName]}
                  onclick={() => {
                    equipCursor = i;
                    activateInv("equip", i);
                  }}
                  oncontextmenu={(e) => item && openItemContextMenu("equip", i, item.itemId, e)}
                  onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                  onmouseleave={hideItemTooltip}
                >
                  <span class="equip-slot-icon">
                    {#if item}
                      <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
                    {/if}
                  </span>
                  <span class="equip-slot-label">{EQUIP_LABELS[slotName]}</span>
                </button>
              {/each}
            </div>
            <div class="paperdoll-stage">
              <canvas class="paperdoll-canvas" bind:this={paperdollCanvas}></canvas>
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
            <div class="paperdoll-slots">
              {#each PAPERDOLL_RIGHT as slotName (slotName)}
                {@const i = EQUIP_SLOTS.indexOf(slotName)}
                {@const item = equipSlots[i]}
                <button
                  class="equip-slot"
                  class:cursor={equipCursor === i}
                  class:filled={!!item}
                  class:moving={moving?.container === "equip" && moving.slot === i}
                  title={item ? itemDef(item.itemId).name : EQUIP_LABELS[slotName]}
                  onclick={() => {
                    equipCursor = i;
                    activateInv("equip", i);
                  }}
                  oncontextmenu={(e) => item && openItemContextMenu("equip", i, item.itemId, e)}
                  onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
                  onmouseleave={hideItemTooltip}
                >
                  <span class="equip-slot-icon">
                    {#if item}
                      <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
                    {/if}
                  </span>
                  <span class="equip-slot-label">{EQUIP_LABELS[slotName]}</span>
                </button>
              {/each}
            </div>
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
                oncontextmenu={(e) => item && openItemContextMenu("inventory", i, item.itemId, e)}
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
                oncontextmenu={(e) => !spellId && item && openItemContextMenu("hotbar", i, item.itemId, e)}
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
          <div class="soec-currency-bar">
            <div class="soec-label">Shadows of Eldor Coin (SoEC)</div>
            {#if game.self}
              {@const coins = parseCoins(game.self.coins)}
              <div class="soec-badges">
                <span class="coin-badge gold" title="{coins.gold} Gold"><span class="coin-icon">🟡</span> <strong>{coins.gold}</strong>g</span>
                <span class="coin-badge silver" title="{coins.silver} Silver"><span class="coin-icon">⚪</span> <strong>{coins.silver}</strong>s</span>
                <span class="coin-badge copper" title="{coins.copper} Copper"><span class="coin-icon">🟠</span> <strong>{coins.copper}</strong>c</span>
              </div>
            {/if}
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
      {:else if game.activeTab === "achievements"}
        <div class="achievements-tab">
          <h3>Achievements</h3>
          <p class="achievements-sub">
            {game.achievements.filter((a) => a.complete).length}/{game.achievements.length || 0} complete
          </p>
          <div class="achievement-list">
            {#each [...game.achievements].sort((a, b) => Number(a.complete) - Number(b.complete) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) as a (a.id)}
              <div class="achievement-row" class:complete={a.complete}>
                <div class="achievement-mark" aria-hidden="true">{a.complete ? "✓" : "◇"}</div>
                <div class="achievement-body">
                  <div class="achievement-title-row">
                    <span class="achievement-name">{a.name}</span>
                    <span class="achievement-cat">{a.category}</span>
                    {#if a.complete}
                      <span class="achievement-done">Complete</span>
                    {/if}
                  </div>
                  <div class="achievement-desc">{a.description}</div>
                  <div class="achievement-req">Requires: {a.requirement}</div>
                  <div class="achievement-progress">
                    <div class="achievement-bar">
                      <div
                        class="achievement-fill"
                        style="width: {a.target > 0 ? Math.min(100, (a.progress / a.target) * 100) : 0}%"
                      ></div>
                    </div>
                    <span class="achievement-count">{a.progress}/{a.target}</span>
                  </div>
                  <div class="achievement-rewards">
                    Reward: +{a.rewardXp} XP
                    {#each a.rewardItems as r (r.itemId + ":" + r.qty)}
                      · {r.qty}× {itemDef(r.itemId).name}
                    {/each}
                  </div>
                </div>
              </div>
            {:else}
              <div class="empty-quests">No achievements synced yet.</div>
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
        <div class="col party-tab-col full-width">
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
                  <div class="pm-info">
                    <span class="pm-name">
                      {#if member.leader}<span class="crown" title="Party Leader">👑</span>{/if}
                      {#if member.tag && member.tag !== "crown"}
                        <span class="pm-tag-icon" title="Party Tag: {member.tag}">
                          {member.tag === "target" ? "⚔️" : member.tag === "shield" ? "🛡️" : member.tag === "star" ? "⭐" : member.tag === "skull" ? "💀" : member.tag === "diamond" ? "💎" : "🏷️"}
                        </span>
                      {/if}
                      {member.name} <span class="lvl">lv{member.level}</span>
                    </span>
                    <div class="pm-bar">
                      <div class="pm-fill" style="width: {Math.min(100, (member.hp / member.maxHp) * 100)}%"></div>
                    </div>
                  </div>
                  {#if amLeader && !member.leader}
                    <div class="pm-tag-picker">
                      <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "target")} title="Tag Target">⚔️</button>
                      <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "shield")} title="Tag Shield">🛡️</button>
                      <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "star")} title="Tag Star">⭐</button>
                      <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "skull")} title="Tag Skull">💀</button>
                      <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "diamond")} title="Tag Diamond">💎</button>
                      <button class="tag-sm clear" onclick={() => getGame()?.sendPartyTag(member.name, "clear")} title="Clear Tag">✕</button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {#if amLeader}
              <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("disband")}>Disband Party</button>
            {:else}
              <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("leave")}>Leave Party</button>
            {/if}
          {:else}
            <div class="empty-note">You are not currently in a party. Invite friends or realm players from the Social tab!</div>
          {/if}
        </div>
      {:else if game.activeTab === "social"}
        <div class="col social-tab-col">
          <h3>Friends & Contacts</h3>
          <div class="add-friend-form">
            <input
              type="text"
              class="rc-input"
              placeholder="Enter adventurer name..."
              bind:value={friendInputName}
              onkeydown={(e) => {
                if (e.key === "Enter" && friendInputName.trim()) {
                  getGame()?.sendFriend("add", friendInputName.trim());
                  friendInputName = "";
                }
              }}
            />
            <button
              class="rc-btn primary"
              onclick={() => {
                if (friendInputName.trim()) {
                  getGame()?.sendFriend("add", friendInputName.trim());
                  friendInputName = "";
                }
              }}
            >
              Add Friend
            </button>
          </div>

          <div class="friends-list">
            {#each game.friends as friend (friend.name)}
              <div class="friend-row" class:offline={!friend.online}>
                <div class="friend-info">
                  <span class="status-dot" class:online={friend.online}></span>
                  <div class="friend-text">
                    <span class="friend-name">{friend.name}</span>
                    {#if friend.online}
                      <span class="friend-meta">lv{friend.level} · {friend.regionName ?? "Online"}</span>
                    {:else}
                      <span class="friend-meta offline">Offline</span>
                    {/if}
                  </div>
                </div>
                <div class="friend-actions">
                  {#if friend.online}
                    <button class="rc-btn primary sm" onclick={() => getGame()?.sendParty("invite", friend.name)} title="Start Party">
                      ⚔️ Party
                    </button>
                    <button class="rc-btn ghost sm" onclick={() => { game.chatOpen = true; getGame()?.sendChat(`/w ${friend.name} `); }} title="Direct Message">
                      💬 Whisper
                    </button>
                  {/if}
                  <button class="rc-btn danger sm icon-only" onclick={() => getGame()?.sendFriend("remove", friend.name)} title="Remove Friend">
                    ✕
                  </button>
                </div>
              </div>
            {/each}
            {#if game.friends.length === 0}
              <div class="empty-note">No friends added yet. Type a player's name above to add them!</div>
            {/if}
          </div>
        </div>

        <div class="col roster-col">
          <h3>Online Realm Adventurers</h3>
          <div class="roster-list">
            {#each invitablePlayers as p (p.id)}
              <div class="roster-row">
                <span class="roster-name">{p.name} <span class="lvl">lv{p.level}</span></span>
                <div class="roster-actions">
                  {#if !game.friends.some((f) => f.name.toLowerCase() === p.name.toLowerCase())}
                    <button class="rc-btn ghost sm" onclick={() => getGame()?.sendFriend("add", p.name)}>+ Friend</button>
                  {/if}
                  <button class="rc-btn invite-btn sm" onclick={() => getGame()?.sendParty("invite", p.name)}>Invite</button>
                </div>
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
              Settings
            </button>
            <button
              class="sub-tab-btn"
              class:active={systemTabSub === "graphics"}
              class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 1}
              onclick={() => {
                systemSubTabIdx = 1;
                systemSubFocus = "sidebar";
              }}
            >
              Graphics
            </button>
            <button
              class="sub-tab-btn"
              class:active={systemTabSub === "wiki"}
              class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 2}
              onclick={() => {
                systemSubTabIdx = 2;
                systemSubFocus = "sidebar";
              }}
            >
              Wiki Guide
            </button>
          </div>

          <!-- Content display area -->
          <div class="system-content-panel">
            {#if systemTabSub === "game"}
              <div class="col system-col settings-col">
                <h3>Settings</h3>

                <div class="settings-section">
                  <div class="settings-section-title">Gameplay</div>
                  <label class="setting-toggle">
                    <input
                      type="checkbox"
                      checked={game.autoLoot}
                      onchange={(e) => game.setAutoLoot(e.currentTarget.checked)}
                    />
                    <span class="setting-label">Auto Loot Corpses</span>
                  </label>
                </div>

                <div class="settings-section">
                  <div class="settings-section-title">Audio</div>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Sound Effects
                      <span class="setting-value">{Math.round(game.sfxVolume * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(game.sfxVolume * 100)}
                      oninput={(e) => {
                        const v = Number(e.currentTarget.value) / 100;
                        game.setSfxVolume(v);
                        sound.setVolume(v);
                      }}
                    />
                  </label>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Music
                      <span class="setting-value">{Math.round(game.musicVolume * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(game.musicVolume * 100)}
                      oninput={(e) => {
                        const v = Number(e.currentTarget.value) / 100;
                        game.setMusicVolume(v);
                        music.setVolume(v);
                      }}
                    />
                  </label>
                </div>

                <div class="settings-section">
                  <div class="settings-section-title">Display</div>
                  <label class="setting-toggle">
                    <input
                      type="checkbox"
                      checked={game.showPlayerNameplates}
                      onchange={(e) => {
                        game.setShowPlayerNameplates(e.currentTarget.checked);
                        getGame()?.syncNameplateVisibility();
                      }}
                    />
                    <span class="setting-label">Player Nameplates</span>
                  </label>
                  <label class="setting-toggle">
                    <input
                      type="checkbox"
                      checked={game.showMobNameplates}
                      onchange={(e) => {
                        game.setShowMobNameplates(e.currentTarget.checked);
                        getGame()?.syncNameplateVisibility();
                      }}
                    />
                    <span class="setting-label">Mob Nameplates</span>
                  </label>
                  <button
                    class="rc-btn"
                    class:selected={systemSubFocus === "content" && systemCursor === 0}
                    onclick={toggleFullscreen}
                  >
                    {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                  </button>
                </div>

                <div class="settings-section">
                  <button
                    class="rc-btn ghost"
                    class:selected={systemSubFocus === "content" && systemCursor === 1}
                    onclick={exitToCharacterSelect}
                  >
                    Exit to Character Select
                  </button>
                </div>
              </div>
            {:else if systemTabSub === "graphics"}
              <div class="col system-col settings-col graphics-col" bind:this={graphicsScrollContainer}>
                <h3>Graphics</h3>
                <p class="settings-hint">
                  Saved to your account. Resolution &amp; draw distance apply immediately;
                  antialiasing applies the next time you enter the world.
                </p>

                <div class="settings-section">
                  <div class="settings-section-title">Quality Preset</div>
                  <div class="preset-row">
                    {#each GRAPHICS_PRESET_IDS as id (id)}
                      <button
                        type="button"
                        class="rc-btn preset-btn"
                        class:selected={game.graphics.preset === id}
                        onclick={() => game.setGraphicsPreset(id as GraphicsPresetId)}
                      >
                        {GRAPHICS_PRESET_LABELS[id]}
                      </button>
                    {/each}
                  </div>
                  {#if game.graphics.preset === "custom"}
                    <div class="settings-note">Custom</div>
                  {/if}
                </div>

                <div class="settings-section">
                  <div class="settings-section-title">Resolution</div>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Render Scale
                      <span class="setting-value">{Math.round(game.graphics.resolutionScale * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      step="5"
                      value={Math.round(game.graphics.resolutionScale * 100)}
                      oninput={(e) =>
                        game.patchGraphics({ resolutionScale: Number(e.currentTarget.value) / 100 })}
                    />
                  </label>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Max Pixel Ratio
                      <span class="setting-value">{game.graphics.maxPixelRatio.toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min="75"
                      max="200"
                      step="5"
                      value={Math.round(game.graphics.maxPixelRatio * 100)}
                      oninput={(e) =>
                        game.patchGraphics({ maxPixelRatio: Number(e.currentTarget.value) / 100 })}
                    />
                  </label>
                </div>

                <div class="settings-section">
                  <div class="settings-section-title">Effects</div>
                  <label class="setting-toggle">
                    <input
                      type="checkbox"
                      checked={game.graphics.antialias}
                      onchange={(e) => game.patchGraphics({ antialias: e.currentTarget.checked })}
                    />
                    <span class="setting-label">Antialiasing</span>
                  </label>
                  <label class="setting-toggle">
                    <input
                      type="checkbox"
                      checked={game.graphics.shadowsEnabled}
                      onchange={(e) => game.patchGraphics({ shadowsEnabled: e.currentTarget.checked })}
                    />
                    <span class="setting-label">Shadows</span>
                  </label>
                  <label class="setting-slider" class:setting-disabled={!game.graphics.shadowsEnabled}>
                    <span class="setting-label">
                      Shadow Map
                      <span class="setting-value">{game.graphics.shadowMapSize}px</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="1"
                      disabled={!game.graphics.shadowsEnabled}
                      value={[512, 1024, 2048].indexOf(game.graphics.shadowMapSize)}
                      oninput={(e) => {
                        const sizes: ShadowMapSize[] = [512, 1024, 2048];
                        const size = sizes[Number(e.currentTarget.value)] ?? 1024;
                        game.patchGraphics({ shadowMapSize: size });
                      }}
                    />
                  </label>
                </div>

                <div class="settings-section">
                  <div class="settings-section-title">Draw Distance</div>
                  <label class="setting-slider">
                    <span class="setting-label">
                      World Stream
                      <span class="setting-value">~{streamRingMeters(game.graphics.streamRing)} m</span>
                    </span>
                    <input
                      type="range"
                      min="2"
                      max="5"
                      step="1"
                      value={game.graphics.streamRing}
                      oninput={(e) => game.patchGraphics({ streamRing: Number(e.currentTarget.value) })}
                    />
                  </label>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Grass Distance
                      <span class="setting-value">{Math.round(game.graphics.grassDrawDistance)} m</span>
                    </span>
                    <input
                      type="range"
                      min="40"
                      max="160"
                      step="5"
                      value={game.graphics.grassDrawDistance}
                      oninput={(e) =>
                        game.patchGraphics({ grassDrawDistance: Number(e.currentTarget.value) })}
                    />
                  </label>
                  <label class="setting-slider">
                    <span class="setting-label">
                      Fog Density
                      <span class="setting-value">{Math.round(game.graphics.fogScale * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      step="5"
                      value={Math.round(game.graphics.fogScale * 100)}
                      oninput={(e) => game.patchGraphics({ fogScale: Number(e.currentTarget.value) / 100 })}
                    />
                  </label>
                </div>
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
  {#if itemContextMenu}
    {@const actions = contextMenuActions(itemContextMenu)}
    {#if actions.length > 0}
      <div
        class="item-context-menu"
        style="left: {itemContextMenu.x}px; top: {itemContextMenu.y}px;"
        role="menu"
      >
        <div class="item-context-title">{itemDef(itemContextMenu.itemId).name}</div>
        {#each actions as action (action.id)}
          <button type="button" class="item-context-action" role="menuitem" onclick={() => runContextAction(action.id)}>
            {action.label}
          </button>
        {/each}
      </div>
    {/if}
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
    background: rgba(8, 4, 14, 0.62);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    z-index: 30;
  }
  .screen {
    display: flex;
    flex-direction: column;
    width: min(1080px, 94vw);
    height: min(680px, 90vh);
    padding: 0;
    overflow: hidden;
  }
  .tabs {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-bottom: 1px solid rgba(196, 163, 90, 0.3);
    background: rgba(0, 0, 0, 0.25);
    padding: 4px 48px 0 12px;
    position: relative;
  }
  .tab {
    background: none;
    border: none;
    color: var(--rc-ink-dim);
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 14px 16px 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s ease, box-shadow 0.15s ease;
  }
  .tab.active {
    color: var(--rc-ink);
    border-bottom-color: var(--rc-magenta);
    box-shadow: 0 2px 14px rgba(196, 77, 154, 0.35);
  }
  .tab:hover {
    color: #fff;
  }
  .close-btn {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 26px;
    height: 26px;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, #8a2a2a, #4a1414);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 2px;
    color: #ffd0c8;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  }
  .close-btn:hover {
    color: #fff;
    border-color: var(--rc-gold-bright);
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
  /* ---- Inventory tab (WoW-style paperdoll) ---- */
  .paperdoll-col {
    flex: 0 0 auto;
    width: min(360px, 38vw);
    min-width: 0;
  }
  .paperdoll {
    display: grid;
    grid-template-columns: 64px minmax(140px, 1fr) 64px;
    gap: 8px;
    align-items: start;
    flex: 1;
    min-height: 0;
  }
  .paperdoll-slots {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .equip-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid rgba(201, 162, 75, 0.28);
    border-radius: 6px;
    padding: 4px;
    cursor: pointer;
    color: #dce6f2;
    width: 64px;
  }
  .equip-slot.filled {
    border-color: rgba(201, 162, 75, 0.55);
    background: rgba(201, 162, 75, 0.08);
  }
  .equip-slot.cursor,
  .equip-slot.moving {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 0 1px rgba(255, 214, 110, 0.35);
  }
  .equip-slot-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .equip-slot-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #8a93a3;
    line-height: 1.1;
  }
  .paperdoll-stage {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 8px;
  }
  .paperdoll-canvas {
    width: 100%;
    height: min(260px, 34vh);
    border-radius: 6px;
    background: rgba(8, 10, 14, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: grab;
    touch-action: none;
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
  .item-context-menu {
    position: fixed;
    z-index: 10000;
    min-width: 148px;
    background: rgba(10, 12, 18, 0.98);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item-context-title {
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 0.5px;
    color: var(--rc-gold);
    padding: 6px 10px 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .item-context-action {
    background: transparent;
    border: none;
    color: #dce6f2;
    text-align: left;
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .item-context-action:hover {
    background: rgba(201, 162, 75, 0.16);
    color: var(--rc-gold-bright);
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
  /* ---- SoEC Currency Bar ---- */
  .soec-currency-bar {
    margin-top: 12px;
    padding: 8px 12px;
    background: radial-gradient(circle at 50% 30%, rgba(32, 26, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .soec-label {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--rc-gold-bright);
    text-transform: uppercase;
  }
  .soec-badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .coin-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .coin-badge strong {
    font-size: 13px;
  }
  .coin-badge.gold {
    color: #ffd700;
    border-color: rgba(255, 215, 0, 0.35);
  }
  .coin-badge.silver {
    color: #e0e0e0;
    border-color: rgba(224, 224, 224, 0.35);
  }
  .coin-badge.copper {
    color: #d9822b;
    border-color: rgba(217, 130, 43, 0.35);
  }
  /* ---- Party & Friends tab ---- */
  .party-tab-col {
    width: 360px;
  }
  .social-tab-col {
    flex: 1.4;
    min-width: 440px;
  }
  .party-tab-col.full-width {
    flex: 1;
    width: 100%;
  }
  .add-friend-form {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  .add-friend-form input {
    flex: 1;
    height: 38px;
    font-size: 13px;
    border-radius: 4px;
  }
  .add-friend-form button {
    height: 38px;
    padding: 0 16px;
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 1px;
  }
  .friends-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 420px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 6px;
    margin-bottom: 12px;
  }
  .friends-list::-webkit-scrollbar, .roster-list::-webkit-scrollbar {
    width: 6px;
  }
  .friends-list::-webkit-scrollbar-track, .roster-list::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 3px;
  }
  .friends-list::-webkit-scrollbar-thumb, .roster-list::-webkit-scrollbar-thumb {
    background: var(--rc-gold-dim);
    border-radius: 3px;
  }
  .friend-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: radial-gradient(circle at 50% 20%, rgba(28, 24, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    gap: 12px;
    margin-bottom: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .friend-row.offline {
    opacity: 0.55;
  }
  .friend-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .friend-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #666;
    flex-shrink: 0;
  }
  .status-dot.online {
    background: #4cd964;
    box-shadow: 0 0 8px #4cd964;
  }
  .friend-name {
    font-family: var(--rc-display);
    font-size: 13.5px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .friend-meta {
    font-size: 11px;
    color: var(--rc-parchment);
    opacity: 0.85;
    white-space: nowrap;
  }
  .friend-meta.offline {
    color: #888;
  }
  .friend-actions, .roster-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .rc-btn.sm {
    padding: 4px 10px;
    font-size: 11px;
    height: 28px;
    white-space: nowrap;
    border-radius: 4px;
  }
  .rc-btn.sm.icon-only {
    width: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: radial-gradient(circle at 50% 20%, rgba(28, 24, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 8px 12px;
    gap: 12px;
  }
  .party-member.offline {
    opacity: 0.45;
  }
  .pm-info {
    flex: 1;
    min-width: 0;
  }
  .pm-name {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    margin-bottom: 4px;
  }
  .crown {
    font-size: 11px;
    margin-right: 2px;
  }
  .pm-tag-icon {
    font-size: 12px;
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
  .pm-tag-picker {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(201, 162, 75, 0.2);
    border-radius: 4px;
    flex-shrink: 0;
  }
  .tag-sm {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    cursor: url('/assets/cursors/02.png') 2 2, pointer !important;
    transition: all 0.1s ease;
  }
  .tag-sm:hover {
    background: rgba(201, 162, 75, 0.35);
    border-color: var(--rc-gold-bright);
    transform: scale(1.1);
  }
  .tag-sm.clear {
    color: #ff6666;
    font-size: 10px;
    font-weight: bold;
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

  /* ---- Achievements tab ---- */
  .achievements-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .achievements-sub {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  .achievement-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    padding-right: 4px;
  }
  .achievement-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 10px 12px;
    color: #dce6f2;
  }
  .achievement-row.complete {
    border-color: rgba(143, 212, 143, 0.35);
    background: rgba(143, 212, 143, 0.06);
  }
  .achievement-mark {
    flex-shrink: 0;
    width: 22px;
    text-align: center;
    font-size: 16px;
    line-height: 1.2;
    color: var(--rc-gold);
  }
  .achievement-row.complete .achievement-mark {
    color: #8fd48f;
  }
  .achievement-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .achievement-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .achievement-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--rc-parchment);
  }
  .achievement-row.complete .achievement-name {
    color: #8fd48f;
  }
  .achievement-cat {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--rc-ink-dim);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    padding: 1px 6px;
  }
  .achievement-done {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #8fd48f;
    background: rgba(143, 212, 143, 0.12);
    border: 1px solid rgba(143, 212, 143, 0.25);
    padding: 2px 7px;
    border-radius: 4px;
    margin-left: auto;
  }
  .achievement-desc {
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  .achievement-req {
    font-size: 11px;
    color: var(--rc-gold);
  }
  .achievement-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  .achievement-bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .achievement-fill {
    height: 100%;
    background: linear-gradient(90deg, #8a6f33, var(--rc-gold-bright, #ffd66e));
    border-radius: 3px;
  }
  .achievement-row.complete .achievement-fill {
    background: linear-gradient(90deg, #4a8a4a, #8fd48f);
  }
  .achievement-count {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--rc-parchment);
    min-width: 3.5em;
    text-align: right;
  }
  .achievement-rewards {
    font-size: 11px;
    color: #b8c4d4;
    margin-top: 2px;
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
  .setting-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--rc-parchment);
    user-select: none;
    margin-bottom: 8px;
  }
  .setting-toggle input {
    cursor: pointer;
    accent-color: #d4af37;
    width: 16px;
    height: 16px;
  }
  .settings-col {
    gap: 14px;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .settings-section-title {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rc-gold-bright);
    opacity: 0.85;
  }
  .settings-hint {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--rc-ink-dim);
    opacity: 0.9;
  }
  .settings-note {
    font-size: 11px;
    color: var(--rc-gold-bright);
    opacity: 0.75;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preset-btn {
    flex: 1 1 auto;
    min-width: 64px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .graphics-col {
    overflow-y: auto;
    min-height: 0;
    padding-right: 4px;
  }
  .setting-disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .setting-slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    font-size: 13px;
    color: var(--rc-parchment);
  }
  .setting-slider .setting-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .setting-value {
    font-variant-numeric: tabular-nums;
    color: var(--rc-gold-bright);
    font-size: 12px;
  }
  .setting-slider input[type="range"] {
    width: 100%;
    accent-color: #d4af37;
    cursor: pointer;
  }

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
