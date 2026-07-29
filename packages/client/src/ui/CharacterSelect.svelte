<script lang="ts">
  import { onMount } from "svelte";
  import { app, type CharacterSummary } from "./appState.svelte";
  import Logo from "./Logo.svelte";
  import {
    CLASSES,
    CLASS_IDS,
    spellDef,
    itemDef,
    GENDERS,
    HAIR_STYLES,
    FACIAL_HAIR_OPTIONS,
    type ClassId,
    type CharacterGender,
    type HairStyleId,
    type FacialHairId,
    type CharacterAppearance,
  } from "@rustcraft/shared";
  import { ClassPreviewScene } from "../render/ClassPreviewScene";
  import { CLASS_ICONS } from "../render/classModels";
  import { preloadCharacterAssets } from "../render/gltf";

  const GENDER_LABELS: Record<CharacterGender, string> = { male: "Male", female: "Female" };
  const HAIR_STYLE_LABELS: Record<HairStyleId, string> = {
    none: "Bald",
    buzzed: "Buzzed",
    buzzed_female: "Buzzed (Fem)",
    long: "Long",
    simple_parted: "Parted",
    buns: "Buns",
  };
  const FACIAL_HAIR_LABELS: Record<FacialHairId, string> = { none: "Clean", beard: "Beard" };
  const HAIR_COLOR_PRESETS = [0x1b1410, 0x2b1a12, 0x5b3a1e, 0x8a4a2f, 0xd8b874, 0xd9d3c8, 0xa8432b];
  const EYE_COLOR_PRESETS = [0x6b4423, 0x8a6d3a, 0x4a7c4a, 0x3f6fa8, 0x8892a0, 0xb8862e];
  const OUTFIT_HUE_PRESETS = [0xffffff, 0xd4af5c, 0xd94f3d, 0x4a7c4a, 0x4a7cc4, 0x8a5ac4, 0x8892a0, 0x555555];

  function hexColor(n: number): string {
    return "#" + n.toString(16).padStart(6, "0");
  }

  // One of the theme's existing class-flavored accents per class -- reusing
  // the fixed 4-color set already in theme.css rather than inventing a full
  // bespoke per-class palette (WoW itself uses one fixed color per class;
  // this is the same idea at a smaller palette).
  const CLASS_ACCENT: Record<ClassId, string> = {
    warrior: "var(--rc-blood)",
    berserker: "var(--rc-blood)",
    paladin: "var(--rc-gold-bright)",
    cleric: "var(--rc-gold-bright)",
    mage: "var(--rc-mana)",
    engineer: "var(--rc-mana)",
    druid: "var(--rc-nature)",
    ranger: "var(--rc-nature)",
    rogue: "var(--rc-ember)",
    assassin: "var(--rc-ember)",
  };

  let mode = $state<"select" | "create">("select");
  let modeInitialized = false;

  let newName = $state("");
  let selectedCharacterId = $state<string | null>(null);
  let selectedClassId = $state<ClassId | null>(null);
  let hoveredClassId = $state<ClassId | null>(null);

  // Draft appearance for a not-yet-created character -- gender/hairstyle/
  // colors are all a player choice independent of class now, so these live
  // here rather than being derived from the selected class.
  let draftGender = $state<CharacterGender>("male");
  let draftHairStyle = $state<HairStyleId>("none");
  let draftFacialHair = $state<FacialHairId>("none");
  let draftHairColor = $state(0x2b1a12);
  let draftEyeColor = $state(0x6b4423);
  let draftOutfitHue = $state(0xffffff);
  // Off by default -- creation preview shows the bare body/hair so the
  // appearance choices actually being made stay clearly visible, without
  // the class's starting armor covering most of it up.
  let previewGear = $state(false);

  const characters = $derived(app.me?.characters ?? []);
  const activeCharacter = $derived(characters.find((c) => c.id === selectedCharacterId) ?? null);
  const stageClassId = $derived<ClassId>(
    mode === "select"
      ? ((activeCharacter?.classId as ClassId) ?? CLASS_IDS[0]!)
      : (hoveredClassId ?? selectedClassId ?? CLASS_IDS[0]!),
  );
  // A roster character always shows its real equipped gear. The create-mode
  // class picker has no character yet -- it shows just the bare starting
  // weapon by default (see previewGear, off by default), or the class's full
  // starting armor set too once the player opts into previewing it.
  const stageEquip = $derived.by(() => {
    if (mode === "select") return activeCharacter?.equip ?? null;
    if (!previewGear) return null;
    const equip: Partial<Record<string, string>> = {};
    for (const g of CLASSES[stageClassId].startingGear) {
      if (g.slot !== "weapon") equip[g.slot] = g.itemId;
    }
    return equip;
  });
  const stageAccent = $derived(CLASS_ACCENT[stageClassId] ?? "var(--rc-gold)");
  // A roster character's saved appearance in select mode, or the live draft
  // being picked in create mode.
  const stageAppearance = $derived<CharacterAppearance>(
    mode === "select" && activeCharacter
      ? {
          gender: activeCharacter.gender,
          hairStyle: activeCharacter.hairStyle,
          facialHair: activeCharacter.facialHair,
          hairColor: activeCharacter.hairColor,
          eyeColor: activeCharacter.eyeColor,
          outfitHue: activeCharacter.outfitHue,
        }
      : {
          gender: draftGender,
          hairStyle: draftHairStyle,
          facialHair: draftFacialHair,
          hairColor: draftHairColor,
          eyeColor: draftEyeColor,
          outfitHue: draftOutfitHue,
        },
  );

  // Info-panel data for whichever class is currently on stage -- reuses the
  // class template's own baseStats/startingGear/startingSpells rather than
  // per-character stat tracking (CharacterSummary carries none), so this is
  // the class's baseline identity, the same for every character of it.
  const infoClass = $derived(CLASSES[stageClassId]);
  const infoWeapon = $derived.by(() => {
    const gear = infoClass.startingGear.find((g) => g.slot === "weapon");
    return gear ? itemDef(gear.itemId) : null;
  });
  const infoArmor = $derived.by(() => {
    const gear = infoClass.startingGear.find((g) => g.slot === "chest");
    return gear ? itemDef(gear.itemId) : null;
  });

  /** Short, generated blurb for a spell card -- there's no hand-authored
   *  flavor text per spell, so this reads off the actual effect data
   *  (damage school / heal / applied aura) instead. */
  function spellSummary(spellId: string): string {
    const spell = spellDef(spellId);
    const parts: string[] = [];
    const dmg = spell.effects.find((e) => e.type === "damage");
    const heal = spell.effects.find((e) => e.type === "heal");
    const aura = spell.effects.find((e) => e.type === "applyAura");
    if (dmg?.damageType) parts.push(`${dmg.damageType[0]!.toUpperCase()}${dmg.damageType.slice(1)} damage`);
    if (heal) parts.push("Restores health");
    if (aura) parts.push("applies a lingering effect");
    return parts.length > 0 ? parts.join(", ") : "A class ability.";
  }

  const SIGNATURE_ABILITY_COUNT = 3;
  const previewSpells = $derived(infoClass.startingSpells.slice(0, SIGNATURE_ABILITY_COUNT));

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
  // Drives the loading overlay over the stage -- without this the canvas
  // just sits blank/frozen for however long preloadAll() takes (every
  // class's base rig + textures), which reads as the screen being laggy or
  // broken rather than working as intended.
  let previewLoading = $state(true);

  onMount(() => {
    scene = new ClassPreviewScene(canvas);
    void scene
      .preloadAll()
      .then(() => scene?.setClass(stageClassId, stageAppearance.gender, stageAppearance, stageEquip))
      .finally(() => (previewLoading = false));
    // Fire-and-forget: warm base rigs / anim libs / hair while the player
    // browses character select. Modular outfit parts load on equip instead
    // of preloading every gender×slot GLTF (that path used to balloon VRAM).
    void preloadCharacterAssets();
    const onResize = () => scene?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      scene?.dispose();
    };
  });

  $effect(() => {
    scene?.setClass(stageClassId, stageAppearance.gender, stageAppearance, stageEquip);
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
    await app.createCharacter(newName, selectedClassId, {
      gender: draftGender,
      hairStyle: draftHairStyle,
      facialHair: draftFacialHair,
      hairColor: draftHairColor,
      eyeColor: draftEyeColor,
      outfitHue: draftOutfitHue,
    });
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

  <div class="title-bar">
    <div class="screen-title">{mode === "select" ? "Your Champions" : "Create Champion"}</div>
    {#if mode === "create"}
      <input
        class="rc-input name-input"
        placeholder="Champion name"
        bind:value={newName}
        maxlength={16}
        onkeydown={(e) => {
          if (e.key === "Enter") void createSelected();
        }}
      />
    {/if}
  </div>

  <div class="stage" class:create-mode={mode === "create"} style:--accent={stageAccent}>
    <div class="stage-dais" class:hidden={previewLoading}></div>
    <canvas bind:this={canvas} class="stage-canvas" class:loading={previewLoading}></canvas>

    {#if previewLoading}
      <div class="stage-loading">
        <div class="stage-spinner"></div>
        <div class="stage-loading-text">Summoning champions…</div>
      </div>
    {/if}
  </div>

  {#if mode === "create"}
    <div class="customize-panel rc-frame" style:--accent={stageAccent} class:hidden={previewLoading}>
      <div class="info-section-title">Appearance</div>

      <div class="custom-row">
        <label class="toggle-row">
          <input type="checkbox" bind:checked={previewGear} />
          <span class="custom-label toggle-label">Preview Starting Gear</span>
        </label>
      </div>

      <div class="rc-divider"></div>
      <div class="custom-row">
        <span class="custom-label">Gender</span>
        <div class="segmented">
          {#each GENDERS as g (g)}
            <button type="button" class="segment" class:active={draftGender === g} onclick={() => (draftGender = g)}>
              {GENDER_LABELS[g]}
            </button>
          {/each}
        </div>
      </div>

      <div class="rc-divider"></div>
      <div class="custom-row">
        <span class="custom-label">Hair</span>
        <div class="chip-grid">
          {#each HAIR_STYLES as style (style)}
            <button
              type="button"
              class="chip"
              class:active={draftHairStyle === style}
              onclick={() => (draftHairStyle = style)}
            >
              {HAIR_STYLE_LABELS[style]}
            </button>
          {/each}
        </div>
      </div>

      <div class="custom-row">
        <span class="custom-label">Facial Hair</span>
        <div class="segmented">
          {#each FACIAL_HAIR_OPTIONS as opt (opt)}
            <button
              type="button"
              class="segment"
              class:active={draftFacialHair === opt}
              onclick={() => (draftFacialHair = opt)}
            >
              {FACIAL_HAIR_LABELS[opt]}
            </button>
          {/each}
        </div>
      </div>

      <div class="rc-divider"></div>
      <div class="custom-row">
        <span class="custom-label">Hair Color</span>
        <div class="swatch-row">
          {#each HAIR_COLOR_PRESETS as c (c)}
            <button
              type="button"
              class="swatch"
              class:active={draftHairColor === c}
              style:--swatch={hexColor(c)}
              onclick={() => (draftHairColor = c)}
              aria-label={`Hair color ${hexColor(c)}`}
            ></button>
          {/each}
        </div>
      </div>

      <div class="custom-row">
        <span class="custom-label">Eye Color</span>
        <div class="swatch-row">
          {#each EYE_COLOR_PRESETS as c (c)}
            <button
              type="button"
              class="swatch"
              class:active={draftEyeColor === c}
              style:--swatch={hexColor(c)}
              onclick={() => (draftEyeColor = c)}
              aria-label={`Eye color ${hexColor(c)}`}
            ></button>
          {/each}
        </div>
      </div>

      <div class="rc-divider"></div>
      <div class="custom-row">
        <span class="custom-label">Outfit Tint</span>
        <div class="swatch-row">
          {#each OUTFIT_HUE_PRESETS as c (c)}
            <button
              type="button"
              class="swatch"
              class:active={draftOutfitHue === c}
              style:--swatch={hexColor(c)}
              onclick={() => (draftOutfitHue = c)}
              aria-label={`Outfit tint ${hexColor(c)}`}
            ></button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <div class="info-panel rc-frame" style:--accent={stageAccent} class:hidden={previewLoading}>
    {#if mode === "select" && activeCharacter}
      <div class="info-name">{activeCharacter.name}</div>
      <div class="info-role">
        Level {activeCharacter.level} · {infoClass.name}
      </div>
    {:else}
      <div class="info-name">{infoClass.name}</div>
      <div class="info-role">{infoClass.resourceLabel} User</div>
    {/if}
    <div class="info-desc">{infoClass.description}</div>

    <div class="rc-divider"></div>
    <div class="info-section-title">Starting Stats</div>
    <div class="stat-grid">
      <div class="stat-row"><span class="stat-label">Power</span><span class="stat-value">{infoClass.baseStats.power}</span></div>
      <div class="stat-row"><span class="stat-label">Agility</span><span class="stat-value">{infoClass.baseStats.agility}</span></div>
      <div class="stat-row"><span class="stat-label">Vitality</span><span class="stat-value">{infoClass.baseStats.vitality}</span></div>
      <div class="stat-row"><span class="stat-label">Armor</span><span class="stat-value">{infoClass.baseStats.armor}</span></div>
    </div>

    <div class="rc-divider"></div>
    <div class="info-section-title">Equipment</div>
    <div class="equip-row"><span class="equip-label">Resource</span><span class="equip-tag">{infoClass.resourceLabel}</span></div>
    {#if infoWeapon}
      <div class="equip-row"><span class="equip-label">Weapon</span><span class="equip-tag">{infoWeapon.weaponType ?? infoWeapon.name}</span></div>
    {/if}
    {#if infoArmor}
      <div class="equip-row"><span class="equip-label">Armor</span><span class="equip-tag">{infoArmor.name}</span></div>
    {/if}

    <div class="rc-divider"></div>
    <div class="info-section-title">Signature Abilities</div>
    <div class="ability-list">
      {#each previewSpells as spellId (spellId)}
        {@const spell = spellDef(spellId)}
        <div class="ability-card">
          <span class="ability-icon">{CLASS_ICONS[stageClassId]}</span>
          <div class="ability-text">
            <div class="ability-name">{spell.name}</div>
            <div class="ability-desc">{spellSummary(spellId)}</div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  {#if !previewLoading}
    <div class="roster-strip" class:create-mode={mode === "create"}>
      {#if mode === "select"}
        {#each characters as character (character.id)}
          {@const accent = CLASS_ACCENT[character.classId as ClassId] ?? "var(--rc-gold)"}
          <button
            type="button"
            class="strip-item"
            class:active={character.id === selectedCharacterId}
            style:--accent={accent}
            onclick={() => selectCharacter(character)}
          >
            <span class="strip-badge"><span class="strip-icon">{CLASS_ICONS[character.classId as ClassId] ?? "❔"}</span></span>
            <span class="strip-label">{character.name}</span>
          </button>
        {:else}
          <div class="sub empty">No champions yet.</div>
        {/each}
        <button type="button" class="strip-item strip-add" onclick={() => (mode = "create")}>
          <span class="strip-badge strip-badge-add">+</span>
          <span class="strip-label">New</span>
        </button>
      {:else}
        {#each CLASS_IDS as classId (classId)}
          {@const cls = CLASSES[classId]}
          {@const accent = CLASS_ACCENT[classId] ?? "var(--rc-gold)"}
          <button
            type="button"
            class="strip-item"
            class:active={selectedClassId === classId}
            style:--accent={accent}
            onclick={() => selectClass(classId)}
            onmouseenter={() => (hoveredClassId = classId)}
            onmouseleave={() => (hoveredClassId = null)}
            onfocus={() => (hoveredClassId = classId)}
            onblur={() => (hoveredClassId = null)}
          >
            <span class="strip-badge"><span class="strip-icon">{CLASS_ICONS[classId]}</span></span>
            <span class="strip-label">{cls.name}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="corner-bar corner-left">
    {#if !previewLoading && mode === "create" && characters.length > 0}
      <button type="button" class="rc-btn ghost" onclick={() => (mode = "select")}>‹ Back</button>
    {/if}
  </div>

  <div class="corner-bar corner-right">
    {#if app.error}
      <div class="error">{app.error}</div>
    {/if}
    {#if previewLoading}
      <!-- Enter World / Create hidden entirely while the preview scene is
           still loading -- nothing to click yet, and pressing early raced
           the model/gear load. -->
    {:else if mode === "select"}
      <button type="button" class="rc-btn hero" disabled={!activeCharacter} onclick={enterSelected}>
        Enter World
      </button>
    {:else}
      <button
        type="button"
        class="rc-btn hero"
        disabled={!selectedClassId || !newName.trim()}
        onclick={() => void createSelected()}
      >
        Create
      </button>
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

  /* --- Top title + name input ------------------------------------- */
  .title-bar {
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .screen-title {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 26px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--rc-gold-bright);
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
  }
  .name-input {
    width: 280px;
    text-align: center;
  }

  /* --- Center stage -------------------------------------------------- */
  .stage {
    position: absolute;
    inset: 0;
    padding-right: 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding-bottom: 120px;
    z-index: 1;
  }
  /* Create mode adds a left-side appearance panel mirroring the right info
     panel, so the character preview stays centered between both instead of
     drifting toward the (now occupied) left edge. */
  .stage.create-mode {
    padding-left: 340px;
  }
  .stage-canvas {
    width: min(46vw, 680px);
    height: min(86vh, 900px);
    display: block;
    cursor: grab;
    touch-action: none;
    pointer-events: auto;
    opacity: 1;
    transition: opacity 0.25s ease;
  }
  .stage-canvas.loading {
    opacity: 0;
    pointer-events: none;
  }
  /* Full-viewport, not inset to the side panels -- both panels are opacity:0
     while loading (see .info-panel.hidden/.customize-panel.hidden) and the
     roster/class strip + action buttons are removed outright, so nothing
     else is competing for space and the spinner can sit at true center. */
  .stage-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    pointer-events: none;
    z-index: 1;
  }
  .stage-spinner {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 3px solid rgba(212, 175, 92, 0.25);
    border-top-color: var(--rc-gold-bright);
    animation: stage-spin 0.9s linear infinite;
  }
  .stage-loading-text {
    font-family: var(--rc-display);
    font-size: 13px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--rc-ink-dim);
  }
  @keyframes stage-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .stage-canvas:active {
    cursor: grabbing;
  }
  /* A soft radial glow etched into the floor under the character -- reads
     as a lit dais/spotlight pool without needing an actual 3D pedestal mesh
     underneath the transparent preview canvas. */
  .stage-dais {
    position: absolute;
    left: calc(50% - 170px);
    transform: translateX(-50%);
    bottom: 112px;
    width: min(38vw, 560px);
    height: 100px;
    border-radius: 50%;
    background: radial-gradient(ellipse at center, color-mix(in srgb, var(--accent, var(--rc-gold)) 45%, transparent) 0%, transparent 72%);
    filter: blur(2px);
    opacity: 0.55;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .stage-dais.hidden {
    opacity: 0;
  }

  /* --- Right info panel (stats / equipment / abilities) --------------- */
  .info-panel {
    position: absolute;
    right: 24px;
    top: 96px;
    bottom: 96px;
    width: 300px;
    z-index: 2;
    padding: 18px 20px;
    overflow-y: auto;
    transition: opacity 0.25s ease;
  }
  .info-panel.hidden {
    opacity: 0;
  }
  .info-panel .rc-divider {
    margin: 12px 0;
  }

  /* --- Left customize panel (create mode only) ------------------------ */
  .customize-panel {
    position: absolute;
    left: 24px;
    top: 96px;
    bottom: 210px;
    width: 300px;
    z-index: 2;
    padding: 18px 20px;
    overflow-y: auto;
    transition: opacity 0.25s ease;
  }
  .customize-panel.hidden {
    opacity: 0;
  }
  .customize-panel .rc-divider {
    margin: 12px 0;
  }
  .custom-row {
    margin-top: 10px;
  }
  .custom-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--rc-ink-dim);
    margin-bottom: 6px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .toggle-row input[type="checkbox"] {
    accent-color: var(--rc-gold-bright);
    width: 15px;
    height: 15px;
    cursor: pointer;
  }
  .toggle-label {
    margin-bottom: 0;
  }
  .segmented {
    display: flex;
    gap: 6px;
  }
  .segment {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink);
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease;
  }
  .segment.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(212, 175, 92, 0.15);
  }
  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink);
    font-size: 11px;
    padding: 5px 9px;
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease;
  }
  .chip.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(212, 175, 92, 0.15);
  }
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--swatch);
    border: 2px solid rgba(0, 0, 0, 0.4);
    cursor: pointer;
    padding: 0;
    transition: border-color 0.12s ease, transform 0.12s ease;
  }
  .swatch:hover {
    transform: translateY(-1px);
  }
  .swatch.active {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 8px color-mix(in srgb, var(--rc-gold-bright) 55%, transparent);
  }
  .info-name {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 24px;
    letter-spacing: 1px;
    color: var(--rc-gold-bright);
  }
  .info-role {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--accent, var(--rc-ink-dim));
    margin-top: 2px;
  }
  .info-desc {
    font-size: 13px;
    color: var(--rc-ink);
    margin-top: 10px;
    line-height: 1.5;
  }
  .info-section-title {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-gold);
  }
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    margin-top: 8px;
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    border-bottom: 1px solid rgba(212, 175, 92, 0.15);
    padding-bottom: 3px;
  }
  .stat-label {
    color: var(--rc-ink-dim);
  }
  .stat-value {
    font-family: var(--rc-display);
    font-weight: 700;
    color: var(--rc-parchment);
  }
  .equip-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    font-size: 12px;
  }
  .equip-label {
    color: var(--rc-ink-dim);
  }
  .equip-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--rc-parchment);
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--accent, var(--rc-gold-dim));
    border-radius: 4px;
    padding: 2px 8px;
  }
  .ability-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }
  .ability-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(212, 175, 92, 0.18);
    border-radius: 6px;
  }
  .ability-icon {
    font-size: 18px;
    flex-shrink: 0;
  }
  .ability-name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    color: var(--rc-gold);
  }
  .ability-desc {
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-top: 1px;
    line-height: 1.4;
  }

  /* --- Bottom roster/class strip --------------------------------------- */
  .roster-strip {
    position: absolute;
    left: 24px;
    right: 340px;
    bottom: 96px;
    z-index: 2;
    display: flex;
    justify-content: center;
    gap: 10px;
    overflow-x: auto;
    padding: 4px 2px;
  }
  .roster-strip.create-mode {
    left: 340px;
  }
  .sub.empty {
    color: var(--rc-ink-dim);
    font-size: 13px;
    padding: 8px 12px;
  }
  .strip-item {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
  }
  .strip-badge {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.45));
    border: 2px solid var(--accent, var(--rc-gold-dim));
    transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
  }
  .strip-item:hover .strip-badge {
    transform: translateY(-2px);
  }
  .strip-item.active .strip-badge {
    border-color: var(--accent, var(--rc-gold-bright));
    box-shadow: 0 0 16px color-mix(in srgb, var(--accent, var(--rc-gold-bright)) 55%, transparent);
  }
  .strip-icon {
    font-size: 24px;
    line-height: 1;
  }
  .strip-badge-add {
    font-family: var(--rc-display);
    font-size: 24px;
    font-weight: 700;
    color: var(--rc-gold-dim);
    border-style: dashed;
  }
  .strip-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--rc-ink-dim);
    max-width: 64px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip-item.active .strip-label {
    color: var(--rc-gold-bright);
  }

  /* --- Corner action buttons ------------------------------------------ */
  .corner-bar {
    position: absolute;
    bottom: 20px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .corner-left {
    left: 24px;
  }
  .corner-right {
    right: 24px;
  }
  .rc-btn.ghost {
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
    font-size: 12px;
    padding: 9px 12px;
  }
  .rc-btn.hero {
    font-size: 18px;
    padding: 14px 46px;
    position: relative;
  }
  .rc-btn.hero:not(:disabled):hover {
    box-shadow: 0 0 22px rgba(255, 214, 110, 0.4);
  }
  .error {
    color: #ff8a80;
    font-size: 13px;
  }
</style>
