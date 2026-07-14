<script lang="ts">
  import { game } from "./gameState.svelte";
  import { itemDef, mobDef } from "@rustcraft/shared";

  function objectiveText(kind: "kill" | "gather", target: string): string {
    return kind === "kill" ? mobDef(target).name : itemDef(target).name;
  }
</script>

{#if game.questLog.length > 0}
  <div class="tracker rc-frame">
    <div class="tracker-title rc-frame-title">Quests</div>
    {#each game.questLog as q (q.id)}
      <div class="entry" class:done={q.status === "complete"}>
        <div class="entry-name">{q.name}</div>
        <div class="entry-obj">
          {objectiveText(q.objectiveKind, q.objectiveTarget)}
          <span class="entry-count">{q.progress}/{q.objectiveCount}</span>
          {#if q.status === "complete"}<span class="ready">✓</span>{/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .tracker {
    position: absolute;
    top: 202px;
    right: 16px;
    width: 210px;
    padding: 10px 12px;
    pointer-events: none;
  }
  .tracker-title {
    margin-bottom: 6px;
  }
  .entry {
    margin-bottom: 8px;
  }
  .entry:last-child {
    margin-bottom: 0;
  }
  .entry-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    color: var(--rc-parchment);
  }
  .entry-obj {
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
  .entry-count {
    color: var(--rc-gold);
    font-weight: 700;
  }
  .entry.done .entry-obj {
    color: #8fd48f;
  }
  .ready {
    color: #ffd400;
    font-weight: 700;
    margin-left: 4px;
  }
</style>
