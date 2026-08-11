<script lang="ts">
  import { game } from "./gameState.svelte";
  import { CLASSES, EQUIP_SLOTS, type ClassId } from "@rustcraft/shared";
  import CharacterThumbnail from "./CharacterThumbnail.svelte";

  const self = $derived(game.self);
  const classId = $derived((game.classId || "warrior") as ClassId);
  const className = $derived(CLASSES[classId]?.name ?? "Adventurer");
  const hpPct = $derived(self ? Math.min(100, (self.hp / Math.max(1, self.maxHp)) * 100) : 0);
  const manaPct = $derived(self ? Math.min(100, (self.mana / Math.max(1, self.maxMana)) * 100) : 0);
  // SelfState carries no appearance/equip fields -- those live on top-level
  // `game` state (gender/appearance) and in the equip-container slice of
  // game.inventory, same as the character-screen paperdoll.
  const portraitEquip = $derived.by(() => {
    const equip: Partial<Record<string, string>> = {};
    for (const item of game.inventory) {
      if (item.container !== "equip") continue;
      const slot = EQUIP_SLOTS[item.slot];
      if (slot) equip[slot] = item.itemId;
    }
    return equip;
  });
</script>

{#if self}
  <div class="unitframe">
    <div class="portrait" title={className}>
      <div class="portrait-avatar">
        <CharacterThumbnail
          classId={classId}
          gender={game.gender}
          appearance={game.appearance}
          equip={portraitEquip}
          mode="head"
          bareUnequipped
        />
      </div>
      <span class="level">{self.level}</span>
    </div>
    <div class="body">
      <div class="name-row">
        <span class="name">{game.selfName}</span>
      </div>
      <div class="rc-resource-bar hp angled" class:low={hpPct < 28}>
        <div class="fill" style="width: {hpPct}%"></div>
        <span class="label">{Math.round(hpPct)}%</span>
      </div>
      <div class="rc-resource-bar mana angled">
        <div class="fill" style="width: {manaPct}%"></div>
        <span class="label">{Math.round(manaPct)}%</span>
      </div>
      {#if game.underwater || self.oxygen < 99}
        <div
          class="rc-resource-bar oxygen angled"
          class:critical={self.oxygen < 25}
          title="Breath"
        >
          <div class="fill" style="width: {Math.min(100, self.oxygen)}%"></div>
          <span class="label">{Math.ceil(self.oxygen)} air</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .unitframe {
    position: absolute;
    left: 14px;
    top: 12px;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 0;
    pointer-events: none;
    min-width: 280px;
    z-index: 4;
  }
  .portrait {
    position: relative;
    width: 62px;
    height: 62px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 28%, #4a3558, #120e18 72%);
    border: 2px solid var(--rc-gold);
    outline: 2px solid rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 0 0 1px rgba(232, 200, 120, 0.35),
      0 0 18px rgba(160, 80, 200, 0.25),
      0 4px 14px rgba(0, 0, 0, 0.75),
      inset 0 0 14px rgba(0, 0, 0, 0.55);
    flex-shrink: 0;
  }
  .portrait-avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
  }
  .portrait-avatar :global(canvas) {
    width: 100% !important;
    height: 100% !important;
    border-radius: 50%;
    object-fit: cover;
  }
  .level {
    position: absolute;
    bottom: -2px;
    left: -2px;
    /* Fixed square → a true circle (min-width + padding made it an oval pill
       for 2-digit levels); z-index lifts it above the avatar canvas, which
       sits in its own stacking context and was covering it. */
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(180deg, #3a2e20, #1a1410);
    border: 1.5px solid var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    font-family: var(--rc-body);
    font-weight: 800;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
    z-index: 2;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #f4eef8;
    text-shadow: 0 1px 4px #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body :global(.rc-resource-bar) {
    height: 18px;
    width: 210px;
  }
  .oxygen {
    height: 11px !important;
  }
  .oxygen > :global(.fill) {
    background: linear-gradient(180deg, #7ee0ff, #2a7aa8);
  }
  .oxygen.critical > :global(.fill) {
    background: linear-gradient(180deg, #ff8a6a, #c43b2a);
    animation: oxygen-pulse 0.7s ease-in-out infinite;
  }
  .oxygen :global(.label) {
    font-size: 9px;
  }
  @keyframes oxygen-pulse {
    50% {
      opacity: 0.65;
    }
  }
</style>
