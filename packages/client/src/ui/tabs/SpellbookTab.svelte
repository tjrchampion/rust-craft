<script lang="ts">
  import { getGame } from "../../game/instance";
  import { itemIcon, spellIcon } from "../icons";
  import IconGlyph from "../IconGlyph.svelte";
  import { itemDef, type ItemSnap, type SpellDef } from "@rustcraft/shared";

  let {
    spellsToShow,
    spellDef,
    isSpellLocked,
    spellLockReason,
    spellElements = $bindable([]),
    hotbarElements = $bindable([]),
    hotbarSlots,
    spellBookFocus = $bindable("spells"),
    spellCursor = $bindable(0),
    spellHotbarCursor = $bindable(0),
    movingSpell = $bindable(null),
    spellHotbarPage = $bindable(0),
    slotSpellId,
    clearHotbarSpell,
    pickSpell,
    activateHotbarForSpell,
    showTooltip,
    hideTooltip,
  }: {
    spellsToShow: string[];
    spellDef: (id: string) => SpellDef;
    isSpellLocked: (id: string) => boolean;
    spellLockReason: (id: string) => string;
    spellElements?: (HTMLButtonElement | null)[];
    hotbarElements?: (HTMLButtonElement | null)[];
    hotbarSlots: (ItemSnap | undefined)[];
    spellBookFocus?: "spells" | "hotbar";
    spellCursor?: number;
    spellHotbarCursor?: number;
    movingSpell?: string | null;
    spellHotbarPage?: number;
    slotSpellId: (slotIndex: number) => string | null;
    clearHotbarSpell: (slotIndex: number, e: MouseEvent) => void;
    pickSpell: (spellId: string) => void;
    activateHotbarForSpell: (slotIndex: number) => void;
    showTooltip: (spellId: string, e: MouseEvent) => void;
    hideTooltip: () => void;
  } = $props();

  const currentSpellbookHotbarSlots = $derived(
    Array.from({ length: 10 }, (_, i) => {
      const slotIndex = spellHotbarPage * 10 + i;
      return { item: hotbarSlots[slotIndex], slotIndex, displayIndex: i };
    })
  );
</script>

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
        draggable={!locked}
        ondragstart={(e) => {
          e.dataTransfer?.setData("text/plain", JSON.stringify({ container: "spellbook", spellId }));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
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
  <div class="spellbook-hotbar-header">
    <h3>Hotbar Action Slots</h3>
    <div class="page-segmented">
      <button type="button" class="page-tab" class:active={spellHotbarPage === 0} onclick={() => (spellHotbarPage = 0)}>Page 1</button>
      <button type="button" class="page-tab" class:active={spellHotbarPage === 1} onclick={() => (spellHotbarPage = 1)}>Page 2</button>
      <button type="button" class="page-tab" class:active={spellHotbarPage === 2} onclick={() => (spellHotbarPage = 2)}>Page 3</button>
    </div>
  </div>
  <div class="hotbar-row roomy">
    {#each currentSpellbookHotbarSlots as { item, slotIndex, displayIndex } (slotIndex)}
      {@const spellId = slotSpellId(slotIndex)}
      <button
        bind:this={hotbarElements[slotIndex]}
        class="cell big"
        class:spell={spellId !== null}
        class:moving={spellId !== null && movingSpell === spellId}
        class:cursor={spellBookFocus === "hotbar" && spellHotbarCursor === slotIndex}
        class:first={displayIndex === 6}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => {
          e.preventDefault();
          if (movingSpell) {
            getGame()?.sendAssignSpell(movingSpell, slotIndex);
            movingSpell = null;
          } else {
            const rawData = e.dataTransfer?.getData("text/plain");
            if (rawData) {
              try {
                const data = JSON.parse(rawData);
                if (data.spellId) getGame()?.sendAssignSpell(data.spellId, slotIndex);
              } catch {}
            }
          }
        }}
        onclick={() => {
          spellBookFocus = "hotbar";
          spellHotbarCursor = slotIndex;
          activateHotbarForSpell(slotIndex);
        }}
      >
        {#if spellId}
          <IconGlyph value={spellIcon(spellId)} size={28} />
          <span class="clear" onclick={(e) => clearHotbarSpell(slotIndex, e)}>✕</span>
        {:else if item}
          <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
        {/if}
        <span class="num">{slotIndex + 1}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .spellbook-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
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
  .spellbook-hotbar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    margin-bottom: 6px;
  }
  .spellbook-hotbar-header h3 {
    margin: 0;
  }
  .page-segmented {
    display: flex;
    gap: 4px;
  }
  .page-tab {
    background: linear-gradient(180deg, #2b1f35, #140d1a);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-gold-dim);
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .page-tab:hover,
  .page-tab.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: linear-gradient(180deg, #4a355c, #20132c);
    box-shadow: 0 0 8px rgba(196, 163, 90, 0.4);
  }
  .hotbar-row.roomy {
    gap: 8px;
    margin-top: 4px;
    display: flex;
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
  .cell.big {
    width: 52px;
    height: 52px;
  }
  .cell.big.first {
    margin-left: 16px;
  }
  .cell.spell {
    border-color: rgba(200, 120, 255, 0.55);
  }
  .cell.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .cell.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
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
</style>
