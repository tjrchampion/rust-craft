<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon, mobIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import { itemDef, mobDef, TIER_NAMES } from "@rustcraft/shared";
  import type { QuestOfferInfo } from "@rustcraft/shared";

  const offer = $derived(game.questOffer);
  const visible = $derived((offer?.offers ?? []).filter((o) => o.status !== "turnedin"));

  const TIER_COLORS = ["#9a9a9a", "#8fd48f", "#5aa7e0", "#b98fe0", "#e0a15a"];

  let cursor = $state(0);
  $effect(() => {
    if (cursor >= visible.length) cursor = Math.max(0, visible.length - 1);
  });

  function objectiveText(o: QuestOfferInfo): string {
    const name = o.objectiveKind === "kill" ? mobDef(o.objectiveTarget).name : itemDef(o.objectiveTarget).name;
    const verb = o.objectiveKind === "kill" ? "Slay" : "Gather";
    return `${verb} ${o.objectiveCount} ${name}`;
  }

  function objectiveIcon(o: QuestOfferInfo): string {
    return o.objectiveKind === "kill" ? mobIcon(o.objectiveTarget) : itemIcon(o.objectiveTarget);
  }

  function close(): void {
    getGame()?.closeQuestDialog();
  }

  function acceptQuest(id: string): void {
    getGame()?.sendQuestAction("accept", id);
    close();
  }

  function turnInQuest(id: string): void {
    getGame()?.sendQuestAction("turnin", id);
    close();
  }

  function activate(): void {
    const o = visible[cursor];
    if (!o) return;
    if (o.status === "available") acceptQuest(o.id);
    else if (o.status === "complete") turnInQuest(o.id);
  }

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel) {
        close();
        return;
      }
      if (d.up) cursor = Math.max(0, cursor - 1);
      if (d.down) cursor = Math.min(visible.length - 1, cursor + 1);
      if (d.confirm) activate();
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hint = $derived(promptLabel("Ⓐ accept/turn in · Ⓑ close · d-pad select", "Click accept/turn in · click ✕ to close"));
</script>

{#if offer}
  <div class="backdrop">
    <div class="dialog rc-frame">
      <div class="header">
        <div class="npc-name">{offer.npcName}</div>
        <button class="close" onclick={close}>✕</button>
      </div>
      <div class="rc-divider"></div>

      {#if visible.length === 0}
        <div class="empty">No tasks right now. Come back later.</div>
      {/if}

      {#each visible as o, i (o.id)}
        <div class="quest" class:locked={o.status === "locked"} class:selected={i === cursor}>
          <div class="quest-top">
            <span class="quest-name">{o.name}</span>
            <span class="tier" style="color: {TIER_COLORS[o.tier]}">{TIER_NAMES[o.tier]}</span>
          </div>
          <div class="desc">{o.description}</div>
          <div class="objective">
            <span class="obj-icon"><IconGlyph value={objectiveIcon(o)} size={16} /></span>
            {objectiveText(o)}
            {#if o.status === "active" || o.status === "complete"}
              <span class="progress">({o.progress}/{o.objectiveCount})</span>
            {/if}
          </div>
          <div class="rewards">
            <span class="reward-xp">+{o.rewardXp} XP</span>
            {#each o.rewardItems as r (r.itemId)}
              <span class="reward-item"><IconGlyph value={itemIcon(r.itemId)} size={14} />{r.qty}</span>
            {/each}
          </div>

          {#if o.status === "available"}
            <button class="rc-btn primary" onclick={() => acceptQuest(o.id)}>Accept</button>
          {:else if o.status === "complete"}
            <button class="rc-btn primary" onclick={() => turnInQuest(o.id)}>Turn In</button>
          {:else if o.status === "active"}
            <div class="in-progress">In Progress</div>
          {:else if o.status === "locked"}
            <div class="locked-note">Requires level {o.minLevel}</div>
          {/if}
        </div>
      {/each}

      <button class="rc-btn close-btn" onclick={close}>Close</button>
      <div class="hint">{hint}</div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .dialog {
    width: 380px;
    max-height: 82vh;
    overflow-y: auto;
    padding: 18px 22px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .npc-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 18px;
    color: var(--rc-gold-bright);
  }
  .close {
    background: none;
    border: none;
    color: var(--rc-ink-dim);
    font-size: 16px;
    cursor: pointer;
    padding: 0;
  }
  .empty {
    color: var(--rc-ink-dim);
    font-size: 13px;
    text-align: center;
    padding: 12px 0;
  }
  .quest {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(201, 162, 75, 0.25);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .quest.locked {
    opacity: 0.55;
  }
  .quest.selected {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.25);
  }
  .hint {
    text-align: center;
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-top: 4px;
  }
  .quest-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .quest-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--rc-parchment);
  }
  .tier {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .desc {
    font-size: 12px;
    color: var(--rc-ink-dim);
    margin-bottom: 6px;
  }
  .objective {
    font-size: 13px;
    color: var(--rc-ink);
    margin-bottom: 6px;
  }
  .obj-icon {
    display: inline-flex;
    vertical-align: middle;
    margin-right: 4px;
  }
  .progress {
    color: var(--rc-gold);
    font-weight: 700;
    margin-left: 4px;
  }
  .rewards {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    margin-bottom: 8px;
  }
  .reward-xp {
    color: #b98fe0;
    font-weight: 700;
  }
  .reward-item {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--rc-ink-dim);
  }
  .in-progress {
    font-size: 11px;
    color: var(--rc-ink-dim);
    text-align: center;
    font-style: italic;
  }
  .locked-note {
    font-size: 11px;
    color: #ff8a80;
    text-align: center;
  }
  .quest .rc-btn {
    width: 100%;
    padding: 6px;
    font-size: 13px;
  }
  .close-btn {
    width: 100%;
    margin-top: 4px;
  }
</style>
