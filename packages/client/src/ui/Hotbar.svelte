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

  const slots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
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
      return { item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued };
    }),
  );

  const leftSlots = $derived(slots.slice(0, 5));
  const rightSlots = $derived(slots.slice(5));
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
      <div class="hub-portrait" title={CLASSES[classId]?.name ?? "Adventurer"}>
        <span class="hub-icon">{classIcon}</span>
        <span class="hub-level">{game.self.level}</span>
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
    <div class="hotbar-row">
      {#each leftSlots as { item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued }, i (i)}
        <button
          type="button"
          class="rc-action-slot"
          class:active={i === game.selectedSlot}
          class:spell={spellId !== null}
          class:queued
          title={spellId ? spellDef(spellId).name : undefined}
          onclick={() => getGame()?.useHotbarSlot(i)}
        >
          {#if spellId}
            <IconGlyph value={spellIcon(spellId)} size={28} />
            {#if game.self?.castingSpell === spellId}<div class="casting"></div>{/if}
            {#if gcdFrac > 0 && cooldownFrac <= 0}<div class="gcd-dim" style="opacity: {gcdFrac}"></div>{/if}
            {#if cooldownFrac > 0}
              <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
              {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
            {/if}
            {#if queued}<div class="queue-pip"></div>{/if}
          {:else if item}
            <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
            {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {#if item.durability !== null && itemDef(item.itemId).maxDurability}
              <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
            {/if}
          {/if}
          <span class="num">{keyLabel(i)}</span>
        </button>
      {/each}

      <div class="row-gap"></div>

      {#each rightSlots as { item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued }, j (j + 5)}
        {@const i = j + 5}
        <button
          type="button"
          class="rc-action-slot"
          class:active={i === game.selectedSlot}
          class:spell={spellId !== null}
          class:queued
          title={spellId ? spellDef(spellId).name : undefined}
          onclick={() => getGame()?.useHotbarSlot(i)}
        >
          {#if spellId}
            <IconGlyph value={spellIcon(spellId)} size={28} />
            {#if game.self?.castingSpell === spellId}<div class="casting"></div>{/if}
            {#if gcdFrac > 0 && cooldownFrac <= 0}<div class="gcd-dim" style="opacity: {gcdFrac}"></div>{/if}
            {#if cooldownFrac > 0}
              <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
              {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
            {/if}
            {#if queued}<div class="queue-pip"></div>{/if}
          {:else if item}
            <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
            {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {#if item.durability !== null && itemDef(item.itemId).maxDurability}
              <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
            {/if}
          {/if}
          <span class="num">{keyLabel(i)}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

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
  .xp-strip {
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
    width: min(560px, 90vw);
    height: 6px;
    background: rgba(4, 5, 8, 0.85);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 2px;
    overflow: hidden;
    pointer-events: none;
    z-index: 6;
  }
  .xp-fill {
    height: 100%;
    background: linear-gradient(180deg, #9dff7a, #6fcf6a 50%, #3a8a3a);
    transition: width 0.3s ease-out;
    box-shadow: 0 0 8px rgba(111, 207, 106, 0.45);
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
  }
  .hub-icon {
    font-size: 24px;
    line-height: 1;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
  }
  .hub-level {
    position: absolute;
    bottom: -3px;
    right: -3px;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 50%;
    background: #1a1410;
    border: 1.5px solid var(--rc-gold);
    color: var(--rc-gold-bright);
    font-size: 10px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hotbar-plate {
    padding: 6px 8px;
    background: rgba(12, 10, 18, 0.55);
    border: 1px solid rgba(196, 163, 90, 0.28);
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
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
