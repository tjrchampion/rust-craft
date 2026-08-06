<script lang="ts">
  import { app, REALM_LIST, type RealmInfo } from "./appState.svelte";
  import Logo from "./Logo.svelte";

  // Navigation page tabs
  type PageTab = "overview" | "news" | "wiki" | "classes" | "community" | "donate";
  let activeTab = $state<PageTab>("overview");

  // Wiki sub-tabs & search
  let wikiSubTab = $state<"classes" | "crafting" | "gathering" | "dungeons" | "party">("classes");
  let wikiSearch = $state("");

  // News category & filter
  let newsCategory = $state<"all" | "patch" | "dev" | "events">("all");
  let selectedArticle = $state<NewsArticle | null>(null);

  // Selected Class in Compendium
  let selectedClassId = $state<string>("Warrior");

  // Realm Selector Modal State
  let showRealmModal = $state(false);

  // Donate Modal State
  let showDonateModal = $state(false);
  let selectedDonateTier = $state<DonateTier | null>(null);
  let customDonateAmount = $state<number>(25);
  let donateName = $state("");
  let donatePaymentMethod = $state<"card" | "paypal" | "crypto">("card");
  let donateSuccess = $state(false);

  // News Articles Data
  interface NewsArticle {
    id: string;
    title: string;
    date: string;
    category: "patch" | "dev" | "events";
    tag: string;
    excerpt: string;
    content: string;
    image: string;
  }

  const newsArticles: NewsArticle[] = [
    {
      id: "patch-0-8-2",
      title: "Patch 0.8.2 Released: Dungeon Editor & Region Quests",
      date: "August 5, 2026",
      category: "patch",
      tag: "Patch Notes",
      excerpt: "Introducing the new dev tools suite, party quest proximity sharing within 40m, and region questing overhauls.",
      content: `
        <h3>Realm Update 0.8.2 Key Highlights</h3>
        <p>Greetings Adventurers! Patch 0.8.2 brings major enhancements to questing, world editing, and class spell mechanics across Eldor.</p>
        <ul>
          <li><strong>Party Quest Sharing:</strong> You can now share active quests directly with nearby party members within 40 meters. Objective credit is automatically granted to all nearby party members!</li>
          <li><strong>Dungeon & Region Authoring:</strong> Dev & authoring tools have been upgraded with live 3D bounding box gizmos, solid collision extractors, and NPC dialogue generators.</li>
          <li><strong>Spells & Balance:</strong> Paladin Holy Shield damage reduction increased, Druid Entangling Roots duration tuned, and Ranger Beast Companion AI improved.</li>
        </ul>
      `,
      image: "radial-gradient(circle at center, #7a2868, #1c1524)",
    },
    {
      id: "dev-crafting-preview",
      title: "Developer Insights: The Alchemy & 3x3 Crafting Grid",
      date: "July 28, 2026",
      category: "dev",
      tag: "Dev Update",
      excerpt: "Deep dive into ingredient harvesting, potion brewing recipes, and survival consumables in the wilderness.",
      content: `
        <h3>Crafting in the Wilds of Eldor</h3>
        <p>Crafting is an essential pillar of survival in Shadows of Eldor. Players can gather Berries, Wood, Stone, Animal Hides, and Ancient Dust to brew powerful alchemy potions and craft basic tools.</p>
        <p>Key consumables include:</p>
        <ul>
          <li><strong>Minor & Runic Healing Potions:</strong> Instant recovery for intense combat.</li>
          <li><strong>Frontline Potion:</strong> Temporarily boosts Armor (+6) and Vitality (+4).</li>
          <li><strong>Potion of Focus:</strong> Grants +15% Critical Strike and +6 Power.</li>
          <li><strong>Invisibility Potion:</strong> Shrouds your presence from mob aggro scanning for 15 seconds.</li>
        </ul>
      `,
      image: "radial-gradient(circle at center, #8a6f3a, #120e18)",
    },
    {
      id: "class-spotlight-paladin-cleric",
      title: "Class Spotlight: Holy Guardians of Eldor",
      date: "July 14, 2026",
      category: "dev",
      tag: "Class Spotlight",
      excerpt: "A breakdown of the Paladin and Cleric classes, their holy spell kits, party support capabilities, and spec strengths.",
      content: `
        <h3>Holy Magic & Divine Protection</h3>
        <p>Whether smiting the undead with Cleric's Smite or shielding allies with Paladin's Holy Shield, holy magic plays a vital role in group play.</p>
        <p>Clerics provide direct single-target and area-of-effect healing with <em>Circle of Healing</em> and <em>Renew</em>, while Paladins hold the frontline with <em>Consecration</em> and <em>Crusader Strike</em>.</p>
      `,
      image: "radial-gradient(circle at center, #2a9d9a, #120e18)",
    },
    {
      id: "community-playtest-event",
      title: "Pre-Alpha Community Playtest & Founder Rewards",
      date: "June 30, 2026",
      category: "events",
      tag: "Community Event",
      excerpt: "Join the development team for our weekend realm playtest. Support the realm to unlock exclusive founder badges!",
      content: `
        <h3>Join the Pre-Alpha Playtest</h3>
        <p>We invite all adventurers to log in this weekend for world boss encounters, dungeon raiding, and stress testing our persistent server architecture.</p>
        <p>Supporters and realm patrons receive exclusive Founder badges, Discord roles, and golden in-game nameplates!</p>
      `,
      image: "radial-gradient(circle at center, #c0392b, #120e18)",
    },
  ];

  // Donation Tier definitions
  interface DonateTier {
    id: string;
    name: string;
    amount: number;
    badge: string;
    popular?: boolean;
    perks: string[];
  }

  const donateTiers: DonateTier[] = [
    {
      id: "apprentice",
      name: "Apprentice Adventurer",
      amount: 5,
      badge: "Apprentice",
      perks: [
        "Special 'Apprentice' Founder Discord Role",
        "Name listed in Realm Supporter Credits",
        "Founder Badge on Community Forums",
      ],
    },
    {
      id: "defender",
      name: "Realm Defender",
      amount: 15,
      badge: "Patron",
      popular: true,
      perks: [
        "All Apprentice Adventurer rewards",
        "Exclusive 'Defender of Eldor' In-game Title",
        "Cosmetic Founder Cloak / Armor Skin",
        "500 Realm Crests bonus currency",
      ],
    },
    {
      id: "founder",
      name: "Legendary Founder",
      amount: 50,
      badge: "Legend",
      perks: [
        "All Realm Defender rewards",
        "Golden Nameplate glow in-game",
        "Exclusive Spectral Wolf Companion Mount",
        "Direct input in quarterly design feedback polls",
        "Permanent Founder Monument recognition in Town",
      ],
    },
  ];

  // Class Compendium & Wiki definitions
  interface ClassDef {
    id: string;
    name: string;
    role: string;
    resource: string;
    primaryStat: string;
    desc: string;
    strategy: string;
    spells: { name: string; level: number; desc: string }[];
  }

  const classesList: ClassDef[] = [
    {
      id: "Warrior",
      name: "Warrior",
      role: "Melee Tank / Physical DPS",
      resource: "Rage / Stamina",
      primaryStat: "Strength & Vitality",
      desc: "A frontline champion trading spellcraft for raw steel, shield walls, and crushing whirlwind strikes.",
      strategy: "Lead party dungeon pushes, hold threat with high armor, and use Shield Wall during heavy boss burst damage phases.",
      spells: [
        { name: "Rend", level: 1, desc: "Melee strike dealing physical damage and applying a Bleeding aura." },
        { name: "Heal", level: 1, desc: "Direct recovery spell to mend wounds in emergency moments." },
        { name: "Battle Fury", level: 2, desc: "Increases attack speed and physical power for 15 seconds." },
        { name: "Whirlwind", level: 4, desc: "Area-of-effect spin hitting all nearby targets within 6 yards." },
        { name: "Execute", level: 6, desc: "Finishing strike dealing massive bonus damage to targets under 20% HP." },
        { name: "Shield Wall", level: 8, desc: "Drastically reduces all incoming damage by 60% for 10 seconds." },
      ],
    },
    {
      id: "Mage",
      name: "Mage",
      role: "Ranged Elemental Burst",
      resource: "Mana",
      primaryStat: "Intellect & Spell Power",
      desc: "Wields raw elemental forces to ignite enemies with Firebolts and freeze whole rooms in Blizzards.",
      strategy: "Kite dangerous foes with Frostbolt slows, blanket wave spawns in Flame Nova, and maintain mana potion cooldowns.",
      spells: [
        { name: "Firebolt", level: 1, desc: "Primary fire projectile dealing high damage and applying a Burning aura." },
        { name: "Heal", level: 1, desc: "Direct recovery spell to mend self wounds." },
        { name: "Frostbolt", level: 2, desc: "Ice projectile dealing frost damage and applying a 40% Chilled slow." },
        { name: "Flame Nova", level: 4, desc: "Fires a caster-centered expansion wave of flame hitting all surrounding enemies." },
        { name: "Arcane Blast", level: 6, desc: "High-damage arcane nuke that silences enemy casters for 3 seconds." },
        { name: "Blizzard", level: 8, desc: "Summons an ice storm area of effect that continuously slows and damages all inside." },
      ],
    },
    {
      id: "Rogue",
      name: "Rogue",
      role: "Melee Assassin / Agility",
      resource: "Energy",
      primaryStat: "Agility & Critical Strike",
      desc: "Fast and lethal, striking hardest from the shadows with poison blades, fan of knives, and garrote lifesteal.",
      strategy: "Flank behind targets for Backstabs, maintain Poison Strike damage over time, and use Garrote to sustain health.",
      spells: [
        { name: "Backstab", level: 1, desc: "Devastating physical melee strike dealing 250% damage when striking from behind." },
        { name: "Heal", level: 1, desc: "Direct recovery spell to mend wounds." },
        { name: "Poison Strike", level: 2, desc: "Melee strike applying a stacking nature Poisoned aura." },
        { name: "Fan of Knives", level: 4, desc: "Throws deadly blades in a 360-degree radius around the caster." },
        { name: "Eviscerate", level: 6, desc: "Finishing strike dealing massive physical combo damage." },
        { name: "Garrote", level: 8, desc: "Melee throat strike applying a bleed and converting damage to self-healing (Lifesteal)." },
      ],
    },
    {
      id: "Cleric",
      name: "Cleric",
      role: "Holy Healer / Support",
      resource: "Mana",
      primaryStat: "Spirit & Healing Power",
      desc: "A holy priest who keeps party members standing through intense encounters while smiting undead foes.",
      strategy: "Keep Renew active on frontline tanks, cast Circle of Healing during AoE damage, and weave Smites on priority targets.",
      spells: [
        { name: "Smite", level: 1, desc: "Ranged holy projectile dealing holy damage." },
        { name: "Heal", level: 1, desc: "Direct recovery spell restoring target health." },
        { name: "Renew", level: 2, desc: "Applies a holy healing-over-time (HoT) aura to party members." },
        { name: "Circle of Healing", level: 4, desc: "Instantly heals all nearby party members within 15 meters." },
        { name: "Holy Fire", level: 6, desc: "Holy projectile nuke applying a burning holy aura." },
      ],
    },
    {
      id: "Ranger",
      name: "Ranger",
      role: "Ranged Physical / Beast Master",
      resource: "Focus",
      primaryStat: "Agility & Ranged Power",
      desc: "Master marksman who fights alongside loyal beast companions, showering enemies in arrow volleys.",
      strategy: "Summon your Wolf companion to tank aggro, apply Serpent Sting, and channel Aimed Shot for massive single-target bursts.",
      spells: [
        { name: "Quick Shot", level: 1, desc: "Fast physical arrow shot." },
        { name: "Heal", level: 1, desc: "Direct recovery spell." },
        { name: "Serpent Sting", level: 2, desc: "Ranged nature arrow applying a poisoned aura over 12 seconds." },
        { name: "Volley", level: 4, desc: "Showers a stream of arrows over a targeted 10-meter area." },
        { name: "Piercing Shot", level: 6, desc: "Heavy armor-piercing shot applying a bleeding aura." },
        { name: "Aimed Shot", level: 8, desc: "Focused sniper shot dealing high critical physical damage." },
        { name: "Beast Mastery", level: 10, desc: "Summons a loyal wolf beast companion to fight beside you." },
      ],
    },
    {
      id: "Druid",
      name: "Druid",
      role: "Hybrid Nature / Restoration",
      resource: "Mana / Energy",
      primaryStat: "Intellect & Versatility",
      desc: "Harnesses nature magic to heal allies with Regrowth and entangle aggressive enemies in sharp thorn roots.",
      strategy: "Cycle Regrowth and Heal HoTs, drop Thorn Burst AoEs, and lock down fast-moving threats with Entangling Roots.",
      spells: [
        { name: "Wrath", level: 1, desc: "Primary nature projectile dealing nature damage." },
        { name: "Heal", level: 1, desc: "Direct recovery spell." },
        { name: "Regrowth", level: 2, desc: "Instantly heals target and applies a healing-over-time aura." },
        { name: "Thorn Burst", level: 4, desc: "Fires a burst of sharp thorns around the caster hitting all nearby enemies." },
        { name: "Moonfire", level: 6, desc: "Arcane celestial projectile applying a burning aura." },
        { name: "Entangling Roots", level: 8, desc: "Roots target in place, rendering them completely stationary for 8 seconds." },
      ],
    },
    {
      id: "Paladin",
      name: "Paladin",
      role: "Holy Tank / Guardian",
      resource: "Mana & Holy Power",
      primaryStat: "Strength & Armor",
      desc: "Heavily armored divine knight wielding holy weapon strikes, ground consecrations, and protective holy shields.",
      strategy: "Consecrate the ground to hold multi-target aggro, activate Holy Shield when targeted by heavy attacks, and execute with Hammer of Wrath.",
      spells: [
        { name: "Crusader Strike", level: 1, desc: "Holy melee strike dealing physical and holy damage." },
        { name: "Heal", level: 1, desc: "Direct recovery spell." },
        { name: "Divine Favor", level: 2, desc: "Applies a holy buff aura boosting stats and attack speed." },
        { name: "Consecration", level: 4, desc: "Consecrates the ground, dealing holy damage to all enemies standing inside." },
        { name: "Hammer of Wrath", level: 6, desc: "Ranged holy hammer execute projectile." },
        { name: "Holy Shield", level: 8, desc: "Applies a holy shield buff reducing incoming damage by 50% and granting holy retaliation." },
      ],
    },
  ];

  const craftingRecipes = [
    { name: "Minor Healing Potion", effect: "Instantly restores 40 Health", ingredients: "3 Berries, 5 Wood" },
    { name: "Runic Healing Potion", effect: "Instantly restores 100 Health", ingredients: "10 Berries, 5 Ancient Dust" },
    { name: "Minor Mana Potion", effect: "Instantly restores 40 Mana", ingredients: "5 Ancient Dust" },
    { name: "Runic Mana Potion", effect: "Instantly restores 100 Mana", ingredients: "10 Ancient Dust, 5 Bones" },
    { name: "Frontline Potion", effect: "+6 Armor, +4 Vitality for 20s", ingredients: "10 Stone, 2 Animal Hide" },
    { name: "Potion of Focus", effect: "+6 Power, +15% Crit for 20s", ingredients: "5 Bones, 5 Ancient Dust" },
    { name: "Invisibility Potion", effect: "Aggro immunity for 15s", ingredients: "5 Ancient Dust, 3 Animal Hide" },
    { name: "Free Action Potion", effect: "+15% Speed & slow immunity for 15s", ingredients: "8 Berries, 5 Animal Hide" },
    { name: "Flask of the Titan", effect: "+60 Max HP for 30 min", ingredients: "20 Stone, 10 Bones, 5 Ancient Dust" },
    { name: "Phial of Quickness", effect: "+15% Speed for 30 min", ingredients: "15 Berries, 15 Animal Hide, 5 Ancient Dust" },
    { name: "Stone Axe", effect: "Harvest Wood from Pine Trees", ingredients: "30 Wood, 10 Stone" },
    { name: "Stone Pickaxe", effect: "Mine Stone & Ores", ingredients: "25 Wood, 15 Stone" },
    { name: "Wooden Spear", effect: "Basic melee hunting weapon", ingredients: "35 Wood, 5 Stone" },
    { name: "Campfire", effect: "Required for cooking raw meats", ingredients: "25 Wood, 10 Stone" },
  ];

  const gatheringNodes = [
    { node: "Pine Trees", tool: "Stone Axe", yield: "Wood", desc: "Abundant timber throughout temperate wilderness regions." },
    { node: "Stone Outcrops", tool: "Stone Pickaxe", yield: "Stone", desc: "Harvestable stone deposits found near mountains and rocky hills." },
    { node: "Berry Bushes", tool: "Bare Hands", yield: "Berries", desc: "Harvestable berry bushes for alchemy potions and health." },
    { node: "Wild Beasts (Stags, Wolves)", tool: "Weapon", yield: "Raw Meat & Animal Hide", desc: "Hunting beasts yields cooking meat and hides for armor." },
    { node: "Skeletons & Undead", tool: "Weapon", yield: "Bones & Ancient Dust", desc: "Slaying skeletal foes drops rare bones and dust for runic alchemy." },
  ];

  const dungeonInfo = [
    { name: "Crypt of the Fallen", level: "Lvl 4 - 8", boss: "Malakor the Undying", desc: "A dark subterranean crypt filled with skeletal warriors and runic traps." },
    { name: "Ironforge Caverns", level: "Lvl 8 - 12", boss: "High Overseer Grimfang", desc: "Ancient dwarven mines overrun by renegade mercenaries and elemental golems." },
    { name: "Shadowfen Keep", level: "Lvl 12 - 16", boss: "Arch-Lich Vespera", desc: "A haunted fortress surrounded by poisonous mist and elite shadow guards." },
  ];

  // Donate Submit Handler
  function handleDonateSubmit(e: SubmitEvent) {
    e.preventDefault();
    donateSuccess = true;
  }

  function openDonateModal(tier?: DonateTier) {
    selectedDonateTier = tier ?? donateTiers[1] ?? null;
    customDonateAmount = selectedDonateTier ? selectedDonateTier.amount : 25;
    donateSuccess = false;
    showDonateModal = true;
  }

  const selectedClass = $derived(
    classesList.find((c) => c.id === selectedClassId) ?? classesList[0]!
  );

  const filteredNews = $derived(
    newsArticles.filter((a) => newsCategory === "all" || a.category === newsCategory)
  );

  const filteredRecipes = $derived(
    craftingRecipes.filter(
      (r) =>
        !wikiSearch.trim() ||
        r.name.toLowerCase().includes(wikiSearch.toLowerCase()) ||
        r.effect.toLowerCase().includes(wikiSearch.toLowerCase()) ||
        r.ingredients.toLowerCase().includes(wikiSearch.toLowerCase())
    )
  );

  const filteredGathering = $derived(
    gatheringNodes.filter(
      (g) =>
        !wikiSearch.trim() ||
        g.node.toLowerCase().includes(wikiSearch.toLowerCase()) ||
        g.yield.toLowerCase().includes(wikiSearch.toLowerCase())
    )
  );
