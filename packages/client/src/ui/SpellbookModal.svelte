<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { spellIcon, itemIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import { HOTBAR_SLOTS, spellDef, auraDef, itemDef, type SpellDef } from "@rustcraft/shared";

  const SPELL_PREFIX = "spell:";

  let cursor = $state(0);
  /** The spell picked up (from the list or an already-slotted hotbar cell),
   *  waiting for a hotbar slot to land on. Both origins use the same
   *  sendAssignSpell round-trip -- the server already purges whichever slot
   *  the spell previously occupied, so re-picking a slotted spell to move it
   *  needs no separate "move" message. */
  let moving = $state<string | null>(null);

  const learnedSpells = $derived(game.learnedSpells);
  const hotbarSlots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) => game.inventory.find((it) => it.container === "hotbar" && it.slot === i)),
  );

  function close(): void {
    game.spellbookOpen = false;
    getGame()?.setUiMode(false);
  }

  function pick(spellId: string): void {
    moving = moving === spellId ? null : spellId;
  }

  function slotSpellId(idx: number): string | null {
    const item = hotbarSlots[idx];
    return item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
  }

  function activateSlot(idx: number): void {
    const g = getGame();
    if (!g) return;
    if (moving) {
      g.sendAssignSpell(moving, idx);
      moving = null;
      return;
    }
    const existing = slotSpellId(idx);
    if (existing) moving = existing;
  }

  function clearSlot(idx: number, e: MouseEvent): void {
    e.stopPropagation();
    getGame()?.sendAssignSpell(null, idx);
    if (moving && slotSpellId(idx) === moving) moving = null;
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

  function nav(dx: number, dy: number): void {
    if (dy !== 0) cursor = Math.min(learnedSpells.length - 1, Math.max(0, cursor + dy));
  }

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel) {
        if (moving) moving = null;
        else close();
        return;
      }
      if (d.up) nav(0, -1);
      if (d.down) nav(0, 1);
      if (d.confirm) {
        const spellId = learnedSpells[cursor];
        if (spellId) pick(spellId);
      }
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hintKeys = $derived(
    promptLabel("Ⓐ pick/place · Ⓑ close · d-pad navigate", "Click to pick, click a slot to place · Esc close"),
  );
</script>

<div class="panel-bg">
  <div class="spellbook-panel">
    <div class="header">
      <h2>Spellbook</h2>
      <button class="close-btn" onclick={close}>✕</button>
    </div>
    <div class="body">
      <div class="list">
        {#each learnedSpells as spellId, i (spellId)}
          {@const spell = spellDef(spellId)}
          <button
            class="spell-card"
            class:cursor={cursor === i}
            class:moving={moving === spellId}
            onclick={() => {
              cursor = i;
              pick(spellId);
            }}
          >
            <IconGlyph value={spellIcon(spellId)} size={30} />
            <span class="name">{spell.name}</span>
            <div class="tooltip">
              <div class="tt-title">{spell.name}</div>
              <div class="tt-stats">
                <span>Cast: {spell.castTimeS > 0 ? `${spell.castTimeS}s` : "Instant"}</span>
                <span>Cost: {spell.resourceCost}</span>
                <span>Cooldown: {spell.cooldownS}s</span>
                <span>{targetLabel(spell)}</span>
              </div>
              <div class="tt-effects">
                {#each effectLines(spell) as line (line)}
                  <div class="tt-effect">{line}</div>
                {/each}
              </div>
            </div>
          </button>
        {/each}
      </div>
    </div>
    <h3>Hotbar</h3>
    <div class="hotbar-row">
      {#each hotbarSlots as item, i (i)}
        {@const spellId = slotSpellId(i)}
        <button
          class="slot"
          class:spell={spellId !== null}
          class:moving={spellId !== null && moving === spellId}
          class:first={i === 6}
          onclick={() => activateSlot(i)}
        >
          {#if spellId}
            <IconGlyph value={spellIcon(spellId)} size={24} />
            <span class="clear" onclick={(e) => clearSlot(i, e)}>✕</span>
          {:else if item}
            <IconGlyph value={itemIcon(item.itemId)} size={24} />
          {/if}
        </button>
      {/each}
    </div>
    <div class="hints">{hintKeys}</div>
  </div>
</div>

<style>
  .panel-bg {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .spellbook-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 420px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25)),
      var(--rc-panel);
    border: 1px solid var(--rc-gold-dim);
    outline: 1px solid rgba(0, 0, 0, 0.8);
    box-shadow:
      inset 0 0 0 1px rgba(255, 224, 150, 0.08),
      0 10px 40px rgba(0, 0, 0, 0.55);
    border-radius: 8px;
    padding: 18px 22px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-family: var(--rc-display);
    font-size: 18px;
    letter-spacing: 1px;
    color: var(--rc-gold-bright);
  }
  .close-btn {
    background: none;
    border: none;
    color: #9fb0c4;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
  }
  .close-btn:hover {
    color: #fff;
  }
  h3 {
    margin: 4px 0 2px;
    font-family: var(--rc-display);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
  .body {
    max-height: 320px;
    overflow-y: auto;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .spell-card {
    position: relative;
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
  .spell-card.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .spell-card.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .spell-card .name {
    font-size: 13px;
    font-weight: 600;
  }
  .tooltip {
    display: none;
    position: absolute;
    left: calc(100% + 10px);
    top: 0;
    z-index: 20;
    width: 240px;
    background: rgba(10, 12, 18, 0.97);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    text-align: left;
    pointer-events: none;
  }
  .spell-card:hover .tooltip {
    display: block;
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
  .hotbar-row {
    display: flex;
    gap: 5px;
  }
  .slot {
    position: relative;
    width: 42px;
    height: 42px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .slot.spell {
    border-color: rgba(200, 120, 255, 0.55);
  }
  .slot.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .slot.first {
    margin-left: 10px;
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
  .hints {
    margin-top: 4px;
    font-size: 11px;
    color: #9fb0c4;
    text-shadow: 0 1px 3px #000;
  }
</style>
