<script lang="ts">
  import { onMount } from "svelte";
  import { app, type CharacterSummary } from "./appState.svelte";
  import Logo from "./Logo.svelte";
  import { CLASSES, CLASS_IDS, spellDef, type ClassId } from "@rustcraft/shared";
  import { ClassPreviewScene } from "../render/ClassPreviewScene";
  import { CLASS_ICONS } from "../render/classModels";

  let mode = $state<"select" | "create">("select");
  let modeInitialized = false;

  let newName = $state("");
  let selectedCharacterId = $state<string | null>(null);
  let selectedClassId = $state<ClassId | null>(null);
  let hoveredClassId = $state<ClassId | null>(null);

  const characters = $derived(app.me?.characters ?? []);
  const activeCharacter = $derived(characters.find((c) => c.id === selectedCharacterId) ?? null);
  const previewClass = $derived(CLASSES[hoveredClassId ?? selectedClassId ?? CLASS_IDS[0]!]);
  const stageClassId = $derived<ClassId>(
    mode === "select"
      ? ((activeCharacter?.classId as ClassId) ?? CLASS_IDS[0]!)
      : (hoveredClassId ?? selectedClassId ?? CLASS_IDS[0]!),
  );

  // Default into whichever mode makes sense once the roster has loaded, without
  // fighting the player if they've already toggled it manually.
  $effect(() => {
    if (!modeInitialized && app.me) {
      mode = characters.length > 0 ? "select" : "create";
      modeInitialized = true;
    }
  });

  // Keep the highlighted roster row valid as the list loads/changes.
  $effect(() => {
    if (mode === "select" && characters.length > 0 && !characters.some((c) => c.id === selectedCharacterId)) {
      selectedCharacterId = characters[0]!.id;
    }
  });

  let canvas: HTMLCanvasElement;
  let scene: ClassPreviewScene | null = null;

  onMount(() => {
    scene = new ClassPreviewScene(canvas);
    void scene.preloadAll().then(() => scene?.setClass(stageClassId));
    const onResize = () => scene?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      scene?.dispose();
    };
  });

  $effect(() => {
    scene?.setClass(stageClassId);
  });

  function selectCharacter(character: CharacterSummary): void {
    selectedCharacterId = character.id;
    scene?.flourish();
  }

  function selectClass(id: ClassId): void {
    selectedClassId = id;
    scene?.flourish();
  }

  function enterSelected(): void {
    if (activeCharacter) app.enterWorld(activeCharacter);
  }

  async function createSelected(): Promise<void> {
    if (!newName.trim() || !selectedClassId) return;
    const createdName = newName.trim();
    await app.createCharacter(newName, selectedClassId);
    if (!app.error) {
      newName = "";
      mode = "select";
      const created = characters.find((c) => c.name === createdName);
      if (created) selectedCharacterId = created.id;
    }
  }

  // --- Lightweight gamepad support -----------------------------------
  // No InputManager exists before entering the world (Game.ts only builds
  // one after the player is already in a world), so this screen polls the
  // gamepad itself rather than pulling in that whole machinery for a single
  // vertical list + confirm/cancel. Name entry still needs a real keyboard,
  // same reasoning as chat in-game -- A only ever picks a class, never
  // submits the create form.
  const GAMEPAD_DEADZONE = 0.35;
  let padRafId = 0;
  let prevPadButtons: boolean[] = [];
  let prevAxisY = 0;

  function moveSelection(delta: number): void {
    if (mode === "select") {
      if (characters.length === 0) return;
      const idx = characters.findIndex((c) => c.id === selectedCharacterId);
      const next = ((idx < 0 ? 0 : idx) + delta + characters.length) % characters.length;
      selectCharacter(characters[next]!);
    } else {
      const idx = CLASS_IDS.findIndex((id) => id === (selectedClassId ?? hoveredClassId));
      const next = ((idx < 0 ? 0 : idx) + delta + CLASS_IDS.length) % CLASS_IDS.length;
      selectClass(CLASS_IDS[next]!);
    }
  }

  function confirmSelection(): void {
    if (mode === "select") enterSelected();
  }

  function cancelSelection(): void {
    if (mode === "create" && characters.length > 0) mode = "select";
  }

  function pollGamepad(): void {
    padRafId = requestAnimationFrame(pollGamepad);
    const pad = navigator.getGamepads?.()[0];
    if (!pad) return;
    const pressed = (i: number) => (pad.buttons[i]?.pressed ?? false) && !(prevPadButtons[i] ?? false);
    const axisY = pad.axes[1] ?? 0;
    const edgeUp = axisY < -0.6 && prevAxisY >= -0.6;
    const edgeDown = axisY > 0.6 && prevAxisY <= 0.6;
    if (pressed(12) || edgeUp) moveSelection(-1); // dpad up / stick up
    if (pressed(13) || edgeDown) moveSelection(1); // dpad down / stick down
    if (pressed(0)) confirmSelection(); // A
    if (pressed(1)) cancelSelection(); // B
    prevPadButtons = pad.buttons.map((b) => b.pressed);
    prevAxisY = Math.abs(axisY) < GAMEPAD_DEADZONE ? 0 : axisY;
  }

  onMount(() => {
    padRafId = requestAnimationFrame(pollGamepad);
    return () => cancelAnimationFrame(padRafId);
  });