</script>

<div class="marketing-root">
  <!-- Top Navigation Header -->
  <header class="top-nav">
    <div class="nav-container">
      <button class="nav-brand" onclick={() => (activeTab = "overview")}>
        <Logo size={0.7} />
      </button>

      <nav class="nav-links">
        <button class="nav-link" class:active={activeTab === "overview"} onclick={() => (activeTab = "overview")}>
          Overview
        </button>
        <button class="nav-link" class:active={activeTab === "news"} onclick={() => (activeTab = "news")}>
          News
        </button>
        <button class="nav-link" class:active={activeTab === "wiki"} onclick={() => (activeTab = "wiki")}>
          Game Wiki
        </button>
        <button class="nav-link" class:active={activeTab === "classes"} onclick={() => (activeTab = "classes")}>
          Classes
        </button>
        <button class="nav-link" class:active={activeTab === "community"} onclick={() => (activeTab = "community")}>
          Community
        </button>
        <button class="nav-link" class:active={activeTab === "donate"} onclick={() => (activeTab = "donate")}>
          Support Realm
        </button>
      </nav>

      <div class="nav-actions">
        <!-- Logged-in State or Logged-out Auth Button -->
        {#if app.me?.account}
          <div class="user-profile-badge">
            <span class="user-avatar-icon">🛡</span>
            <div class="user-info">
              <span class="user-name">{app.me.account.displayName || "Adventurer"}</span>
              <button class="realm-pill-btn" onclick={() => (showRealmModal = true)}>
                <span class="status-dot"></span> {app.selectedRealm.name} ({app.selectedRealm.region}) ▼
              </button>
            </div>
          </div>

          <button class="rc-btn primary play-now-btn" onclick={() => app.enterCharSelect()}>
            Enter Realm
          </button>
          <button class="rc-btn ghost sm" onclick={() => app.logout()}>
            Log Out
          </button>
        {:else}
          <button class="realm-pill-btn" onclick={() => (showRealmModal = true)}>
            <span class="status-dot"></span> {app.selectedRealm.name} ({app.selectedRealm.region}) ▼
          </button>
          <button class="rc-btn ghost donate-nav-btn" onclick={() => openDonateModal()}>
            ♥ Donate
          </button>
          <button class="rc-btn primary play-nav-btn" onclick={() => app.enterLogin()}>
            Sign In / Play
          </button>
        {/if}
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="hero-section">
    <div class="hero-bg"></div>
    <div class="hero-vignette"></div>
    <div class="hero-content">
      <div class="realm-badge">
        <span class="status-dot"></span> REALM ONLINE · {app.selectedRealm.name} ({app.selectedRealm.ping}ms)
      </div>
      <h1 class="hero-title">SHADOWS OF ELDOR</h1>
      <p class="hero-subtitle">A PERSISTENT REALM OF MAGIC, DUNGEONS & ADVENTURE</p>

      <div class="hero-cta-group">
        {#if app.me?.account}
          <button class="rc-btn primary hero-btn" onclick={() => app.enterCharSelect()}>
            Enter Server ({app.selectedRealm.name})
          </button>
        {:else}
          <button class="rc-btn primary hero-btn" onclick={() => app.enterLogin()}>
            Play Free Now
          </button>
        {/if}
        <button class="rc-btn hero-btn secondary-btn" onclick={() => openDonateModal()}>
          ♥ Support Development
        </button>
        <button class="rc-btn ghost hero-btn" onclick={() => (activeTab = "wiki")}>
          Explore Game Wiki
        </button>
      </div>
    </div>
  </section>

  <!-- Main Content Body -->
  <main class="main-content">
    {#if activeTab === "overview"}
      <!-- Overview Page -->
      <section class="section overview-section">
        <div class="section-header">
          <h2 class="section-title">THE REALM AWAITS</h2>
          <p class="section-desc">Experience an open, persistent dark-fantasy world with seamless party questing, alchemy crafting, and real-time combat.</p>
        </div>

        <div class="features-grid">
          <div class="feature-card rc-frame">
            <div class="feature-icon">⚔</div>
            <h3>7 Playable Classes</h3>
            <p>Master Warrior, Mage, Rogue, Cleric, Ranger, Druid, and Paladin specs. Unlock spells as you level up.</p>
          </div>

          <div class="feature-card rc-frame">
            <div class="feature-icon">📜</div>
            <h3>Party Quest Sharing</h3>
            <p>Adventuring in a party automatically shares quest objectives and turn-ins within 40 meters.</p>
          </div>

          <div class="feature-card rc-frame">
            <div class="feature-icon">🧪</div>
            <h3>Alchemy & Crafting</h3>
            <p>Harvest wild berries, timber, stone, and ancient dust to craft healing potions, flasks, and gear.</p>
          </div>

          <div class="feature-card rc-frame">
            <div class="feature-icon">🏰</div>
            <h3>Dynamic Dungeons</h3>
            <p>Infiltrate crypts, defeat boss commanders, and earn legendary loot with your party members.</p>
          </div>
        </div>
      </section>

      <!-- Recent News Overview Preview -->
      <section class="section news-section">
        <div class="section-header">
          <h2 class="section-title">LATEST ANNOUNCEMENTS</h2>
        </div>
        <div class="news-grid">
          {#each newsArticles.slice(0, 3) as article (article.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="news-card rc-frame" onclick={() => (selectedArticle = article)}>
              <div class="news-card-header" style="background: {article.image};">
                <span class="news-tag">{article.tag}</span>
              </div>
              <div class="news-card-body">
                <div class="news-date">{article.date}</div>
                <h3 class="news-card-title">{article.title}</h3>
                <p class="news-excerpt">{article.excerpt}</p>
                <div class="read-more">Read Article →</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if activeTab === "news"}
      <!-- Full News Page -->
      <section class="section news-section">
        <div class="section-header">
          <h2 class="section-title">REALM NEWS & UPDATES</h2>
          <div class="category-filters">
            <button class="filter-btn" class:active={newsCategory === "all"} onclick={() => (newsCategory = "all")}>
              All News
            </button>
            <button class="filter-btn" class:active={newsCategory === "patch"} onclick={() => (newsCategory = "patch")}>
              Patch Notes
            </button>
            <button class="filter-btn" class:active={newsCategory === "dev"} onclick={() => (newsCategory = "dev")}>
              Dev Logs
            </button>
            <button class="filter-btn" class:active={newsCategory === "events"} onclick={() => (newsCategory = "events")}>
              Events
            </button>
          </div>
        </div>

        <div class="news-grid">
          {#each filteredNews as article (article.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="news-card rc-frame" onclick={() => (selectedArticle = article)}>
              <div class="news-card-header" style="background: {article.image};">
                <span class="news-tag">{article.tag}</span>
              </div>
              <div class="news-card-body">
                <div class="news-date">{article.date}</div>
                <h3 class="news-card-title">{article.title}</h3>
                <p class="news-excerpt">{article.excerpt}</p>
                <div class="read-more">Read Article →</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if activeTab === "classes"}
      <!-- Class Compendium Page -->
      <section class="section classes-compendium-section">
        <div class="section-header">
          <h2 class="section-title">CLASS COMPENDIUM</h2>
          <p class="section-desc">Select a hero class below to inspect stats, spell progression, resource types, and tactical strategies.</p>
        </div>

        <div class="compendium-layout">
          <!-- Class Selector Sidebar -->
          <div class="class-selector-list">
            {#each classesList as c}
              <button
                class="class-select-btn rc-frame"
                class:active={selectedClassId === c.id}
                onclick={() => (selectedClassId = c.id)}
              >
                <span class="class-btn-name">{c.name}</span>
                <span class="class-btn-role">{c.role}</span>
              </button>
            {/each}
          </div>

          <!-- Class Details Panel -->
          <div class="class-detail-panel rc-frame">
            <div class="class-detail-header">
              <h2>{selectedClass.name}</h2>
              <div class="class-tags-row">
                <span class="tag-pill">{selectedClass.role}</span>
                <span class="tag-pill gold">Resource: {selectedClass.resource}</span>
                <span class="tag-pill magenta">Primary: {selectedClass.primaryStat}</span>
              </div>
            </div>

            <p class="detail-desc">{selectedClass.desc}</p>

            <div class="strategy-box rc-frame">
              <h4>🎯 Combat & Dungeon Tactics</h4>
              <p>{selectedClass.strategy}</p>
            </div>

            <h3 class="spells-section-title">✨ Spell & Skill Progression</h3>
            <div class="spells-detail-grid">
              {#each selectedClass.spells as spell}
                <div class="spell-detail-card rc-frame">
                  <div class="spell-card-header">
                    <span class="spell-name">{spell.name}</span>
                    <span class="spell-level">Level {spell.level}</span>
                  </div>
                  <p class="spell-desc">{spell.desc}</p>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {/if}

    {#if activeTab === "wiki"}
      <!-- Game Wiki Page -->
      <section class="section wiki-section">
        <div class="section-header">
          <h2 class="section-title">SHADOWS OF ELDOR WIKI</h2>
          <p class="section-desc">Search and browse mechanics, alchemy recipes, wilderness gathering, and party questing guides.</p>
        </div>

        <div class="wiki-controls">
          <input
            type="text"
            class="rc-input wiki-search"
            placeholder="Search classes, spells, recipes, or gathering nodes..."
            bind:value={wikiSearch}
          />

          <div class="wiki-tabs">
            <button class="wiki-tab" class:active={wikiSubTab === "classes"} onclick={() => (wikiSubTab = "classes")}>
              Classes ({classesList.length})
            </button>
            <button class="wiki-tab" class:active={wikiSubTab === "crafting"} onclick={() => (wikiSubTab = "crafting")}>
              Crafting & Alchemy ({filteredRecipes.length})
            </button>
            <button class="wiki-tab" class:active={wikiSubTab === "gathering"} onclick={() => (wikiSubTab = "gathering")}>
              Gathering ({filteredGathering.length})
            </button>
            <button class="wiki-tab" class:active={wikiSubTab === "dungeons"} onclick={() => (wikiSubTab = "dungeons")}>
              Dungeons ({dungeonInfo.length})
            </button>
          </div>
        </div>

        <div class="wiki-content-container">
          {#if wikiSubTab === "classes"}
            <div class="wiki-grid">
              {#each classesList as c}
                <div class="wiki-card rc-frame">
                  <h3>{c.name} <span class="role-badge">{c.role}</span></h3>
                  <p>{c.desc}</p>
                  <div class="spell-list-text">
                    <strong>Spells:</strong> {c.spells.map((s) => s.name).join(" · ")}
                  </div>
                </div>
              {/each}
            </div>
          {:else if wikiSubTab === "crafting"}
            <div class="recipes-grid">
              {#each filteredRecipes as r}
                <div class="recipe-card rc-frame">
                  <h4>{r.name}</h4>
                  <div class="recipe-effect">{r.effect}</div>
                  <div class="recipe-ingredients"><strong>Ingredients:</strong> {r.ingredients}</div>
                </div>
              {/each}
            </div>
          {:else if wikiSubTab === "gathering"}
            <div class="gathering-grid">
              {#each filteredGathering as g}
                <div class="gathering-card rc-frame">
                  <h4>{g.node}</h4>
                  <div><strong>Tool:</strong> {g.tool}</div>
                  <div><strong>Yields:</strong> <span class="yield-badge">{g.yield}</span></div>
                  <p class="node-desc">{g.desc}</p>
                </div>
              {/each}
            </div>
          {:else if wikiSubTab === "dungeons"}
            <div class="dungeons-grid">
              {#each dungeonInfo as d}
                <div class="dungeon-card rc-frame">
                  <h4>{d.name} <span class="lvl-badge">{d.level}</span></h4>
                  <div><strong>Final Boss:</strong> {d.boss}</div>
                  <p>{d.desc}</p>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {/if}

    {#if activeTab === "community"}
      <!-- Community & Media Page -->
      <section class="section community-section">
        <div class="section-header">
          <h2 class="section-title">COMMUNITY & MEDIA</h2>
          <p class="section-desc">Connect with thousands of adventurers on Discord, watch dev playtests, and view fan art.</p>
        </div>

        <div class="community-grid">
          <div class="community-card rc-frame">
            <h3>💬 Official Discord Server</h3>
            <p>Join over 15,000 realm adventurers, find party members, discuss class specs, and chat live with devs.</p>
            <a
              href="https://discord.com/channels/1534903441699115039/1534903445159546893"
              target="_blank"
              rel="noopener noreferrer"
              class="rc-btn primary"
            >
              Join Official Discord ↗
            </a>
          </div>

          <div class="community-card rc-frame">
            <h3>📺 YouTube Channel</h3>
            <p>Watch gameplay trailers, developer walkthroughs, patch highlights, and boss strategy guides.</p>
            <a
              href="https://www.youtube.com/@shadowsofeldor"
              target="_blank"
              rel="noopener noreferrer"
              class="rc-btn primary"
            >
              Visit YouTube Channel ↗
            </a>
          </div>
        </div>
      </section>
    {/if}

    {#if activeTab === "donate"}
      <!-- Support & Donation Section -->
      <section class="section donate-section">
        <div class="section-header">
          <h2 class="section-title">SUPPORT THE REALM</h2>
          <p class="section-desc">
            Shadows of Eldor is an independently developed online RPG. Your contributions directly power server hosting,
            asset creation, and ongoing content expansions.
          </p>
        </div>

        <div class="donate-tiers-grid">
          {#each donateTiers as tier}
            <div class="donate-card rc-frame" class:popular={tier.popular}>
              {#if tier.popular}
                <div class="popular-badge">MOST POPULAR</div>
              {/if}
              <h3 class="tier-name">{tier.name}</h3>
              <div class="tier-price">${tier.amount} <span class="price-sub">one-time</span></div>

              <ul class="tier-perks">
                {#each tier.perks as perk}
                  <li>✓ {perk}</li>
                {/each}
              </ul>

              <button class="rc-btn primary tier-btn" onclick={() => openDonateModal(tier)}>
                Choose {tier.name}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </main>

  <!-- Server / Realm Selector Modal -->
  {#if showRealmModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (showRealmModal = false)}>
      <div class="modal-card realm-modal-card rc-frame" onclick={(e) => e.stopPropagation()}>
        <button class="rc-close modal-close-btn" onclick={() => (showRealmModal = false)}>✕</button>

        <h2>SELECT GAME REALM</h2>
        <p class="modal-sub">Choose a server realm to connect and play with your characters.</p>

        <div class="realm-list">
          {#each REALM_LIST as r}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="realm-item rc-frame"
              class:selected={app.selectedRealm.id === r.id}
              onclick={() => {
                app.selectRealm(r);
                showRealmModal = false;
              }}
            >
              <div class="realm-item-left">
                <div class="realm-item-name">{r.name}</div>
                <div class="realm-item-region">{r.region} · Ping: {r.ping}ms</div>
              </div>
              <div class="realm-item-right">
                <span class="pop-tag pop-{r.population.toLowerCase()}">{r.population} Pop</span>
                <span class="status-text online">● ONLINE</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- News Article Modal -->
  {#if selectedArticle}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (selectedArticle = null)}>
      <div class="modal-card rc-frame" onclick={(e) => e.stopPropagation()}>
        <button class="rc-close modal-close-btn" onclick={() => (selectedArticle = null)}>✕</button>
        <div class="modal-article-header">
          <span class="news-tag">{selectedArticle.tag}</span>
          <span class="news-date">{selectedArticle.date}</span>
          <h2>{selectedArticle.title}</h2>
        </div>
        <div class="modal-article-body">
          {@html selectedArticle.content}
        </div>
      </div>
    </div>
  {/if}

  <!-- Donation Checkout Modal -->
  {#if showDonateModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (showDonateModal = false)}>
      <div class="modal-card donate-modal-card rc-frame" onclick={(e) => e.stopPropagation()}>
        <button class="rc-close modal-close-btn" onclick={() => (showDonateModal = false)}>✕</button>

        {#if donateSuccess}
          <div class="donate-success-view">
            <div class="success-icon">✨</div>
            <h2>THANK YOU, ADVENTURER!</h2>
            <p>Your contribution has been received. Your founder rewards and titles will be linked to your account.</p>
            <button class="rc-btn primary" onclick={() => (showDonateModal = false)}>
              Return to Realm
            </button>
          </div>
        {:else}
          <h2>SUPPORT SHADOWS OF ELDOR</h2>
          <p class="modal-sub">Thank you for helping fund persistent server infrastructure and game development!</p>

          <form onsubmit={handleDonateSubmit} class="donate-form">
            <div class="form-group">
              <label for="tier-select">Select Tier / Contribution Level</label>
              <div class="tier-pills">
                {#each donateTiers as tier}
                  <button
                    type="button"
                    class="tier-pill"
                    class:active={selectedDonateTier?.id === tier.id}
                    onclick={() => {
                      selectedDonateTier = tier;
                      customDonateAmount = tier.amount;
                    }}
                  >
                    {tier.name} (${tier.amount})
                  </button>
                {/each}
              </div>
            </div>

            <div class="form-group">
              <label for="custom-amount">Contribution Amount ($ USD)</label>
              <input
                id="custom-amount"
                type="number"
                min="1"
                max="1000"
                class="rc-input"
                bind:value={customDonateAmount}
              />
            </div>

            <div class="form-group">
              <label for="donate-name">Adventurer / Character Name (For Credits & Badges)</label>
              <input
                id="donate-name"
                type="text"
                class="rc-input"
                placeholder="e.g. Valerius the Bold"
                bind:value={donateName}
                required
              />
            </div>

            <div class="form-group">
              <label for="payment-method">Payment Method</label>
              <select id="payment-method" class="rc-input" bind:value={donatePaymentMethod}>
                <option value="card">Credit / Debit Card</option>
                <option value="paypal">PayPal</option>
                <option value="crypto">Cryptocurrency / Web3</option>
              </select>
            </div>

            <button type="submit" class="rc-btn primary submit-donate-btn">
              Complete Contribution (${customDonateAmount})
            </button>
          </form>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Footer -->
  <footer class="site-footer">
    <div class="footer-container">
      <div class="footer-brand">
        <Logo size={0.6} />
        <div class="footer-title">SHADOWS OF ELDOR</div>
        <div class="footer-sub">A Persistent Realm of Magic & Adventure</div>
      </div>

      <div class="footer-socials">
        <a
          href="https://discord.com/channels/1534903441699115039/1534903445159546893"
          target="_blank"
          rel="noopener noreferrer"
          class="social-link discord"
          title="Discord"
        >
          <svg viewBox="0 0 24 24" class="social-icon">
            <path
              d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
              fill="currentColor"
            />
          </svg>
        </a>

        <a
          href="https://www.youtube.com/@shadowsofeldor"
          target="_blank"
          rel="noopener noreferrer"
          class="social-link youtube"
          title="YouTube"
        >
          <svg viewBox="0 0 24 24" class="social-icon">
            <path
              d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
              fill="currentColor"
            />
          </svg>
        </a>

        <a href="#github" onclick={(e) => e.preventDefault()} class="social-link github" title="GitHub">
          <svg viewBox="0 0 24 24" class="social-icon">
            <path
              d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
              fill="currentColor"
            />
          </svg>
        </a>
      </div>

      <div class="footer-legal">
        © 2026 Shadows of Eldor Team · All rights reserved. Pre-Alpha Release.
      </div>
    </div>
  </footer>
</div>

<style>
  .marketing-root {
    min-height: 100vh;
    width: 100%;
    background: #080509;
    color: var(--rc-ink);
    font-family: var(--rc-body);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    pointer-events: auto;
    box-sizing: border-box;
  }

  /* Top Navigation */
  .top-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background: rgba(12, 8, 18, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--rc-gold-dim);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  }
  .nav-container {
    width: 100%;
    max-width: 100%;
    padding: 10px 32px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .nav-brand {
    display: flex;
    align-items: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .nav-links {
    display: flex;
    gap: 4px;
  }
  .nav-link {
    background: transparent;
    border: none;
    color: var(--rc-ink-dim);
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 1px;
    padding: 8px 12px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s ease;
  }
  .nav-link:hover,
  .nav-link.active {
    color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.12);
  }
  .nav-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .user-profile-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(22, 16, 30, 0.9);
    border: 1px solid var(--rc-gold-dim);
    padding: 4px 10px;
    border-radius: 4px;
  }
  .user-avatar-icon {
    font-size: 16px;
  }
  .user-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .user-name {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .realm-pill-btn {
    background: transparent;
    border: none;
    color: var(--rc-ink-dim);
    font-size: 10px;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .realm-pill-btn:hover {
    color: var(--rc-gold);
  }

  /* Hero Section */
  .hero-section {
    position: relative;
    height: 75vh;
    min-height: 520px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    margin-top: 50px;
  }
  .hero-bg {
    position: absolute;
    inset: 0;
    background: #080605 url('/assets/ui/loading_bg.jpg') no-repeat center center / cover;
    filter: brightness(0.65) saturate(1.2);
  }
  .hero-vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at center 40%, transparent 20%, rgba(6, 4, 3, 0.6) 70%, rgba(4, 2, 1, 0.95) 100%),
      linear-gradient(180deg, rgba(8, 6, 4, 0.4) 0%, transparent 50%, #080509 100%);
  }
  .hero-content {
    position: relative;
    z-index: 10;
    max-width: 800px;
    padding: 0 24px;
  }
  .realm-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    border-radius: 20px;
    background: rgba(12, 10, 18, 0.85);
    border: 1px solid var(--rc-gold-dim);
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--rc-gold);
    margin-bottom: 20px;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6fcf6a;
    box-shadow: 0 0 8px #6fcf6a;
  }
  .hero-title {
    font-family: var(--rc-display);
    font-size: 56px;
    font-weight: 900;
    letter-spacing: 6px;
    color: #fff;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 25px rgba(196, 163, 90, 0.4);
    margin: 0 0 12px;
  }
  .hero-subtitle {
    font-family: var(--rc-display);
    font-size: 15px;
    letter-spacing: 3px;
    color: var(--rc-gold);
    text-shadow: 0 1px 4px #000;
    margin: 0 0 32px;
  }
  .hero-cta-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .hero-btn {
    padding: 14px 28px;
    font-size: 15px;
  }
  .secondary-btn {
    background: linear-gradient(180deg, #6a2268, #3a1238);
    border-color: var(--rc-magenta);
  }

  /* Main Content Body */
  .main-content {
    max-width: 1240px;
    margin: 0 auto;
    padding: 40px 24px 80px;
    width: 100%;
    box-sizing: border-box;
  }
  .section {
    margin-bottom: 60px;
  }
  .section-header {
    text-align: center;
    margin-bottom: 36px;
  }
  .section-title {
    font-family: var(--rc-display);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 4px;
    color: var(--rc-gold-bright);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
    margin: 0 0 8px;
  }
  .section-desc {
    color: var(--rc-ink-dim);
    font-size: 14px;
    max-width: 640px;
    margin: 0 auto;
  }

  /* Features Grid */
  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
  }
  .feature-card {
    padding: 24px;
    text-align: center;
  }
  .feature-icon {
    font-size: 32px;
    margin-bottom: 12px;
  }
  .feature-card h3 {
    font-family: var(--rc-display);
    font-size: 16px;
    color: var(--rc-gold-bright);
    margin: 0 0 8px;
  }
  .feature-card p {
    font-size: 13px;
    color: var(--rc-ink-dim);
    line-height: 1.4;
    margin: 0;
  }

  /* News Grid */
  .news-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 24px;
  }
  .news-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .news-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 16px rgba(196, 163, 90, 0.25);
  }
  .news-card-header {
    height: 140px;
    position: relative;
    padding: 12px;
    display: flex;
    align-items: flex-start;
  }
  .news-tag {
    background: rgba(12, 8, 18, 0.85);
    border: 1px solid var(--rc-gold);
    color: var(--rc-gold);
    font-family: var(--rc-display);
    font-size: 10px;
    letter-spacing: 1px;
    padding: 4px 8px;
    border-radius: 3px;
  }
  .news-card-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .news-date {
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-bottom: 6px;
  }
  .news-card-title {
    font-family: var(--rc-display);
    font-size: 15px;
    font-weight: 700;
    color: var(--rc-ink);
    margin: 0 0 8px;
    line-height: 1.3;
  }
  .news-excerpt {
    font-size: 13px;
    color: var(--rc-ink-dim);
    margin: 0 0 16px;
    line-height: 1.4;
    flex: 1;
  }
  .read-more {
    font-family: var(--rc-display);
    font-size: 11px;
    color: var(--rc-gold);
    letter-spacing: 1px;
  }

  /* Class Compendium Layout */
  .compendium-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 24px;
  }
  .class-selector-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .class-select-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 12px 16px;
    cursor: pointer;
    background: rgba(16, 12, 22, 0.8);
    border-color: var(--rc-gold-dim);
    transition: all 0.15s ease;
  }
  .class-select-btn:hover,
  .class-select-btn.active {
    border-color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.15);
  }
  .class-btn-name {
    font-family: var(--rc-display);
    font-size: 15px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .class-btn-role {
    font-size: 11px;
    color: var(--rc-ink-dim);
  }

  .class-detail-panel {
    padding: 28px;
  }
  .class-detail-header h2 {
    font-family: var(--rc-display);
    font-size: 28px;
    color: var(--rc-gold-bright);
    margin: 0 0 10px;
  }
  .class-tags-row {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .tag-pill {
    background: rgba(30, 22, 40, 0.9);
    border: 1px solid var(--rc-gold-dim);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 12px;
    color: var(--rc-ink);
  }
  .tag-pill.gold {
    color: var(--rc-gold-bright);
  }
  .tag-pill.magenta {
    color: var(--rc-magenta-bright);
  }
  .detail-desc {
    font-size: 14px;
    line-height: 1.5;
    color: var(--rc-ink);
    margin-bottom: 20px;
  }
  .strategy-box {
    padding: 16px 20px;
    margin-bottom: 24px;
    background: rgba(12, 10, 18, 0.8);
  }
  .strategy-box h4 {
    font-family: var(--rc-display);
    font-size: 13px;
    color: var(--rc-gold-bright);
    margin: 0 0 6px;
  }
  .strategy-box p {
    font-size: 13px;
    color: var(--rc-ink-dim);
    margin: 0;
    line-height: 1.4;
  }
  .spells-section-title {
    font-family: var(--rc-display);
    font-size: 16px;
    color: var(--rc-gold);
    margin: 0 0 14px;
    border-bottom: 1px solid var(--rc-gold-dim);
    padding-bottom: 6px;
  }
  .spells-detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }
  .spell-detail-card {
    padding: 12px 14px;
  }
  .spell-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .spell-name {
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .spell-level {
    font-size: 10px;
    color: var(--rc-ink-dim);
    border: 1px solid rgba(196, 163, 90, 0.3);
    padding: 1px 6px;
    border-radius: 8px;
  }
  .spell-desc {
    font-size: 12px;
    color: var(--rc-ink-dim);
    margin: 0;
    line-height: 1.3;
  }

  /* Wiki Controls */
  .wiki-controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 24px;
  }
  .wiki-search {
    max-width: 480px;
    margin: 0 auto;
  }
  .wiki-tabs {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .wiki-tab {
    background: rgba(22, 16, 30, 0.8);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink-dim);
    padding: 8px 16px;
    font-family: var(--rc-display);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
  }
  .wiki-tab.active {
    background: rgba(196, 163, 90, 0.18);
    color: var(--rc-gold-bright);
    border-color: var(--rc-gold-bright);
  }
  .wiki-grid,
  .recipes-grid,
  .gathering-grid,
  .dungeons-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .wiki-card,
  .recipe-card,
  .gathering-card,
  .dungeon-card {
    padding: 16px;
  }
  .wiki-card h3,
  .recipe-card h4,
  .gathering-card h4,
  .dungeon-card h4 {
    font-family: var(--rc-display);
    font-size: 16px;
    color: var(--rc-gold);
    margin: 0 0 8px;
  }
  .role-badge,
  .lvl-badge {
    font-size: 11px;
    color: var(--rc-ink-dim);
    font-weight: 400;
  }
  .recipe-effect {
    font-weight: 700;
    color: #6fcf6a;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .yield-badge {
    color: var(--rc-gold-bright);
    font-weight: 700;
  }

  /* Community Grid */
  .community-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
  }
  .community-card {
    padding: 32px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .community-card h3 {
    font-family: var(--rc-display);
    font-size: 20px;
    color: var(--rc-gold-bright);
    margin: 0 0 12px;
  }
  .community-card p {
    font-size: 14px;
    color: var(--rc-ink-dim);
    line-height: 1.5;
    margin: 0 0 24px;
    flex: 1;
  }

  /* Support / Donate Section */
  .donate-tiers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
  }
  .donate-card {
    position: relative;
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .donate-card.popular {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 24px rgba(196, 163, 90, 0.35);
  }
  .popular-badge {
    position: absolute;
    top: -12px;
    background: var(--rc-gold-bright);
    color: #120e18;
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 10px;
    letter-spacing: 1px;
    padding: 3px 10px;
    border-radius: 10px;
  }
  .tier-name {
    font-family: var(--rc-display);
    font-size: 18px;
    color: var(--rc-ink);
    margin: 0 0 12px;
  }
  .tier-price {
    font-family: var(--rc-display);
    font-size: 38px;
    font-weight: 900;
    color: var(--rc-gold-bright);
    margin-bottom: 20px;
  }
  .price-sub {
    font-size: 12px;
    color: var(--rc-ink-dim);
    font-weight: 400;
  }
  .tier-perks {
    list-style: none;
    padding: 0;
    margin: 0 0 24px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: var(--rc-ink);
    flex: 1;
  }
  .tier-btn {
    width: 100%;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(4, 2, 8, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .modal-card {
    position: relative;
    max-width: 540px;
    width: 100%;
    max-height: 85vh;
    overflow-y: auto;
    padding: 32px;
    box-sizing: border-box;
  }
  .modal-close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
  }

  /* Auth Modal */
  .auth-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
  }
  .auth-tab {
    flex: 1;
    background: transparent;
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink-dim);
    border-radius: 4px;
    padding: 8px 0;
    font-family: var(--rc-display);
    font-size: 12px;
    cursor: pointer;
  }
  .auth-tab.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.15);
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .error-msg {
    color: #ff8a80;
    font-size: 13px;
    text-align: center;
  }

  /* Realm Selector Modal */
  .realm-modal-card h2 {
    font-family: var(--rc-display);
    color: var(--rc-gold-bright);
    margin: 0 0 6px;
    text-align: center;
  }
  .modal-sub {
    text-align: center;
    color: var(--rc-ink-dim);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .realm-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .realm-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .realm-item:hover,
  .realm-item.selected {
    border-color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.15);
  }
  .realm-item-name {
    font-family: var(--rc-display);
    font-size: 15px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .realm-item-region {
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  .realm-item-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pop-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .pop-high {
    color: #ff7a6a;
    border-color: rgba(255, 122, 106, 0.4);
  }
  .pop-medium {
    color: var(--rc-gold-bright);
    border-color: rgba(232, 200, 120, 0.4);
  }
  .pop-low {
    color: #6fcf6a;
    border-color: rgba(111, 207, 106, 0.4);
  }
  .status-text.online {
    color: #6fcf6a;
    font-size: 11px;
    font-weight: 700;
  }

  /* Donate Modal */
  .donate-modal-card h2 {
    font-family: var(--rc-display);
    color: var(--rc-gold-bright);
    margin: 0 0 6px;
    text-align: center;
  }
  .donate-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-group label {
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--rc-gold);
  }
  .tier-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tier-pill {
    flex: 1;
    background: rgba(22, 16, 30, 0.8);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink-dim);
    padding: 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
  }
  .tier-pill.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(196, 163, 90, 0.2);
  }
  .donate-success-view {
    text-align: center;
    padding: 20px 0;
  }
  .success-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  /* Footer */
  .site-footer {
    background: #040206;
    border-top: 1px solid var(--rc-gold-dim);
    padding: 32px 24px;
    margin-top: auto;
  }
  .footer-container {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }
  .footer-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .footer-title {
    font-family: var(--rc-display);
    font-size: 14px;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
  .footer-sub {
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  .footer-socials {
    display: flex;
    gap: 14px;
  }
  .footer-legal {
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
</style>
