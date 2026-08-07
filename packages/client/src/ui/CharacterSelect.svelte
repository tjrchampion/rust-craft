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
    GENDER_HAIR_STYLES,
    GENDER_FACIAL_HAIR,
    isHairStyleAllowedForGender,
    isFacialHairAllowedForGender,
    type ClassId,
    type CharacterGender,
    type HairStyleId,
    type FacialHairId,
    type CharacterAppearance,
  } from "@rustcraft/shared";
  import { ClassPreviewScene } from "../render/ClassPreviewScene";
  import { CLASS_ICONS } from "../render/classModels";
  import { preloadCharacterAssets } from "../render/gltf";
  import CharacterThumbnail from "./CharacterThumbnail.svelte";
  import { parseMarkdown } from "./markdownParser";
  import { fallbackUpdatesMarkdown } from "./updates";

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
  let previewGear = $state(false);

  let rawUpdatesMd = $state(fallbackUpdatesMarkdown);
  const updatesHtml = $derived(parseMarkdown(rawUpdatesMd));

  const characters = $derived(app.me?.characters ?? []);
  const activeCharacter = $derived(characters.find((c) => c.id === selectedCharacterId) ?? null);
  const stageClassId = $derived<ClassId>(
    mode === "select"
      ? ((activeCharacter?.classId as ClassId) ?? CLASS_IDS[0]!)
      : (hoveredClassId ?? selectedClassId ?? CLASS_IDS[0]!),
  );
  // Roster characters show real equip. Create mode shows starting weapon
  // (previewGear on) or bare body (off).
  const stageEquip = $derived.by(() => {
    if (mode === "select") return activeCharacter?.equip ?? null;
    if (!previewGear) return null;
    const equip: Partial<Record<string, string>> = {};
    for (const g of CLASSES[stageClassId].startingGear) {
      equip[g.slot] = g.itemId;
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

  function selectGender(g: CharacterGender): void {
    draftGender = g;
    if (!isHairStyleAllowedForGender(draftHairStyle, g)) {
      draftHairStyle = GENDER_HAIR_STYLES[g][0] ?? "none";
    }
    if (!isFacialHairAllowedForGender(draftFacialHair, g)) {
      draftFacialHair = "none";
    }
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
    scene = new ClassPreviewScene(canvas, { pedestal: false });
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
    fetch("/updates.md")
      .then((res) => (res.ok ? res.text() : fallbackUpdatesMarkdown))
      .then((text) => {
        if (text && text.trim()) rawUpdatesMd = text;
      })
      .catch(() => {});
    padRafId = requestAnimationFrame(pollGamepad);
    return () => cancelAnimationFrame(padRafId);
  });

  // Pre-seeded particle data — gives each mote a deterministic-but-varied
  // x position, timing, size, and lateral drift without relying on the CSS
  // `mod` operator (which has poor browser support in calc()).
  const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
    x:     ((i * 137 + 23) % 100),            // 0–99% horizontal spread
    delay: -((i * 79 + 11) % 40) * 0.1,       // pre-running offset so motes are already in flight
    dur:   2.4 + ((i * 53 + 7) % 30) * 0.1,   // 2.4–5.3s rise time
    size:  2 + ((i * 41 + 3) % 4),            // 2–5px
    drift: -16 + ((i * 67 + 17) % 32),        // –16 to +15px lateral drift
    kind:  i % 3 === 0 ? "ember" : i % 7 === 0 ? "streak" : "mote",
  }));
</script>

