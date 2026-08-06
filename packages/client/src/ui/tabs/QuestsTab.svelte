<script lang="ts">
  import { game } from "../gameState.svelte";
  import { getGame } from "../../game/instance";
  import { itemDef } from "@rustcraft/shared";

  let {
    questsCursor = $bindable(0),
    questSubFocus = $bindable("track"),
    objectiveText,
  }: {
    questsCursor?: number;
    questSubFocus?: "track" | "share";
    objectiveText: (kind: string, target: string) => string;
  } = $props();
</script>

<div class="quests-tab">
  <h3>Active Quests</h3>
  <div class="quest-list">
    {#each game.questLog as q, i (q.id)}
      <div
        class="quest-row"
        class:row-active={questsCursor === i}
      >
        <!-- Tracking toggle -->
        <button
          class="quest-row-main"
          class:sub-cursor={questsCursor === i && questSubFocus === "track"}
          onclick={() => {
            questsCursor = i;
            questSubFocus = "track";
            game.toggleQuestTrack(q.id);
          }}
        >
          <div class="quest-row-title">
            <span class="quest-row-check">{game.untrackedQuests.has(q.id) ? "☐" : "☑"}</span>
            <span class="quest-row-name" class:done={q.status === "complete"}>{q.name}</span>
            <span class="quest-row-status" class:done={q.status === "complete"}>
              {q.status === "complete" ? "Complete" : "In Progress"}
            </span>
          </div>
          <div class="quest-row-desc">
            {objectiveText(q.objectiveKind, q.objectiveTarget)}
            <span class="quest-row-count">({q.progress}/{q.objectiveCount})</span>
          </div>
        </button>

        <!-- Actions -->
        <div class="quest-row-actions">
          {#if game.party && game.party.length > 0}
            <button
              class="rc-btn share-btn"
              class:selected={questsCursor === i && questSubFocus === "share"}
              disabled={q.status === "complete"}
              onclick={() => {
                questsCursor = i;
                questSubFocus = "share";
                getGame()?.sendShareQuest(q.id);
              }}
            >
              Share
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty-quests">No active quests. Visit NPCs in towns to accept tasks.</div>
    {/each}
  </div>
</div>

<style>
  .quests-tab {
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
  .quest-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .quest-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 10px 14px;
    gap: 12px;
  }
  .quest-row.row-active {
    border-color: rgba(255, 214, 110, 0.4);
  }
  .quest-row-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: inherit;
    flex: 1;
    padding: 0;
  }
  .quest-row-main.sub-cursor {
    outline: 2px solid #ffd66e;
    border-radius: 4px;
  }
  .quest-row-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .quest-row-check {
    font-size: 14px;
    color: var(--rc-gold);
  }
  .quest-row-name {
    font-weight: 700;
    font-size: 13.5px;
    color: #fff;
  }
  .quest-row-name.done {
    color: #7bd88f;
  }
  .quest-row-status {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    color: var(--rc-gold-dim);
  }
  .quest-row-status.done {
    color: #7bd88f;
  }
  .quest-row-desc {
    font-size: 12px;
    color: #9fb0c4;
  }
  .quest-row-count {
    color: var(--rc-parchment);
    margin-left: 4px;
  }
  .quest-row-actions {
    display: flex;
    gap: 6px;
  }
  .share-btn {
    padding: 5px 12px;
    font-size: 12px;
  }
  .empty-quests {
    color: #7a8b9e;
    font-style: italic;
    font-size: 13px;
    padding: 16px 0;
  }
</style>
