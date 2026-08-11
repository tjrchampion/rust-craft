<script lang="ts">
  import { game, parseCoins } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon, spellIcon, rewardChestIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import LevelUpModal from "./LevelUpModal.svelte";
  import { promptLabel } from "./padGlyphs";
  import { HOTBAR_SLOTS, itemDef, spellDef, CLASSES, type ClassId } from "@rustcraft/shared";
  import { CLASS_ICONS } from "../render/classModels";

  let openChestId = $state<string | null>(null);
  const openChest = $derived(game.levelRewards.find((c) => c.id === openChestId) ?? null);
  const coins = $derived(parseCoins(game.self?.coins ?? 0));
  const xpPct = $derived(
    game.self ? Math.min(100, (game.self.xp / Math.max(1, game.self.xpNext)) * 100) : 0,
  );
  const classId = $derived((game.classId || "warrior") as ClassId);
  const classIcon = $derived(CLASS_ICONS[classId] ?? "⚔️");
  const hpPct = $derived(
    game.self ? Math.min(100, (game.self.hp / Math.max(1, game.self.maxHp)) * 100) : 0,
  );
  const manaPct = $derived(
    game.self ? Math.min(100, (game.self.mana / Math.max(1, game.self.maxMana)) * 100) : 0,
  );

  let hoveredSpellId = $state<string | null>(null);
  let hoveredItemId = $state<string | null>(null);
  let tooltipPos = $state({ x: 0, y: 0 });
  let selectedMoveSlot = $state<number | null>(null);
  let draggingSlot = $state<number | null>(null);
  // Pointer-based drag state. Native HTML5 drag can't be used: during gameplay
  // the pointer is locked (see InputManager), so the OS cursor is hidden/frozen
  // and dragstart never fires. We drive drag from mousedown + the software
  // cursor (game.cursorX/Y) instead, which works both locked and unlocked.
  let dragFrom: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  // The icon "picked up" and shown floating under the cursor while dragging.
  let dragGhost = $state<{ spellId: string | null; itemId: string | null } | null>(null);
  let ghostEl = $state<HTMLDivElement | null>(null);

  function onSlotHover(e: MouseEvent, spellId: string | null, itemId: string | null) {
    const sId = spellId ?? (itemId?.startsWith("spell:") ? itemId.slice(6) : null);
    const iId = itemId && !itemId.startsWith("spell:") ? itemId : null;

    if (sId) {
      hoveredSpellId = sId;
      hoveredItemId = null;
    } else if (iId) {
      hoveredItemId = iId;
      hoveredSpellId = null;
    } else {
      hoveredSpellId = null;
      hoveredItemId = null;
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipPos = {
      x: Math.max(10, Math.min(rect.left + rect.width / 2 - 125, window.innerWidth - 260)),
      y: rect.top - 10,
    };
  }

  function onSlotLeave() {
    hoveredSpellId = null;
    hoveredItemId = null;
  }

  /** Swap two hotbar slots -- optimistic local reslot + authoritative sync. */
  function performHotbarMove(fromSlot: number, targetSlotIndex: number) {
    if (fromSlot === targetSlotIndex) return;
    const fromItem = game.inventory.find((it) => it.container === "hotbar" && it.slot === fromSlot);
    const toItem = game.inventory.find((it) => it.container === "hotbar" && it.slot === targetSlotIndex);
    if (fromItem) fromItem.slot = targetSlotIndex;
    if (toItem) toItem.slot = fromSlot;
    getGame()?.sendMoveItem("hotbar", fromSlot, "hotbar", targetSlotIndex);
  }

  // Native drop target kept only for drags *from* the spellbook (which happen
  // with the character screen open, i.e. pointer unlocked) -- hotbar slots are
  // no longer a native drag source; within-hotbar rearranging is pointer-based.
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: DragEvent, targetSlotIndex: number) {
    e.preventDefault();
    const rawData = e.dataTransfer?.getData("text/plain");
    if (!rawData) return;
    try {
      const data = JSON.parse(rawData);
      if (data.container === "spellbook" || data.spellId) {
        if (data.spellId) getGame()?.sendAssignSpell(data.spellId, targetSlotIndex);
      } else if (data.container === "hotbar" && typeof data.slot === "number") {
        performHotbarMove(data.slot, targetSlotIndex);
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  /** Begin a pointer drag off a filled slot (mousedown, so the InputManager's
   *  synthetic mousedown drives it while the pointer is locked). */
  function startDrag(i: number, spellId: string | null, itemId: string | null, e: MouseEvent) {
    if (!spellId && !itemId) return;
    dragFrom = i;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragGhost = { spellId, itemId };
  }

  $effect(() => {
    // Promote to a visible drag once the software cursor moves past a small
    // threshold; a press without movement stays a click (cast / shift-select).
    const onMove = () => {
      if (dragFrom === null) return;
      if (Math.hypot(game.cursorX - dragStartX, game.cursorY - dragStartY) > 6) draggingSlot = dragFrom;
    };
    const onUp = () => {
      if (dragFrom === null) return;
      const from = dragFrom;
      const wasDragging = draggingSlot === from;
      const currentGhost = dragGhost;
      dragFrom = null;
      draggingSlot = null;
      dragGhost = null;
      if (!wasDragging) return; // treated as a click; onclick handles it
      const el = document.elementFromPoint(game.cursorX, game.cursorY) as HTMLElement | null;
      const slotEl = el?.closest("[data-slot]") as HTMLElement | null;
      if (slotEl) {
        const to = Number(slotEl.dataset.slot);
        if (Number.isInteger(to)) performHotbarMove(from, to);
      } else {
        // Dragged off hotbar onto empty space: remove from hotbar slot!
        getGame()?.sendAssignSpell(null, from);
        const item = game.inventory.find((it) => it.container === "hotbar" && it.slot === from);
        if (item) {
          const idx = game.inventory.indexOf(item);
          if (idx >= 0) game.inventory.splice(idx, 1);
        }
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  // Keep the picked-up icon glued to the software cursor. Reading game.cursorX
  // only fires while a drag is active (the early return below means cursorX
  // isn't tracked otherwise), so this doesn't re-run on every idle mouse move.
  $effect(() => {
    if (draggingSlot === null || !ghostEl) return;
    ghostEl.style.transform = `translate3d(${game.cursorX}px, ${game.cursorY}px, 0)`;
  });

  function handleSlotClick(i: number, spellId: string | null, item: any, e: MouseEvent) {
    if (selectedMoveSlot !== null) {
      if (selectedMoveSlot !== i) {
        const fromSlot = selectedMoveSlot;
        const fromItem = game.inventory.find((it) => it.container === "hotbar" && it.slot === fromSlot);
        const toItem = game.inventory.find((it) => it.container === "hotbar" && it.slot === i);
        if (fromItem) fromItem.slot = i;
        if (toItem) toItem.slot = fromSlot;

        getGame()?.sendMoveItem("hotbar", fromSlot, "hotbar", i);
      }
      selectedMoveSlot = null;
      return;
    }

    if (e.shiftKey) {
      if (spellId || item) {
        selectedMoveSlot = i;
      }
      return;
    }

    getGame()?.useHotbarSlot(i);
  }

  const SPELL_PREFIX = "spell:";
  const KBM_LABELS = ["1", "2", "3", "4", "5", "6", "Q", "Z", "X", "C"];
  const PAD_LABELS = ["LB+A", "LB+B", "LB+X", "LB+Y", "LB+↑", "LB+↓", "LB+←", "LB+→", "RB+A", "RB+B"];

  function keyLabel(i: number): string {
    return promptLabel(PAD_LABELS[i] ?? "", KBM_LABELS[i] ?? "");
  }

  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowTick = Date.now()), 100);
    return () => clearInterval(id);
  });

  let hotbarPage = $state(0);
  function nextHotbarPage() {
    hotbarPage = (hotbarPage + 1) % 3;
  }
  function prevHotbarPage() {
    hotbarPage = (hotbarPage - 1 + 3) % 3;
  }

  const pageOffset = $derived(hotbarPage * 10);
  const slots = $derived(
    Array.from({ length: 10 }, (_, idx) => {
      const i = pageOffset + idx;
      const item = game.inventory.find((it) => it.container === "hotbar" && it.slot === i);
      const spellId = item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
      let cooldownFrac = 0;
      let cooldownLabel = "";
      let gcdFrac = 0;
      if (spellId) {
        const def = spellDef(spellId);
        const total = def.cooldownS;
        const entry = game.self?.spellCooldowns.find((c) => c.spellId === spellId);
        const currentServerTime = nowTick - game.serverTimeOffset;
        if (entry && total > 0) {
          const remaining = Math.max(0, (entry.readyAt - currentServerTime) / 1000);
          cooldownFrac = Math.min(1, remaining / total);
          if (remaining > 0.05) cooldownLabel = remaining >= 10 ? String(Math.ceil(remaining)) : remaining.toFixed(1);
        }
        if (def.triggersGcd !== false && game.self?.gcdReadyAt) {
          const gcdLeft = Math.max(0, game.self.gcdReadyAt - currentServerTime);
          gcdFrac = gcdLeft > 0 ? Math.min(0.55, gcdLeft / 1500) : 0;
        }
      }
      const queued = spellId !== null && game.self?.queuedSpellId === spellId;
      return { slotIndex: i, displayIndex: idx, item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued };
    }),
  );

  const leftSlots = $derived(slots.slice(0, 5));
  const rightSlots = $derived(slots.slice(5));

  const currentSpellId = $derived.by(() => {
    if (game.self?.castingSpell) return game.self.castingSpell;
    if (game.self?.queuedSpellId) return game.self.queuedSpellId;
    const activeSlot = slots[game.selectedSlot % 10];
    if (activeSlot?.spellId) return activeSlot.spellId;
    const selItem = game.inventory.find((it) => it.container === "hotbar" && it.slot === game.selectedSlot);
    if (selItem?.itemId.startsWith(SPELL_PREFIX)) return selItem.itemId.slice(SPELL_PREFIX.length);
    return null;
  });
</script>

{#if game.self}
  <div class="xp-strip" title="XP: {game.self.xp} / {game.self.xpNext}">
    <div class="xp-fill" style="width: {xpPct}%"></div>
  </div>

  <div class="currency">
    <span class="coin gold" title="{coins.gold} Gold"><span class="pip"></span>{coins.gold.toLocaleString()}</span>
    <span class="coin silver" title="{coins.silver} Silver"><span class="pip"></span>{coins.silver}</span>
  </div>
{/if}

<div class="action-cluster">
  {#if game.self}
    <div class="hub">
      <div class="side-bar left">
        <div class="rc-resource-bar hp angled" class:low={hpPct < 28}>
          <div class="fill" style="width: {hpPct}%"></div>
          <span class="label">{Math.round(hpPct)}% Health</span>
        </div>
      </div>
      <div
        class="hub-portrait"
        class:has-spell={currentSpellId !== null}
        title={currentSpellId ? spellDef(currentSpellId).name : (CLASSES[classId]?.name ?? "Adventurer")}
      >
        {#if currentSpellId}
          <IconGlyph value={spellIcon(currentSpellId)} size={32} />
        {:else}
          <span class="hub-icon">{classIcon}</span>
        {/if}
      </div>
      <div class="side-bar right">
        <div class="rc-resource-bar mana angled-flip">
          <div class="fill" style="width: {manaPct}%"></div>
          <span class="label">Mana {Math.round(manaPct)}%</span>
        </div>
      </div>
    </div>
  {/if}

  <div class="hotbar-plate">
    <div class="hotbar-page-controls" title="Hotbar Page {hotbarPage + 1}">
      <button type="button" class="page-arrow up" onclick={prevHotbarPage} title="Previous Page">▲</button>
      <span class="page-badge">{hotbarPage + 1}</span>
      <button type="button" class="page-arrow down" onclick={nextHotbarPage} title="Next Page">▼</button>
    </div>

    <div class="hotbar-row">
      {#each leftSlots as { slotIndex, displayIndex, item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued } (slotIndex)}
        <button
          type="button"
          class="rc-action-slot"
          class:active={slotIndex === game.selectedSlot}
          class:spell={spellId !== null}
          class:queued
          class:moving={selectedMoveSlot === slotIndex || draggingSlot === slotIndex}
          data-slot={slotIndex}
          ondragover={(e) => onDragOver(e)}
          ondrop={(e) => onDrop(e, slotIndex)}
          onmousedown={(e) => startDrag(slotIndex, spellId, item?.itemId ?? null, e)}
          onmouseenter={(e) => onSlotHover(e, spellId, item?.itemId ?? null)}
          onmouseleave={onSlotLeave}
          onclick={(e) => handleSlotClick(slotIndex, spellId, item, e)}
        >
          {#if spellId}
            <IconGlyph value={spellIcon(spellId)} size={44} />
            {#if game.self?.castingSpell === spellId}<div class="casting"></div>{/if}
            {#if gcdFrac > 0 && cooldownFrac <= 0}<div class="gcd-dim" style="opacity: {gcdFrac}"></div>{/if}
            {#if cooldownFrac > 0}
              <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
              {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
            {/if}
            {#if queued}<div class="queue-pip"></div>{/if}
          {:else if item}
            <IconGlyph value={itemIcon(item.itemId)} size={44} itemId={item.itemId} />
            {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {#if item.durability !== null && itemDef(item.itemId).maxDurability}
              <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
            {/if}
          {/if}
          <span class="num">{keyLabel(displayIndex)}</span>
        </button>
      {/each}

      <div class="row-gap"></div>

      {#each rightSlots as { slotIndex, displayIndex, item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued } (slotIndex)}
        <button
          type="button"
          class="rc-action-slot"
          class:active={slotIndex === game.selectedSlot}
          class:spell={spellId !== null}
          class:queued
          class:moving={selectedMoveSlot === slotIndex || draggingSlot === slotIndex}
          data-slot={slotIndex}
          ondragover={(e) => onDragOver(e)}
          ondrop={(e) => onDrop(e, slotIndex)}
          onmousedown={(e) => startDrag(slotIndex, spellId, item?.itemId ?? null, e)}
          onmouseenter={(e) => onSlotHover(e, spellId, item?.itemId ?? null)}
          onmouseleave={onSlotLeave}
          onclick={(e) => handleSlotClick(slotIndex, spellId, item, e)}
        >
          {#if spellId}
            <IconGlyph value={spellIcon(spellId)} size={44} />
            {#if game.self?.castingSpell === spellId}<div class="casting"></div>{/if}
            {#if gcdFrac > 0 && cooldownFrac <= 0}<div class="gcd-dim" style="opacity: {gcdFrac}"></div>{/if}
            {#if cooldownFrac > 0}
              <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
              {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
            {/if}
            {#if queued}<div class="queue-pip"></div>{/if}
          {:else if item}
            <IconGlyph value={itemIcon(item.itemId)} size={44} itemId={item.itemId} />
            {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {#if item.durability !== null && itemDef(item.itemId).maxDurability}
              <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
            {/if}
          {/if}
          <span class="num">{keyLabel(displayIndex)}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

{#if draggingSlot !== null && dragGhost}
  <div class="drag-ghost" bind:this={ghostEl}>
    {#if dragGhost.spellId}
      <IconGlyph value={spellIcon(dragGhost.spellId)} size={44} />
    {:else if dragGhost.itemId}
      <IconGlyph value={itemIcon(dragGhost.itemId)} size={44} itemId={dragGhost.itemId} />
    {/if}
  </div>
{/if}

{#if hoveredSpellId}
  {@const def = spellDef(hoveredSpellId)}
  <div class="rc-spell-tooltip" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;">
    <div class="tooltip-header">
      <span class="spell-name">{def.name}</span>
      <span class="cost">{def.resourceCost ? `${def.resourceCost} ${CLASSES[classId]?.resourceLabel ?? 'Mana'}` : 'No Cost'}</span>
    </div>
    <div class="meta-row">
      <span>{def.targeting.range ? `${def.targeting.range}m Range` : 'Melee Range'}</span>
      <span>{def.castTimeS > 0 ? `${def.castTimeS}s cast` : 'Instant'}</span>
      {#if def.cooldownS > 0}<span>{def.cooldownS}s cd</span>{/if}
    </div>
    <div class="tooltip-body">
      {#each def.effects as eff}
        {#if eff.type === "damage"}
          <div class="stat-line dmg">
            Deals <strong>{eff.base ?? 0}</strong> {eff.damageType ?? 'physical'} damage
            {#if eff.powerScale}(+{(eff.powerScale * 100).toFixed(0)}% Power){/if}
          </div>
        {:else if eff.type === "heal"}
          <div class="stat-line heal">
            Heals for <strong>{eff.base ?? 0}</strong> HP
            {#if eff.powerScale}(+{(eff.powerScale * 100).toFixed(0)}% Power){/if}
          </div>
        {:else if eff.type === "applyAura"}
          <div class="stat-line aura">Applies {eff.auraId ?? 'effect'} ({eff.landsOn ?? 'target'})</div>
        {/if}
      {/each}
      {#if def.allowedWeaponTypes?.length}
        <div class="stat-req">Requires: {def.allowedWeaponTypes.join(", ")}</div>
      {/if}
      {#if def.requiredLevel && def.requiredLevel > 1}
        <div class="stat-req">Requires Level {def.requiredLevel}</div>
      {/if}
    </div>
  </div>
{:else if hoveredItemId}
  {@const def = itemDef(hoveredItemId)}
  <div class="rc-spell-tooltip" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;">
    <div class="tooltip-header">
      <span class="spell-name">{def.name}</span>
      <span class="cost">{def.type}</span>
    </div>
    <div class="tooltip-body">
      {#if def.damage}<div class="stat-line dmg">Melee Damage: +{def.damage}</div>{/if}
      {#if def.restore}
        {#if def.restore.hp}<div class="stat-line heal">Restores +{def.restore.hp} HP</div>{/if}
        {#if def.restore.mana}<div class="stat-line heal">Restores +{def.restore.mana} Mana</div>{/if}
      {/if}
      {#if def.statModifiers}
        {#each Object.entries(def.statModifiers) as [k, v]}
          <div class="stat-line">+{v} {k.toUpperCase()}</div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

{#if game.levelRewards.length > 0}
  <div class="reward-chests">
    {#each game.levelRewards as chest (chest.id)}
      <button class="chest-button" title="Level {chest.level} Reward" onclick={() => (openChestId = chest.id)}>
        <IconGlyph value={rewardChestIcon()} size={32} />
        <span class="chest-level">{chest.level}</span>
      </button>
    {/each}
  </div>
{/if}

{#if openChest}
  <LevelUpModal chest={openChest} onClose={() => (openChestId = null)} />
{/if}



<style>
  .drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px; /* centre the icon on the software cursor */
    pointer-events: none;
    z-index: 1000000;
    opacity: 0.9;
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.65));
    will-change: transform;
  }
  .spell-drop-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.25);
  }
  .spell-drop-modal {
    position: fixed;
    width: 240px;
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(24, 18, 36, 0.96), rgba(12, 8, 18, 0.98));
    border: 1.5px solid var(--rc-gold);
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.9), inset 0 0 16px rgba(196, 163, 90, 0.15);
    font-family: inherit;
    color: #fff;
    z-index: 10001;
    animation: modalPop 0.15s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }
  @keyframes modalPop {
    from { opacity: 0; transform: scale(0.92); }
    to { opacity: 1; transform: scale(1); }
  }
  .spell-drop-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(196, 163, 90, 0.3);
  }
  .spell-drop-icon {
    font-size: 18px;
    line-height: 1;
  }
  .spell-drop-title {
    font-weight: 800;
    font-size: 13px;
    color: var(--rc-gold-bright);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spell-drop-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .spell-drop-btn {
    width: 100%;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }
  .spell-drop-btn.remove-btn {
    background: linear-gradient(180deg, rgba(180, 40, 40, 0.85), rgba(120, 20, 20, 0.95));
    color: #ffdddd;
    border-color: rgba(255, 100, 100, 0.5);
  }
  .spell-drop-btn.remove-btn:hover {
    background: linear-gradient(180deg, rgba(210, 50, 50, 0.95), rgba(150, 25, 25, 1));
    color: #ffffff;
    box-shadow: 0 0 10px rgba(255, 60, 60, 0.4);
  }
  .spell-drop-btn.drop-btn {
    background: linear-gradient(180deg, rgba(160, 100, 20, 0.85), rgba(100, 60, 10, 0.95));
    color: #ffeedd;
    border-color: rgba(255, 180, 80, 0.5);
  }
  .spell-drop-btn.drop-btn:hover {
    background: linear-gradient(180deg, rgba(190, 120, 30, 0.95), rgba(130, 75, 15, 1));
    color: #ffffff;
    box-shadow: 0 0 10px rgba(255, 160, 40, 0.4);
  }
  .spell-drop-btn.keep-btn {
    background: linear-gradient(180deg, rgba(50, 50, 70, 0.85), rgba(30, 30, 45, 0.95));
    color: #d0d0e0;
    border-color: rgba(160, 160, 200, 0.3);
  }
  .spell-drop-btn.keep-btn:hover {
    background: linear-gradient(180deg, rgba(75, 75, 100, 0.95), rgba(45, 45, 65, 1));
    color: #ffffff;
  }

  .xp-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 8px;
    background: rgba(4, 5, 8, 0.9);
    border-top: 1px solid var(--rc-gold-dim);
    overflow: hidden;
    pointer-events: none;
    z-index: 10;
  }
  .xp-fill {
    height: 100%;
    background: linear-gradient(180deg, #ffe9a0 0%, #ffd700 45%, #c9a24b 80%, #7a5a18 100%);
    transition: width 0.3s ease-out;
    box-shadow:
      0 0 12px #ffd700,
      0 0 24px rgba(255, 215, 0, 0.8),
      inset 0 1px 0 #ffffff;
    animation: xpGlowPulse 2.5s infinite alternate ease-in-out;
  }
  @keyframes xpGlowPulse {
    from { filter: brightness(1) drop-shadow(0 0 4px #ffd700); }
    to { filter: brightness(1.25) drop-shadow(0 0 10px #ffd700); }
  }

  .currency {
    position: absolute;
    right: 14px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    background: rgba(12, 10, 18, 0.72);
    border: 1px solid rgba(196, 163, 90, 0.35);
    border-radius: 3px;
    pointer-events: none;
    z-index: 6;
  }
  .coin {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 800;
    text-shadow: 0 1px 2px #000;
  }
  .coin.gold { color: #e8c878; }
  .coin.silver { color: #d0d7e2; }
  .pip {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.45);
  }
  .coin.gold .pip {
    background: radial-gradient(circle at 35% 30%, #ffe9a0, #c9a24b 55%, #7a5a18);
  }
  .coin.silver .pip {
    background: radial-gradient(circle at 35% 30%, #f2f5f8, #a8b0bc 55%, #5a6270);
  }

  .action-cluster {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    z-index: 5;
  }

  .hub {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .side-bar {
    width: 168px;
  }
  .side-bar :global(.rc-resource-bar) {
    height: 22px;
  }
  .side-bar :global(.label) {
    font-size: 11px;
    letter-spacing: 0.3px;
  }
  .hub-portrait {
    position: relative;
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 28%, #4a3558, #120e18 72%);
    border: 2px solid var(--rc-gold-bright);
    box-shadow:
      0 0 16px rgba(196, 77, 154, 0.35),
      0 4px 12px rgba(0, 0, 0, 0.7),
      inset 0 0 12px rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .hub-portrait.has-spell {
    border-color: #ffe890;
    box-shadow:
      0 0 20px rgba(255, 215, 0, 0.6),
      0 4px 12px rgba(0, 0, 0, 0.7),
      inset 0 0 12px rgba(255, 215, 0, 0.3);
  }
  .hub-icon {
    font-size: 24px;
    line-height: 1;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
  }

  .hotbar-plate {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(12, 10, 18, 0.75);
    border: 1px solid rgba(196, 163, 90, 0.35);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65), inset 0 0 12px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
  }
  .hotbar-page-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding-right: 6px;
    border-right: 1px solid rgba(196, 163, 90, 0.25);
  }
  .page-arrow {
    width: 20px;
    height: 16px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, #2b1f35, #140d1a);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 2px;
    color: var(--rc-gold-bright);
    font-size: 9px;
    cursor: pointer;
    line-height: 1;
    transition: all 0.15s ease;
  }
  .page-arrow:hover {
    border-color: var(--rc-gold-bright);
    color: #fff;
    background: linear-gradient(180deg, #4a355c, #20132c);
    box-shadow: 0 0 8px rgba(196, 163, 90, 0.5);
  }
  .page-badge {
    font-family: var(--rc-display);
    font-size: 10px;
    font-weight: 800;
    color: var(--rc-gold-bright);
    line-height: 1;
    text-shadow: 0 1px 3px #000;
  }
  .hotbar-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 4px;
  }
  .row-gap {
    width: 10px;
  }
  .rc-action-slot * {
    pointer-events: none !important;
    user-select: none !important;
    -webkit-user-drag: none !important;
  }
  .rc-action-slot.moving {
    outline: 2px solid var(--rc-gold-bright) !important;
    box-shadow: 0 0 16px rgba(255, 215, 0, 0.8), inset 0 0 12px rgba(255, 215, 0, 0.4) !important;
    animation: slotGlow 0.8s infinite alternate ease-in-out;
  }
  @keyframes slotGlow {
    from { opacity: 0.75; }
    to { opacity: 1; }
  }
  .rc-action-slot.spell {
    border-color: rgba(160, 100, 200, 0.5);
  }
  .rc-action-slot.spell.queued {
    border-color: var(--rc-magenta-bright);
    box-shadow: 0 0 12px rgba(196, 77, 154, 0.45), inset 0 0 10px rgba(0, 0, 0, 0.65);
  }
  .gcd-dim {
    position: absolute;
    inset: 0;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .queue-pip {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--rc-magenta-bright);
    box-shadow: 0 0 6px rgba(224, 107, 180, 0.9);
    pointer-events: none;
  }
  .qty {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font-size: 11px;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .num {
    position: absolute;
    left: 3px;
    top: 1px;
    font-size: 9px;
    font-weight: 800;
    color: rgba(232, 200, 120, 0.9);
    text-shadow: 0 1px 2px #000;
  }
  .dura {
    position: absolute;
    bottom: 2px;
    left: 3px;
    height: 3px;
    max-width: calc(100% - 6px);
    background: #6fc46a;
    border-radius: 2px;
  }
  .casting {
    position: absolute;
    inset: 0;
    border-radius: 2px;
    background: rgba(196, 77, 154, 0.3);
    animation: pulse 0.6s infinite alternate;
  }
  @keyframes pulse {
    from { opacity: 0.4; }
    to { opacity: 1; }
  }
  .cooldown-sweep {
    position: absolute;
    inset: 0;
    border-radius: 2px;
    background: conic-gradient(rgba(0, 0, 0, 0.78) calc(var(--frac) * 360deg), transparent 0);
    pointer-events: none;
  }

  .rc-spell-tooltip {
    position: fixed;
    transform: translateY(-100%);
    width: 250px;
    padding: 10px 12px;
    background: linear-gradient(180deg, rgba(18, 14, 26, 0.96), rgba(8, 5, 12, 0.98));
    border: 1.5px solid var(--rc-gold);
    border-radius: 4px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85), inset 0 0 14px rgba(196, 163, 90, 0.15);
    pointer-events: none;
    z-index: 9999;
    font-family: inherit;
  }
  .tooltip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(196, 163, 90, 0.3);
    padding-bottom: 4px;
    margin-bottom: 4px;
  }
  .spell-name {
    font-weight: 800;
    font-size: 13px;
    color: var(--rc-gold-bright);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  }
  .cost {
    font-size: 11px;
    font-weight: 700;
    color: #64b5f6;
  }
  .meta-row {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: #b0b0b0;
    margin-bottom: 6px;
  }
  .tooltip-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    color: #e0e0e0;
  }
  .stat-line.dmg { color: #ff8a80; }
  .stat-line.heal { color: #81c784; }
  .stat-line.aura { color: #ce93d8; }
  .stat-req { color: #ffd54f; font-size: 11px; margin-top: 2px; }

  .cooldown-label {
    position: absolute;
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 3px #000;
    pointer-events: none;
  }
  .reward-chests {
    position: absolute;
    bottom: 120px;
    right: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
    z-index: 5;
  }
  .chest-button {
    position: relative;
    width: 56px;
    height: 56px;
    background: linear-gradient(180deg, rgba(196, 77, 154, 0.25), rgba(0, 0, 0, 0.5));
    border: 2px solid rgba(232, 200, 120, 0.55);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 0 14px rgba(196, 77, 154, 0.4);
    transition: all 0.2s;
    font-size: 0;
  }
  .chest-button:hover {
    border-color: var(--rc-gold-bright);
    transform: scale(1.08);
  }
  .chest-level {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 11px;
    font-weight: 700;
    color: #ffd700;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 4px;
    border-radius: 3px;
  }
</style>
