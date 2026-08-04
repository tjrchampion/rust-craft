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
    if (o.objectiveKind === "escort") {
      return `Escort NPC safely to destination`;
    }
    let name = o.objectiveTarget;
    try {
      if (o.objectiveKind === "kill") name = mobDef(o.objectiveTarget).name;
      else if (o.objectiveKind === "gather") name = itemDef(o.objectiveTarget).name;
    } catch {
      name = o.objectiveTarget;
    }
    const verb = o.objectiveKind === "kill" ? "Slay" : "Gather";
    return `${verb} ${o.objectiveCount} ${name}`;
  }

  function objectiveIcon(o: QuestOfferInfo): string {
    if (o.objectiveKind === "escort") return "🛡️";
    try {
      return o.objectiveKind === "kill" ? mobIcon(o.objectiveTarget) : itemIcon(o.objectiveTarget);
    } catch {
      return "📜";
    }
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

  const hint = $derived(promptLabel("Ⓐ accept/turn in · Ⓑ close · d-pad select", "Click accept/turn in · Esc to close"));
  const active = $derived(visible[cursor] ?? null);
</script>

{#if offer}
  <div class="backdrop">
    <div class="dialog rc-frame">
      <div class="rc-panel-header">
        <h2 class="rc-frame-title">Dialog</h2>
        <button class="rc-close" onclick={close} aria-label="Close">✕</button>
      </div>

      <div class="npc-line">{offer.npcName}</div>

      {#if visible.length === 0}
        <div class="empty">No tasks right now. Come back later.</div>
      {:else if active}
        <div class="quest-title">
          <span class="bang">!</span>
          {active.name}
          <span class="tier" style="color: {TIER_COLORS[active.tier]}">{TIER_NAMES[active.tier]}</span>
        </div>
        <p class="desc">{active.description}</p>

        <ul class="objectives">
          <li>
            <span class="obj-icon"><IconGlyph value={objectiveIcon(active)} size={16} /></span>
            {objectiveText(active)}
            {#if active.status === "active" || active.status === "complete"}
              <span class="progress">({active.progress}/{active.objectiveCount})</span>
            {/if}
          </li>
        </ul>

        <div class="rewards-block">
          <div class="rewards-label">Rewards</div>
          <div class="rc-divider"></div>
          <div class="rewards">
            <span class="reward-xp">+{active.rewardXp} XP</span>
            {#each active.rewardItems as r (r.itemId)}
              <div class="reward-slot" title={itemDef(r.itemId).name}>
                <IconGlyph value={itemIcon(r.itemId)} size={28} itemId={r.itemId} />
                {#if r.qty > 1}<span class="qty">{r.qty}</span>{/if}
              </div>
            {/each}
          </div>
        </div>

        {#if active.status === "available"}
          <button class="rc-btn primary accept" onclick={() => acceptQuest(active.id)}>Accept</button>
        {:else if active.status === "complete"}
          <button class="rc-btn primary accept" onclick={() => turnInQuest(active.id)}>Turn In</button>
        {:else if active.status === "active"}
          <div class="in-progress">In Progress</div>
        {:else if active.status === "locked"}
          <div class="locked-note">Requires level {active.minLevel}</div>
        {/if}

        {#if visible.length > 1}
          <div class="quest-picks">
            {#each visible as o, i (o.id)}
              <button
                type="button"
                class="pick"
                class:on={i === cursor}
                class:locked={o.status === "locked"}
                onclick={() => (cursor = i)}
              >
                {o.name}
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      <div class="hint">{hint}</div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(8, 4, 14, 0.62);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    z-index: 40;
  }
  .dialog {
    width: 380px;
    max-height: 82vh;
    overflow-y: auto;
    padding: 8px 22px 18px;
  }
  .npc-line {
    text-align: center;
    font-size: 12px;
    color: var(--rc-ink-dim);
    margin-bottom: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .empty {
    color: var(--rc-ink-dim);
    font-size: 13px;
    text-align: center;
    padding: 20px 0;
  }
  .quest-title {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--rc-ink);
    margin-bottom: 10px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .bang {
    color: var(--rc-gold-bright);
    font-size: 20px;
    line-height: 1;
  }
  .tier {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .desc {
    font-size: 13px;
    line-height: 1.55;
    color: var(--rc-ink-dim);
    margin: 0 0 14px;
  }
  .objectives {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .objectives li {
    font-size: 13px;
    color: var(--rc-ink);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .obj-icon {
    display: inline-flex;
  }
  .progress {
    color: var(--rc-gold);
    font-weight: 700;
  }
  .rewards-block {
    margin-bottom: 16px;
  }
  .rewards-label {
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-gold);
    text-align: center;
  }
  .rewards-block :global(.rc-divider) {
    margin: 8px 0 12px;
  }
  .rewards {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }
  .reward-xp {
    color: var(--rc-magenta-bright);
    font-weight: 800;
    font-size: 13px;
  }
  .reward-slot {
    position: relative;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 3px;
    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
  }
  .qty {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 10px;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .accept {
    display: block;
    width: 70%;
    margin: 0 auto 10px;
    padding: 12px 20px;
    font-size: 15px;
  }
  .in-progress,
  .locked-note {
    text-align: center;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .in-progress { color: var(--rc-ink-dim); font-style: italic; }
  .locked-note { color: #ff8a80; }
  .quest-picks {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    border-top: 1px solid rgba(196, 163, 90, 0.2);
    padding-top: 10px;
  }
  .pick {
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: var(--rc-ink-dim);
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .pick.on {
    background: rgba(80, 40, 110, 0.35);
    border-color: rgba(196, 163, 90, 0.4);
    color: var(--rc-ink);
  }
  .pick.locked { opacity: 0.5; }
  .hint {
    text-align: center;
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-top: 8px;
  }
</style>
