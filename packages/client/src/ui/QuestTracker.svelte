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

  function objectiveText(kind: "kill" | "gather", target: string): string {
    return kind === "kill" ? mobDef(target).name : itemDef(target).name;
  }

  const trackedQuests = $derived(
    game.questLog.filter((q) => !game.untrackedQuests.has(q.id))
  );
</script>

{#if game.questLog.length > 0}
  <div class="tracker">
    <div class="tracker-header">
      <div class="tracker-title">Quests</div>
      <button class="collapse-btn" onclick={toggleCollapsed}>
        {collapsed ? "[ + ]" : "[ - ]"}
      </button>
    </div>
    {#if !collapsed}
      <div class="entries">
        {#each trackedQuests as q (q.id)}
          <div class="entry" class:done={q.status === "complete"}>
            <div class="entry-name">{q.name}</div>
            <div class="entry-obj">
              {objectiveText(q.objectiveKind, q.objectiveTarget)}
              <span class="entry-count">{q.progress}/{q.objectiveCount}</span>
              {#if q.status === "complete"}<span class="ready">✓</span>{/if}
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
    top: 202px;
    right: 16px;
    width: 210px;
    padding: 6px 8px;
    pointer-events: auto;
  }
  .tracker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 4px;
  }
  .tracker-title {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    color: var(--rc-gold-bright);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 2px #000;
  }
  .collapse-btn {
    background: none;
    border: none;
    color: var(--rc-parchment);
    font-family: monospace;
    font-size: 11px;
    cursor: pointer;
    padding: 0 4px;
    text-shadow: 0 1px 2px #000;
    opacity: 0.6;
    transition: opacity 0.2s;
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
  .entry {
    background: rgba(0, 0, 0, 0.25);
    border-left: 2px solid var(--rc-gold);
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
  }
  .entry-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    color: var(--rc-parchment);
    text-shadow: 0 1px 2px #000;
  }
  .entry-obj {
    font-size: 11px;
    color: var(--rc-ink-dim);
    text-shadow: 0 1px 1px #000;
  }
  .entry-count {
    color: var(--rc-gold);
    font-weight: 700;
  }
  .entry.done {
    border-left-color: #8fd48f;
  }
  .entry.done .entry-obj {
    color: #8fd48f;
  }
  .ready {
    color: #ffd400;
    font-weight: 700;
    margin-left: 4px;
  }
  .no-tracked {
    font-size: 11px;
    color: var(--rc-ink-dim);
    font-style: italic;
    text-shadow: 0 1px 2px #000;
    padding-left: 4px;
  }
</style>
