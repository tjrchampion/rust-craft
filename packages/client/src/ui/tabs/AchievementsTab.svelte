<script lang="ts">
  import { game } from "../gameState.svelte";
  import { itemDef } from "@rustcraft/shared";
</script>

<div class="achievements-tab">
  <h3>Achievements</h3>
  <p class="achievements-sub">
    {game.achievements.filter((a) => a.complete).length}/{game.achievements.length || 0} complete
  </p>
  <div class="achievement-list">
    {#each [...game.achievements].sort((a, b) => Number(a.complete) - Number(b.complete) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) as a (a.id)}
      <div class="achievement-row" class:complete={a.complete}>
        <div class="achievement-mark" aria-hidden="true">{a.complete ? "✓" : "◇"}</div>
        <div class="achievement-body">
          <div class="achievement-title-row">
            <span class="achievement-name">{a.name}</span>
            <span class="achievement-cat">{a.category}</span>
            {#if a.complete}
              <span class="achievement-done">Complete</span>
            {/if}
          </div>
          <div class="achievement-desc">{a.description}</div>
          <div class="achievement-req">Requires: {a.requirement}</div>
          <div class="achievement-progress">
            <div class="achievement-bar">
              <div
                class="achievement-fill"
                style="width: {a.target > 0 ? Math.min(100, (a.progress / a.target) * 100) : 0}%"
              ></div>
            </div>
            <span class="achievement-count">{a.progress}/{a.target}</span>
          </div>
          <div class="achievement-rewards">
            Reward: +{a.rewardXp} XP
            {#each a.rewardItems as r (r.itemId + ":" + r.qty)}
              · {r.qty}× {itemDef(r.itemId).name}
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="empty-quests">No achievements synced yet.</div>
    {/each}
  </div>
</div>

<style>
  .achievements-tab {
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
  .achievements-sub {
    font-size: 12px;
    color: #9fb0c4;
    margin: 0 0 10px;
  }
  .achievement-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .achievement-row {
    display: flex;
    gap: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 10px 14px;
    align-items: flex-start;
  }
  .achievement-row.complete {
    border-color: rgba(123, 216, 143, 0.45);
    background: rgba(123, 216, 143, 0.06);
  }
  .achievement-mark {
    font-size: 16px;
    color: var(--rc-gold-dim);
    line-height: 1.2;
  }
  .achievement-row.complete .achievement-mark {
    color: #7bd88f;
  }
  .achievement-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .achievement-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .achievement-name {
    font-weight: 700;
    font-size: 13.5px;
    color: #fff;
  }
  .achievement-cat {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--rc-gold-dim);
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .achievement-done {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    color: #7bd88f;
  }
  .achievement-desc {
    font-size: 12px;
    color: #cbd5e1;
  }
  .achievement-req {
    font-size: 11px;
    color: #94a3b8;
  }
  .achievement-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
  }
  .achievement-bar {
    flex: 1;
    height: 6px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 3px;
    overflow: hidden;
  }
  .achievement-fill {
    height: 100%;
    background: var(--rc-gold);
    border-radius: 3px;
  }
  .achievement-row.complete .achievement-fill {
    background: #7bd88f;
  }
  .achievement-count {
    font-size: 11px;
    color: #94a3b8;
    min-width: 40px;
  }
  .achievement-rewards {
    font-size: 11px;
    color: var(--rc-gold-bright);
    margin-top: 2px;
  }
  .empty-quests {
    color: #7a8b9e;
    font-style: italic;
    font-size: 13px;
    padding: 16px 0;
  }
</style>