</script>

<div class="select-screen">
  <div class="vignette"></div>

  <div class="topbar">
    <Logo size={0.4} />
  </div>
  <div class="account-line">
    {app.me?.account?.displayName ?? "unknown"} · {app.realm.name}
    <button class="linkish" onclick={() => void app.logout()}>sign out</button>
  </div>

  <div class="sidebar rc-frame">
    <div class="rc-frame-title">{mode === "select" ? "Your Champions" : "Choose a Class"}</div>

    {#if mode === "select"}
      <div class="roster">
        {#each characters as character (character.id)}
          <button
            type="button"
            class="roster-row"
            class:active={character.id === selectedCharacterId}
            onclick={() => selectCharacter(character)}
          >
            <span class="row-icon">{CLASS_ICONS[character.classId as ClassId] ?? "❔"}</span>
            <span class="row-info">
              <span class="row-name">{character.name}</span>
              <span class="row-level">Level {character.level}</span>
            </span>
          </button>
        {:else}
          <div class="sub empty">No champions yet.</div>
        {/each}
      </div>
      <button type="button" class="rc-btn ghost" onclick={() => (mode = "create")}>+ Forge New Champion</button>
    {:else}
      <div class="class-list">
        {#each CLASS_IDS as classId (classId)}
          {@const cls = CLASSES[classId]}
          <button
            type="button"
            class="class-row"
            class:active={selectedClassId === classId}
            onclick={() => selectClass(classId)}
            onmouseenter={() => (hoveredClassId = classId)}
            onmouseleave={() => (hoveredClassId = null)}
            onfocus={() => (hoveredClassId = classId)}
            onblur={() => (hoveredClassId = null)}
          >
            <span class="row-icon">{CLASS_ICONS[classId]}</span>
            <span class="row-name">{cls.name}</span>
          </button>
        {/each}
      </div>
      {#if characters.length > 0}
        <button type="button" class="rc-btn ghost" onclick={() => (mode = "select")}>‹ Back to Champions</button>
      {/if}
    {/if}
  </div>

  <div class="stage">
    <canvas bind:this={canvas} class="stage-canvas"></canvas>

    <div class="caption">
      {#if mode === "select" && activeCharacter}
        <div class="caption-name">{activeCharacter.name}</div>
        <div class="caption-sub">
          Level {activeCharacter.level} · {CLASSES[activeCharacter.classId as ClassId]?.name ?? ""}
        </div>
      {:else}
        <div class="caption-name">{previewClass.name}</div>
        <div class="caption-sub">{previewClass.resourceLabel}</div>
        <div class="caption-desc">{previewClass.description}</div>
        <div class="caption-spells">
          {previewClass.startingSpells.map((id) => spellDef(id).name).join(" · ")}
        </div>
      {/if}
    </div>
  </div>

  <div class="action-bar">
    {#if mode === "select"}
      <button type="button" class="rc-btn hero" disabled={!activeCharacter} onclick={enterSelected}>
        Enter World
      </button>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void createSelected();
        }}
      >
        <input class="rc-input name-input" placeholder="Champion name" bind:value={newName} maxlength={16} />
        <button type="submit" class="rc-btn hero" disabled={!selectedClassId || !newName.trim()}>
          Create Champion
        </button>
      </form>
    {/if}
    {#if app.error}
      <div class="error">{app.error}</div>
    {/if}
  </div>
</div>

<style>
  .select-screen {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    font-family: var(--rc-body);
    color: var(--rc-ink);
    overflow: hidden;
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center 55%, transparent 0%, rgba(8, 5, 2, 0.6) 100%);
    pointer-events: none;
  }

  .topbar {
    position: absolute;
    top: 16px;
    left: 24px;
    z-index: 3;
    /* Purely decorative wordmark. transform:scale shrinks what's painted
       but not the underlying layout box, which stays at the logo's full
       untransformed height — without this, that invisible overhang sits
       above the sidebar in the stack and silently swallows clicks on the
       class list underneath it. */
    pointer-events: none;
  }
  /* Its own corner (not stacked under the Logo) so it can't end up behind
     the sidebar panel — Logo has a transform:scale that shrinks it visually
     but leaves its full untransformed box in flow, which used to push a
     stacked account-line row down far enough to sit under the sidebar. */
  .account-line {
    position: absolute;
    top: 20px;
    right: 24px;
    z-index: 3;
    white-space: nowrap;
    color: var(--rc-ink-dim);
    font-size: 12px;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--rc-gold);
    cursor: pointer;
    font-size: 12px;
    text-decoration: underline;
    margin-left: 6px;
    padding: 0;
  }

  .sidebar {
    position: absolute;
    left: 24px;
    top: 96px;
    bottom: 100px;
    width: 280px;
    z-index: 2;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .roster {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sub.empty {
    color: var(--rc-ink-dim);
    font-size: 13px;
    text-align: center;
    padding: 8px 0;
  }
  .roster-row,
  .class-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(212, 175, 92, 0.28);
    border-radius: 6px;
    color: var(--rc-ink);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .roster-row:hover,
  .class-row:hover {
    border-color: var(--rc-gold);
  }
  .roster-row.active,
  .class-row.active {
    border-color: var(--rc-gold-bright);
    background: rgba(212, 175, 92, 0.15);
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.25);
  }
  .row-icon {
    font-size: 19px;
    width: 26px;
    flex-shrink: 0;
    text-align: center;
  }
  .row-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--rc-gold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-level {
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
  .class-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .class-row .row-name {
    font-size: 14px;
    letter-spacing: 1px;
  }
  .rc-btn.ghost {
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
    font-size: 12px;
    padding: 9px 12px;
  }

  .stage {
    position: absolute;
    inset: 0;
    padding-left: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding-bottom: 150px;
    z-index: 1;
  }
  .stage-canvas {
    width: min(40vw, 560px);
    height: min(74vh, 760px);
    display: block;
    cursor: grab;
    touch-action: none;
    pointer-events: auto;
  }
  .stage-canvas:active {
    cursor: grabbing;
  }
  .caption {
    pointer-events: none;
    text-align: center;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
    margin-top: -12px;
  }
  .caption-name {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 30px;
    letter-spacing: 2px;
    color: var(--rc-gold-bright);
  }
  .caption-sub {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-ink-dim);
    margin-top: 2px;
  }
  .caption-desc {
    font-size: 13px;
    color: var(--rc-ink);
    margin-top: 8px;
    max-width: 420px;
  }
  .caption-spells {
    font-size: 11px;
    font-style: italic;
    color: var(--rc-ink-dim);
    margin-top: 4px;
  }

  .action-bar {
    position: absolute;
    bottom: 26px;
    left: calc(50% + 160px);
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .action-bar form {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .name-input {
    width: 260px;
    text-align: center;
  }
  .rc-btn.hero {
    font-size: 18px;
    padding: 14px 46px;
  }
  .error {
    color: #ff8a80;
    font-size: 13px;
  }
</style>
