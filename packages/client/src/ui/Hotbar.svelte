<script lang="ts">
  import { game } from "./gameState.svelte";
  import { itemIcon, spellIcon, rewardChestIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import LevelUpModal from "./LevelUpModal.svelte";
  import { promptLabel } from "./padGlyphs";
  import { HOTBAR_SLOTS, itemDef, spellDef } from "@rustcraft/shared";

  let openChestId = $state<string | null>(null);
  const openChest = $derived(game.levelRewards.find((c) => c.id === openChestId) ?? null);

  const SPELL_PREFIX = "spell:";
  // Keyboard: 1-6, then Q/Z/X/C. Gamepad: every slot needs LB or RB as a
  // modifier since a controller has nowhere near 10 free buttons -- see the
  // full scheme documented on InputManager.lbHeldSince.
  const KBM_LABELS = ["1", "2", "3", "4", "5", "6", "Q", "Z", "X", "C"];
  const PAD_LABELS = ["LB+A", "LB+B", "LB+X", "LB+Y", "LB+↑", "LB+↓", "LB+←", "LB+→", "RB+A", "RB+B"];

  function keyLabel(i: number): string {
    return promptLabel(PAD_LABELS[i] ?? "", KBM_LABELS[i] ?? "");
  }

  // Cooldown sweeps need a periodic re-render since nothing else about the
  // slot changes while a spell is on cooldown -- a plain $derived wouldn't
  // recompute on its own between server snapshots.
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowTick = Date.now()), 100);
    return () => clearInterval(id);
  });

  // One unified action bar -- a slot either holds a real item (rendered as
  // before) or a spell marker ("spell:<id>", see the assignSpell flow in
  // CharacterScreen's Spell Book tab), rendered via the spell icon/name instead.
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
          // Approximate GCD length from remaining — display as soft dim, not a full CD.
          gcdFrac = gcdLeft > 0 ? Math.min(0.55, gcdLeft / 1500) : 0;
        }
      }
      const queued = spellId !== null && game.self?.queuedSpellId === spellId;
      return { item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued };
    }),
  );
</script>

<div class="hotbar">
  {#each slots as { item, spellId, cooldownFrac, cooldownLabel, gcdFrac, queued }, i (i)}
    <div
      class="slot"
      class:active={i === game.selectedSlot}
      class:spell={spellId !== null}
      class:queued
      class:first={i === 6}
      title={spellId ? spellDef(spellId).name : undefined}
    >
      {#if spellId}
        <IconGlyph value={spellIcon(spellId)} size={26} />
        {#if game.self?.castingSpell === spellId}
          <div class="casting"></div>
        {/if}
        {#if gcdFrac > 0 && cooldownFrac <= 0}
          <div class="gcd-dim" style="opacity: {gcdFrac}"></div>
        {/if}
        {#if cooldownFrac > 0}
          <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
          {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
        {/if}
        {#if queued}
          <div class="queue-pip"></div>
        {/if}
      {:else if item}
        <IconGlyph value={itemIcon(item.itemId)} size={26} itemId={item.itemId} />
        {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
        {#if item.durability !== null && itemDef(item.itemId).maxDurability}
          <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
        {/if}
      {/if}
      <span class="num">{keyLabel(i)}</span>
    </div>
  {/each}
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
  .hotbar {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  .slot {
    position: relative;
    width: 52px;
    height: 52px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.3)),
      rgba(14, 12, 9, 0.88);
    border: 2px solid var(--rc-gold-dim);
    outline: 1px solid rgba(0, 0, 0, 0.8);
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .slot.active {
    border-color: var(--rc-gold-bright);
    box-shadow:
      0 0 14px rgba(255, 214, 110, 0.45),
      inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .slot.spell {
    border-color: rgba(200, 120, 255, 0.55);
  }
  .slot.spell.queued {
    border-color: var(--rc-gold-bright);
    box-shadow:
      0 0 10px rgba(255, 214, 110, 0.35),
      inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .slot.spell.first {
    margin-left: 12px;
  }
  .gcd-dim {
    position: absolute;
    inset: 0;
    border-radius: 6px;
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
    background: var(--rc-gold-bright);
    box-shadow: 0 0 6px rgba(255, 214, 110, 0.8);
    pointer-events: none;
  }
  .qty {
    position: absolute;
    right: 4px;
    bottom: 2px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .num {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 10px;
    font-family: var(--rc-display);
    font-weight: 700;
    color: var(--rc-gold);
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
    border-radius: 6px;
    background: rgba(200, 120, 255, 0.3);
    animation: pulse 0.6s infinite alternate;
  }
  @keyframes pulse {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
  /* Radial wipe that recedes as the spell comes off cooldown -- --frac is
     1 right after casting and counts down to 0 when ready again. */
  .cooldown-sweep {
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background: conic-gradient(rgba(0, 0, 0, 0.78) calc(var(--frac) * 360deg), transparent 0);
    pointer-events: none;
  }
  .cooldown-label {
    position: absolute;
    font-family: var(--rc-display);
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 3px #000;
    pointer-events: none;
  }
  .reward-chests {
    position: absolute;
    bottom: 90px;
    right: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
  }
  .chest-button {
    position: relative;
    width: 60px;
    height: 60px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.4)),
      rgba(180, 100, 20, 0.4);
    border: 2px solid rgba(255, 180, 80, 0.6);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(255, 150, 50, 0.4), inset 0 0 8px rgba(0, 0, 0, 0.5);
    transition: all 0.2s;
    font-size: 0;
  }
  .chest-button:hover {
    border-color: rgb(255, 200, 100);
    box-shadow:
      0 0 20px rgba(255, 150, 50, 0.7),
      inset 0 0 8px rgba(0, 0, 0, 0.5);
    transform: scale(1.08);
  }
  .chest-button:active {
    transform: scale(0.96);
  }
  .chest-level {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 11px;
    font-family: var(--rc-display);
    font-weight: 700;
    color: #ffd700;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 4px;
    border-radius: 3px;
  }
</style>
