<script lang="ts">
  import { game } from "./gameState.svelte";
  import { itemIcon, spellIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import { HOTBAR_SLOTS, itemDef, spellDef } from "@rustcraft/shared";

  const SPELL_PREFIX = "spell:";
  const KEY_LABELS = ["1", "2", "3", "4", "5", "6"];
  // Slots 6-9 (Q/Z/X/C) are also reachable on gamepad: 6 = bare Y tap, 7-9 = LB-hold chord.
  const PAD_LABELS = ["Y", "LB+B", "LB+X", "LB+Y"];
  const KBM_LETTER_LABELS = ["Q", "Z", "X", "C"];

  function keyLabel(i: number): string {
    if (i < 6) return KEY_LABELS[i]!;
    return promptLabel(PAD_LABELS[i - 6] ?? "", KBM_LETTER_LABELS[i - 6] ?? "");
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
      if (spellId) {
        const total = spellDef(spellId).cooldownS;
        const entry = game.self?.spellCooldowns.find((c) => c.spellId === spellId);
        if (entry && total > 0) {
          const remaining = Math.max(0, (entry.readyAt - nowTick) / 1000);
          cooldownFrac = Math.min(1, remaining / total);
          if (remaining > 0.05) cooldownLabel = remaining >= 10 ? String(Math.ceil(remaining)) : remaining.toFixed(1);
        }
      }
      return { item, spellId, cooldownFrac, cooldownLabel };
    }),
  );
</script>

<div class="hotbar">
  {#each slots as { item, spellId, cooldownFrac, cooldownLabel }, i (i)}
    <div
      class="slot"
      class:active={i === game.selectedSlot}
      class:spell={spellId !== null}
      class:first={i === 6}
      title={spellId ? spellDef(spellId).name : undefined}
    >
      {#if spellId}
        <IconGlyph value={spellIcon(spellId)} size={26} />
        {#if game.self?.castingSpell === spellId}
          <div class="casting"></div>
        {/if}
        {#if cooldownFrac > 0}
          <div class="cooldown-sweep" style="--frac: {cooldownFrac}"></div>
          {#if cooldownLabel}<span class="cooldown-label">{cooldownLabel}</span>{/if}
        {/if}
      {:else if item}
        <IconGlyph value={itemIcon(item.itemId)} size={26} />
        {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
        {#if item.durability !== null && itemDef(item.itemId).maxDurability}
          <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
        {/if}
      {/if}
      <span class="num">{keyLabel(i)}</span>
    </div>
  {/each}
</div>

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
  .slot.spell.first {
    margin-left: 12px;
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
</style>