<div class="select-screen">
  <div class="vignette"></div>

  <div class="topbar">
    <Logo size={0.85} />
  </div>
  <div class="account-line">
    {app.me?.account?.displayName ?? "unknown"} · {app.realm.name}
    <button class="linkish" onclick={() => void app.logout()}>sign out</button>
  </div>

  {#if mode === "select"}
    <div class="news-updates-panel rc-frame">
      <div class="news-panel-header">
        <span class="news-panel-title">📜 REALM NEWS & UPDATES</span>
      </div>
      <div class="news-panel-body">
        {@html updatesHtml}
      </div>
    </div>
  {/if}



  <!-- Character preview canvas — absolutely positioned over the stone
       platform in the background image. The platform centre sits at
       ~52% X / 64% Y in the 16:9 art. translateX(-50%) centres the
       canvas on that X and translateY(-100%) moves the bottom of the
       canvas (feet) to that Y, so the character stands on the stone. -->
  <div class="stage-anchor" class:create-mode={mode === "create"}>

    <!-- Shadow pool beneath character feet -->
    <div class="stage-shadow"></div>

    <!-- Rising runic particle motes -->
    <div class="stage-particles" aria-hidden="true">
      {#each PARTICLES as p}
        <span
          class="particle"
          class:ember={p.kind === 'ember'}
          class:streak={p.kind === 'streak'}
          style="
            --x: {p.x}%;
            --delay: {p.delay}s;
            --dur: {p.dur}s;
            --size: {p.size}px;
            --drift: {p.drift}px;
          "
        ></span>
      {/each}
    </div>

    <canvas bind:this={canvas} class="stage-canvas" class:loading={previewLoading}></canvas>

    {#if previewLoading}
      <div class="stage-loading">
        <div class="stage-spinner"></div>
        <div class="stage-loading-text">Summoning champions…</div>
      </div>
    {/if}
  </div>

  {#if mode === "create" && !previewLoading}
    <div class="name-input-wrapper">
      <input
        class="name-input"
        placeholder="Enter Champion Name..."
        bind:value={newName}
        maxlength={16}
        onkeydown={(e) => {
          if (e.key === "Enter") void createSelected();
        }}
      />
    </div>
  {/if}

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
            <button type="button" class="segment" class:active={draftGender === g} onclick={() => selectGender(g)}>
              {GENDER_LABELS[g]}
            </button>
          {/each}
        </div>
      </div>

      <div class="rc-divider"></div>
      <div class="custom-row">
        <span class="custom-label">Hair</span>
        <div class="chip-grid">
          {#each GENDER_HAIR_STYLES[draftGender] as style (style)}
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

      {#if draftGender === "male"}
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
      {/if}

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
    <div class="info-scroll">
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

    <div class="info-action">
      {#if mode === "select"}
        <button type="button" class="rc-btn hero info-btn" disabled={!activeCharacter} onclick={enterSelected}>
          Enter World
        </button>
      {:else}
        <button
          type="button"
          class="rc-btn hero info-btn"
          disabled={!selectedClassId || !newName.trim()}
          onclick={() => void createSelected()}
        >
          Create
        </button>
      {/if}
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
            <span class="strip-badge">
              <CharacterThumbnail
                classId={character.classId as ClassId}
                gender={character.gender}
                appearance={{
                  gender: character.gender,
                  hairStyle: character.hairStyle,
                  facialHair: character.facialHair,
                  hairColor: character.hairColor,
                  eyeColor: character.eyeColor,
                  outfitHue: character.outfitHue,
                }}
                equip={character.equip}
              />
            </span>
            <span class="strip-label">{character.name}</span>
            <span class="strip-sublabel">{CLASSES[character.classId as ClassId]?.name ?? ''}</span>
          </button>
        {:else}
          <div class="sub empty">No champions yet.</div>
        {/each}
        <button type="button" class="strip-item strip-add" onclick={() => (mode = "create")}>
          <span class="strip-badge strip-badge-add">+</span>
          <span class="strip-label">New</span>
        </button>
      {:else}
        <button type="button" class="strip-item strip-back" onclick={() => (mode = "select")}>
          <span class="strip-badge strip-badge-back">
            <span class="back-arrow">‹</span>
          </span>
          <span class="strip-label">Back</span>
        </button>
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
            <span class="strip-badge">
              <CharacterThumbnail
                classId={classId}
                gender={draftGender}
                appearance={stageAppearance}
              />
            </span>
            <span class="strip-label">{cls.name}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="corner-bar corner-left"></div>

  <div class="corner-bar corner-right">
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
    /* Dark base so image never leaves a white flash while loading */
    background: #08050a url('/assets/ui/char_select_bg.png') no-repeat center center;
    background-size: cover;
  }
  .vignette {
    position: absolute;
    inset: 0;
    /* Heavier darkening at edges to make panels readable over the busy art */
    background:
      radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(4, 2, 8, 0.55) 80%),
      linear-gradient(to bottom, rgba(4,2,8,0.55) 0%, transparent 18%, transparent 75%, rgba(4,2,8,0.7) 100%);
    pointer-events: none;
  }

  .topbar {
    position: absolute;
    top: 30px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
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

  /* --- Champion Name Input (Create Mode) --------------------------- */
  .name-input-wrapper {
    position: absolute;
    bottom: 160px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 15;
    pointer-events: auto;
  }
  .name-input {
    width: 260px;
    padding: 10px 16px;
    text-align: center;
    font-family: var(--rc-display);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-gold-bright);
    background: rgba(10, 5, 25, 0.85);
    backdrop-filter: blur(8px);
    border: 1.5px solid rgba(212, 175, 92, 0.45);
    border-radius: 6px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 4px 16px rgba(0, 0, 0, 0.7);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .name-input::placeholder {
    color: rgba(200, 170, 255, 0.35);
    letter-spacing: 1.5px;
    text-transform: none;
    font-weight: 400;
    font-size: 12px;
  }
  .name-input:focus {
    border-color: var(--rc-gold-bright);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 0 18px rgba(212, 175, 92, 0.45),
      0 4px 16px rgba(0, 0, 0, 0.8);
  }

  /* --- Character canvas anchored to the stone platform in the bg image -- */
  /*
   * The stone platform centre in the 16:9 art sits at roughly:
   *   X = 50%  (dead centre horizontally)
   *   Y = 67%  (upper-third of the lower half)
   *
   * We place .stage-anchor at those percentages, then translateX(-50%) so
   * the canvas is horizontally centred on the platform, and translateY(-100%)
   * so the BOTTOM edge of the canvas (= the character's feet) sits exactly
   * on that Y anchor. This means the character always stands on the platform
   * regardless of viewport size.
   *
   * The canvas width/height define how much of the screen the preview fills
   * while keeping the feet anchored to the platform.
   */
  .stage-anchor {
    position: absolute;
    /* Centered horizontally to the browser */
    left: 50%;
    /* Lowered onto the lower section of the stone pathway */
    top: 86%;
    /* Centre the canvas on X and lift feet to pathway Y. */
    transform: translateX(-50%) translateY(-100%);
    z-index: 1;
    pointer-events: none;
  }
  .stage-anchor.create-mode {
    left: 50%;
  }

  /* --- Foot shadow -------------------------------------------------------- */
  /* Dark elliptical pool beneath the character's feet — blends into the
     stone platform so the model reads as grounded rather than floating. */
  .stage-shadow {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: clamp(120px, 18vw, 280px);
    height: clamp(18px, 3vw, 44px);
    border-radius: 50%;
    background: radial-gradient(
      ellipse at center,
      rgba(10, 4, 20, 0.82) 0%,
      rgba(30, 10, 50, 0.45) 50%,
      transparent 75%
    );
    filter: blur(6px);
    pointer-events: none;
    z-index: 0;
  }

  /* Blur the whole particle layer slightly so every dot gets a natural
     light-bleeding bloom — no SVG filter needed. */
  .stage-particles {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: clamp(160px, 22vw, 340px);
    height: clamp(200px, 40vh, 480px);
    pointer-events: none;
    z-index: 2;
    overflow: visible;
    filter: blur(0.5px);
  }

  .particle {
    position: absolute;
    bottom: 4px;
    left: var(--x);
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    /* Bright core + wide bloom layers */
    background: rgba(220, 130, 255, 1);
    box-shadow:
      0 0 3px  2px  rgba(210, 100, 255, 1),
      0 0 8px  4px  rgba(170,  60, 255, 0.9),
      0 0 18px 6px  rgba(130,  30, 220, 0.7),
      0 0 32px 10px rgba(100,  10, 180, 0.4);
    animation: particle-rise var(--dur) var(--delay) ease-in infinite;
    opacity: 0;
  }
  .particle.ember {
    background: rgba(255, 190, 60, 1);
    box-shadow:
      0 0 3px  2px  rgba(255, 200,  80, 1),
      0 0 8px  4px  rgba(255, 140,  20, 0.9),
      0 0 18px 6px  rgba(220,  90,  10, 0.7),
      0 0 32px 10px rgba(180,  50,   0, 0.4);
  }
  .particle.streak {
    width: calc(var(--size) * 4);
    height: calc(var(--size) * 0.6px);
    border-radius: 2px;
    background: rgba(220, 130, 255, 1);
    box-shadow:
      0 0 4px  2px  rgba(200, 100, 255, 1),
      0 0 12px 4px  rgba(160,  60, 255, 0.8),
      0 0 24px 8px  rgba(120,  20, 200, 0.5);
  }

  @keyframes particle-rise {
    0%   { opacity: 0;   transform: translateY(0)      translateX(0); }
    10%  { opacity: 0.9; }
    80%  { opacity: 0.5; transform: translateY(-80px)  translateX(var(--drift)); }
    100% { opacity: 0;   transform: translateY(-130px) translateX(calc(var(--drift) * 1.4)); }
  }
  .stage-canvas {
    /* Increased character size */
    width: clamp(260px, 27vw, 540px);
    height: clamp(360px, 66vh, 780px);
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
  /* Spinner centred in the viewport (not the canvas) while loading */
  .stage-loading {
    position: fixed;
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
    to { transform: rotate(360deg); }
  }
  .stage-canvas:active {
    cursor: grabbing;
  }

  /* --- Right info panel (stats / equipment / abilities) --------------- */
  .info-panel {
    position: absolute;
    right: 24px;
    top: 96px;
    bottom: 120px;
    width: 300px;
    z-index: 2;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: opacity 0.25s ease;
  }
  .info-panel.hidden {
    opacity: 0;
  }
  .info-scroll {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  }
  .info-panel .rc-divider {
    margin: 12px 0;
  }
  .info-action {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(212, 175, 92, 0.2);
    flex-shrink: 0;
    display: flex;
    justify-content: center;
  }
  .info-btn {
    width: 100%;
    padding: 12px 0;
    font-size: 16px;
    letter-spacing: 2px;
    box-sizing: border-box;
  }

  /* --- Left customize panel (create mode only) ------------------------ */
  .customize-panel {
    position: absolute;
    left: 24px;
    top: 96px;
    bottom: 120px;
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
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    gap: 12px;
    overflow-x: auto;
    padding: 10px 24px;
    background: linear-gradient(to top, rgba(4, 2, 10, 0.95) 0%, rgba(4, 2, 10, 0.75) 60%, transparent 100%);
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(140, 70, 255, 0.25);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.6);
    scrollbar-width: none;
  }
  .roster-strip::-webkit-scrollbar { display: none; }
  .roster-strip.create-mode {
    left: 0;
  }
  .sub.empty {
    color: var(--rc-ink-dim);
    font-size: 13px;
    padding: 8px 12px;
  }

  /* Strip button */
  .strip-item {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    transition: background 0.15s ease;
  }
  .strip-item:hover {
    background: rgba(140, 60, 255, 0.08);
  }
  .strip-item.active {
    background: rgba(140, 60, 255, 0.14);
  }

  /* Portrait frame */
  .strip-badge {
    width: 60px;
    height: 60px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Dark glass base */
    background:
      linear-gradient(160deg, rgba(60,20,90,0.75) 0%, rgba(10,5,25,0.90) 100%);
    border: 1.5px solid rgba(140, 70, 255, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(200,150,255,0.12),
      0 2px 8px rgba(0,0,0,0.5);
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    overflow: hidden;
    position: relative;
  }
  .strip-item:hover .strip-badge {
    border-color: rgba(180, 100, 255, 0.7);
    transform: translateY(-3px);
    box-shadow:
      inset 0 1px 0 rgba(200,150,255,0.18),
      0 0 14px rgba(140, 60, 255, 0.45),
      0 4px 12px rgba(0,0,0,0.5);
  }
  .strip-item.active .strip-badge {
    border-color: var(--accent, rgba(180,100,255,0.9));
    box-shadow:
      inset 0 1px 0 rgba(200,150,255,0.2),
      0 0 20px color-mix(in srgb, var(--accent, rgba(180,100,255,1)) 60%, transparent),
      0 0 6px rgba(140,60,255,0.8),
      0 4px 12px rgba(0,0,0,0.6);
  }

  /* ---- CSS class portrait head ---------------------------------------- */
  /* A simple helmet silhouette: oval face + trapezoid helm top, tinted by
     the class accent colour via filter:hue-rotate on the container.        */
  .class-portrait {
    position: relative;
    width: 38px;
    height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    /* Tint towards the class accent using a CSS filter on the whole portrait.
       We set --accent on the button, so we convert it to a hue-rotate
       approximation per class via data-class attribute. */
  }
  /* Helm (upper dome) */
  .portrait-helm {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 24px;
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--accent, #a050ff) 70%, #1a0a2a) 0%,
      color-mix(in srgb, var(--accent, #a050ff) 35%, #0a0515) 100%
    );
    border-radius: 50% 50% 20% 20% / 60% 60% 30% 30%;
    box-shadow:
      inset 0 3px 6px rgba(255,255,255,0.18),
      inset -3px 0 4px rgba(0,0,0,0.35),
      0 0 10px color-mix(in srgb, var(--accent, #a050ff) 45%, transparent);
  }
  /* Cheek guards — two side flanges */
  .portrait-helm::before,
  .portrait-helm::after {
    content: '';
    position: absolute;
    bottom: -6px;
    width: 9px;
    height: 12px;
    background: color-mix(in srgb, var(--accent, #a050ff) 45%, #0d0820);
    border-radius: 2px 2px 4px 4px;
    box-shadow: inset 0 1px 2px rgba(255,255,255,0.1);
  }
  .portrait-helm::before { left: 0; border-radius: 4px 2px 2px 4px; }
  .portrait-helm::after  { right: 0; border-radius: 2px 4px 4px 2px; }
  /* Face / visor */
  .portrait-face {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 22px;
    height: 22px;
    background: linear-gradient(180deg,
      rgba(20, 10, 40, 0.95) 0%,
      rgba(10, 5, 20, 0.98) 100%
    );
    border-radius: 40% 40% 45% 45%;
    box-shadow:
      inset 0 0 6px rgba(0,0,0,0.8);
  }
  /* Eyes — glowing slits */
  .portrait-face::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 50%;
    transform: translateX(-50%);
    width: 14px;
    height: 3px;
    background: color-mix(in srgb, var(--accent, #a050ff) 90%, white);
    border-radius: 2px;
    box-shadow:
      0 0 4px 1px color-mix(in srgb, var(--accent, #a050ff) 80%, transparent),
      0 0 8px 2px color-mix(in srgb, var(--accent, #a050ff) 50%, transparent);
    /* Split into two eyes via box-shadow trick */
    clip-path: polygon(0% 0%, 38% 0%, 38% 100%, 0% 100%,
                       0% 100%, 62% 100%, 62% 0%, 100% 0%);
  }

  /* "+" add-new badge and "‹" back badge */
  .strip-badge-add {
    font-family: var(--rc-display);
    font-size: 26px;
    font-weight: 700;
    color: rgba(140, 80, 255, 0.6);
    background:
      linear-gradient(160deg, rgba(40,15,70,0.6) 0%, rgba(10,5,25,0.8) 100%);
    border: 1.5px dashed rgba(120, 60, 220, 0.45);
  }
  .strip-badge-add:hover {
    color: rgba(180, 110, 255, 0.9);
  }
  .strip-badge-back {
    background: linear-gradient(160deg, rgba(50, 20, 50, 0.75) 0%, rgba(15, 5, 20, 0.9) 100%);
    border: 1.5px dashed rgba(212, 175, 92, 0.5);
  }
  .back-arrow {
    font-family: var(--rc-display);
    font-size: 28px;
    font-weight: 700;
    color: var(--rc-gold);
    line-height: 1;
    margin-top: -2px;
  }
  .strip-item:hover .strip-badge-back {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 14px rgba(212, 175, 92, 0.4);
  }
  .strip-item:hover .back-arrow {
    color: #fff;
  }

  .strip-label {
    font-size: 10px;
    font-family: var(--rc-display);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: rgba(200, 170, 255, 0.6);
    max-width: 70px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip-sublabel {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(160, 120, 220, 0.45);
    max-width: 70px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: -2px;
  }
  .strip-item.active .strip-label {
    color: color-mix(in srgb, var(--accent, #c8a0ff) 85%, white);
  }
  .strip-item.active .strip-sublabel {
    color: color-mix(in srgb, var(--accent, #a060ff) 60%, transparent);
  }

  /* --- Corner action buttons ------------------------------------------ */
  .corner-bar {
    position: absolute;
    bottom: 116px;
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

  /* --- News & Updates Panel ------------------------------------------- */
  .news-toggle-btn {
    position: absolute;
    right: 24px;
    top: 20px;
    font-size: 11px;
    padding: 6px 14px;
    z-index: 30;
  }
  .news-toggle-btn.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.15);
  }
  .news-updates-panel {
    position: fixed;
    top: 70px;
    left: 24px;
    width: 340px;
    max-height: 65vh;
    display: flex;
    flex-direction: column;
    z-index: 30;
    padding: 18px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.85), 0 0 18px rgba(196, 163, 90, 0.2);
    border: 1px solid var(--rc-gold-dim);
  }
  .news-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--rc-gold-dim);
  }
  .news-panel-title {
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--rc-gold-bright);
  }
  .news-close-btn {
    width: 22px;
    height: 22px;
    font-size: 11px;
  }
  .news-panel-body {
    overflow-y: auto;
    padding-right: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--rc-ink);
  }
  .news-panel-body :global(.md-h1) {
    font-family: var(--rc-display);
    font-size: 18px;
    color: var(--rc-gold-bright);
    margin: 0 0 10px;
  }
  .news-panel-body :global(.md-h2) {
    font-family: var(--rc-display);
    font-size: 15px;
    color: var(--rc-gold);
    margin: 12px 0 6px;
  }
  .news-panel-body :global(.md-h3) {
    font-family: var(--rc-display);
    font-size: 13px;
    color: var(--rc-gold-bright);
    margin: 10px 0 4px;
  }
  .news-panel-body :global(.md-h4) {
    font-family: var(--rc-display);
    font-size: 12px;
    color: var(--rc-ink);
    margin: 8px 0 4px;
  }
  .news-panel-body :global(.md-p) {
    margin: 0 0 8px;
    color: var(--rc-ink-dim);
  }
  .news-panel-body :global(.md-list) {
    padding-left: 18px;
    margin: 0 0 10px;
  }
  .news-panel-body :global(.md-li) {
    margin-bottom: 4px;
    color: var(--rc-ink);
  }
  .news-panel-body :global(.md-quote) {
    border-left: 2px solid var(--rc-gold);
    padding-left: 10px;
    margin: 8px 0;
    font-style: italic;
    color: var(--rc-gold);
    background: rgba(196, 163, 90, 0.08);
  }
  .news-panel-body :global(.md-hr) {
    border: none;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--rc-gold-dim), transparent);
    margin: 12px 0;
  }
  .news-panel-body :global(.md-link) {
    color: var(--rc-gold-bright);
    text-decoration: underline;
  }

  /* --- Responsive Scaling for Smaller Viewports ----------------------- */
  @media (max-height: 820px) {
    .name-input-wrapper {
      bottom: 92px;
    }
    .info-panel,
    .customize-panel {
      top: 64px;
      bottom: 110px;
      padding: 14px 16px;
    }
    .news-updates-panel {
      top: 64px;
      max-height: 55vh;
    }
    .roster-strip {
      padding: 6px 16px;
    }
    .strip-badge {
      width: 50px;
      height: 50px;
    }
  }
</style>
