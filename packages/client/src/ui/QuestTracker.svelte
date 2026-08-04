<script lang="ts">
  import { game } from "./gameState.svelte";
  import { itemDef, mobDef } from "@rustcraft/shared";

  let collapsed = $state(
    typeof localStorage !== "undefined" ? localStorage.getItem("rc:quests-collapsed") === "true" : false
  );

  function toggleCollapsed(): void {
    collapsed = !collapsed;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc:quests-collapsed", String(collapsed));
    }
  }

  function objectiveText(kind: string, target: string): string {
    if (kind === "escort") return "Escort NPC";
    try {
      return kind === "kill" ? mobDef(target).name : itemDef(target).name;
    } catch {
      return target;
    }
  }

  const trackedQuests = $derived(
    game.questLog.filter((q) => !game.untrackedQuests.has(q.id))
  );
</script>

{#if game.questLog.length > 0}
  <div class="tracker">
    <div class="tracker-header">
      <div class="tracker-title">Objectives</div>
      <button class="collapse-btn" onclick={toggleCollapsed} aria-label={collapsed ? "Expand" : "Collapse"}>
        {collapsed ? "▸" : "▾"}
      </button>
    </div>
    {#if !collapsed}
      <div class="entries">
        {#each trackedQuests as q (q.id)}
          <div class="entry" class:done={q.status === "complete"}>
            <div class="entry-name">{q.name}</div>
            <div class="entry-obj">
              <span class="bullet" class:on={q.status === "complete"}>{q.status === "complete" ? "✓" : "•"}</span>
              {objectiveText(q.objectiveKind, q.objectiveTarget)}
              <span class="entry-count">{q.progress}/{q.objectiveCount}</span>
            </div>
          </div>
        {:else}
          <div class="no-tracked">No tracked quests</div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tracker {
    position: absolute;
    top: 214px;
    right: 14px;
    width: 220px;
    padding: 8px 4px;
    pointer-events: auto;
    z-index: 4;
  }
  .tracker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(196, 163, 90, 0.28);
  }
  .tracker-title {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    color: var(--rc-gold);
    text-transform: uppercase;
    letter-spacing: 2px;
    text-shadow: 0 1px 3px #000;
  }
  .collapse-btn {
    background: none;
    border: none;
    color: var(--rc-gold);
    font-size: 12px;
    cursor: pointer;
    padding: 0 4px;
    opacity: 0.75;
  }
  .collapse-btn:hover {
    opacity: 1;
    color: var(--rc-gold-bright);
  }
  .entries {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .entry-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    color: #f0eaf6;
    text-shadow: 0 1px 3px #000;
    margin-bottom: 2px;
  }
  .entry-obj {
    font-size: 11px;
    color: #c8c0d4;
    text-shadow: 0 1px 2px #000;
    display: flex;
    align-items: baseline;
    gap: 5px;
    flex-wrap: wrap;
  }
  .bullet {
    color: var(--rc-ink-dim);
    font-weight: 800;
  }
  .bullet.on {
    color: #8fd48f;
  }
  .entry-count {
    color: var(--rc-gold-bright);
    font-weight: 700;
  }
  .entry.done .entry-name {
    color: #c5d4c5;
  }
  .entry.done .entry-obj {
    color: #8fd48f;
  }
  .no-tracked {
    font-size: 11px;
    color: var(--rc-ink-dim);
    font-style: italic;
    text-shadow: 0 1px 2px #000;
  }
</style>
