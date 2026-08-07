import type {
  SelfState,
  ItemSnap,
  PartyMemberSnap,
  RosterEntry,
  QuestOfferInfo,
  QuestLogEntry,
  AchievementSnap,
  LevelRewardChest,
  CharacterGender,
  CharacterAppearance,
  GraphicsSettings,
  AccountSettings,
  FriendEntry,
} from "@rustcraft/shared";
import {
  clampGraphicsSettings,
  graphicsFromPreset,
  mergeGraphicsSettings,
  resolveGraphicsPreset,
  type GraphicsPresetId,
} from "@rustcraft/shared";
import type { TargetInfo } from "../render/entities";

const GRAPHICS_STORAGE_KEY = "rc_graphics";

function loadGraphicsFromStorage(): GraphicsSettings {
  if (typeof localStorage === "undefined") return clampGraphicsSettings(undefined);
  try {
    const raw = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (!raw) return clampGraphicsSettings(undefined);
    return clampGraphicsSettings(JSON.parse(raw) as Partial<GraphicsSettings>);
  } catch {
    return clampGraphicsSettings(undefined);
  }
}

function persistGraphicsLocal(settings: GraphicsSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota / private mode */
  }
}

export type ChatChannel = "realm" | "region" | "party" | "system";
export type CharacterTab = "inventory" | "quests" | "achievements" | "spellbook" | "craft" | "party" | "social" | "system";

export interface ChatLine {
  channel: ChatChannel;
  from: string;
  text: string;
  at: number;
}

export interface ChatMention {
  channel: ChatChannel;
  from: string;
  at: number;
}

export interface Toast {
  id: number;
  text: string;
  at: number;
}

export interface QuestMarker {
  id: string;
  name: string;
  x: number;
  z: number;
  marker: "available" | "complete" | "active";
}

let toastId = 0;

/** True when `text` contains an @mention of `name` (case-insensitive; spaces allowed). */
export function textMentionsName(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[\\s([{\"'“])@${esc}(?=$|[\\s,.!?;:)\\]}'\"”])`, "i").test(text);
}

class GameState {
  connected = $state(false);
  loading = $state(false);
  loadingProgress = $state(0);
  loadingMessage = $state("");
  self = $state<SelfState | null>(null);
  selfName = $state("");
  selfId = $state("");
  classId = $state("");
  /** Live appearance for the paperdoll / equip preview (set on welcome). */
  gender = $state<CharacterGender>("male");
  appearance = $state<CharacterAppearance>({
    gender: "male",
    hairStyle: "none",
    facialHair: "none",
    hairColor: 0x2b1a12,
    eyeColor: 0x6b4423,
    outfitHue: 0xffffff,
  });
  /** serverTime - Date.now(), sampled once from the "welcome" message.
   *  castEndsAt (and anything else the server timestamps) is in the
   *  server's clock, not the client's -- subtract this offset before
   *  comparing against a local Date.now() so cast-bar-style countdowns
   *  aren't wrecked by clock skew between the two machines. */
  serverTimeOffset = $state(0);
  inventory = $state<ItemSnap[]>([]);
  learnedSpells = $state<string[]>([]);
  selectedSlot = $state(0);
  chatLog = $state<ChatLine[]>([]);
  toasts = $state<Toast[]>([]);
  interactLabel = $state<string | null>(null);
  timeOfDay = $state(0.3);
  compassYaw = $state(0);
  playerX = $state(0);
  playerZ = $state(0);
  /** Local prediction: head is below the water surface (blue overlay). */
  underwater = $state(false);
  questMarkers = $state<QuestMarker[]>([]);
  lastDevice = $state<"kbm" | "gamepad">("kbm");
  /** Master flag for the unified full-page character screen (Inventory /
   *  Spell Book / Crafting / System tabs) -- which tab is showing is
   *  tracked separately in `activeTab` so Tab and K can both open the same
   *  screen on a different starting tab. */
  inventoryOpen = $state(false);
  activeTab = $state<CharacterTab>("inventory");
  chatOpen = $state(false);
  /** Set when another player @mentions you — Chat.svelte surfaces the panel. */
  chatMention = $state<ChatMention | null>(null);
  worldMapOpen = $state(false);
  /** When the world map is opened via the minimap's REGION button, the region
   *  to open focused on (consumed + cleared by WorldMap). Null = continent view. */
  worldMapFocusRegionId = $state<string | null>(null);
  disconnected = $state(false);
  pvpEnabled = $state(false);
  target = $state<TargetInfo | null>(null);
  party = $state<PartyMemberSnap[] | null>(null);
  friends = $state<FriendEntry[]>([]);
  isRightClickDragging = $state(false);
  /** Virtual (software) cursor position in viewport px. While the pointer is
   *  locked this is driven by mouse *movement* deltas (the OS cursor is hidden
   *  and frozen); while unlocked it mirrors the real cursor. GameCursor renders
   *  the on-screen gauntlet here, and InputManager re-dispatches clicks to
   *  whatever DOM/canvas element sits under it. */
  cursorX = $state(0);
  cursorY = $state(0);
  /** True while the pointer is locked to the game canvas (persistent capture).
   *  Panels flip this off (via InputManager.uiMode) so menus use the real
   *  cursor with full native hover. */
  pointerCaptured = $state(false);
  playerContextMenu = $state<{ x: number; y: number; playerName: string; playerLevel?: number; playerClass?: string } | null>(null);
  pendingInvite = $state<string | null>(null);
  /** Every currently-connected player in the realm, for the Party tab's
   *  invite list -- distinct from `party`, which is just the current group. */
  roster = $state<RosterEntry[]>([]);
  combatLog = $state<{ text: string; at: number }[]>([]);
  /** id -> display name, for combat-log attribution (not reactive). */
  names = new Map<string, string>();
  questOffer = $state<{ npcId: string; npcName: string; offers: QuestOfferInfo[] } | null>(null);
  vendorOpen = $state(false);
  vendorWares = $state<{ npcId: string; vendorName: string; title: string; items: { itemId: string; price: number }[] } | null>(null);
  questLog = $state<QuestLogEntry[]>([]);
  achievements = $state<AchievementSnap[]>([]);
  untrackedQuests = $state<Set<string>>(new Set(typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem("rc:untracked-quests") ?? "[]") : []));

  toggleQuestTrack(questId: string): void {
    if (this.untrackedQuests.has(questId)) {
      this.untrackedQuests.delete(questId);
    } else {
      this.untrackedQuests.add(questId);
    }
    this.untrackedQuests = new Set(this.untrackedQuests);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc:untracked-quests", JSON.stringify(Array.from(this.untrackedQuests)));
    }
  }

  currentZoneId = $state<string | null>(null);
  zoneBanner = $state<{ name: string; subtitle: string; key: number } | null>(null);
  /** null while in the open world; set for the life of a dungeon run --
   *  drives the persistent HUD chip (see Hud.svelte). */
  dungeonState = $state<{ tier: number; partySize: number; mobsRemaining: number | null } | null>(null);
  /** null while in the open world; set for the life of a region visit --
   *  drives the persistent HUD chip the same way dungeonState does. */
  regionState = $state<{ regionId: string; regionName: string } | null>(null);

  /** World events in the current region (from worldEventState). */
  worldEvents = $state<
    Array<{
      id: string;
      regionId: string;
      name: string;
      phase: "cooldown" | "active" | "success" | "failed";
      localX: number;
      localZ: number;
      radius: number;
      playerCount: number;
      endsAt?: number;
      nextActiveAt?: number;
      myScore?: number;
      myTier?: "gold" | "silver" | "bronze" | null;
    }>
  >([]);

  /** Currently active corpse loot items (null when loot window is closed) */
  activeCorpseLoot = $state<{ mobId: string; mobType: string; items: { itemId: string; qty: number }[] } | null>(null);

  /** Unclaimed level-up care packages (right-side HUD chest). */
  levelRewards = $state<LevelRewardChest[]>([]);
  /** Which chest panel is open (id), or null when closed. */
  levelRewardOpenId = $state<string | null>(null);
  /** Center-screen LEVEL UP banner — fades after a few seconds. */
  levelUpBanner = $state<{ level: number; key: number } | null>(null);
  private levelUpBannerTimer = 0;

  /** System setting: Auto Loot toggle preference (persisted in localStorage) */
  autoLoot = $state<boolean>(
    typeof localStorage !== "undefined" && localStorage.getItem("rc_autoloot") !== null
      ? localStorage.getItem("rc_autoloot") === "true"
      : false,
  );

  /** Show floating names above other players (and your own avatar plate). */
  showPlayerNameplates = $state<boolean>(
    typeof localStorage !== "undefined" && localStorage.getItem("rc_player_nameplates") !== null
      ? localStorage.getItem("rc_player_nameplates") === "true"
      : true,
  );

  /** Show floating names above mobs and pets. */
  showMobNameplates = $state<boolean>(
    typeof localStorage !== "undefined" && localStorage.getItem("rc_mob_nameplates") !== null
      ? localStorage.getItem("rc_mob_nameplates") === "true"
      : true,
  );

  /** SFX master volume 0–1 (persisted). */
  sfxVolume = $state<number>(
    typeof localStorage !== "undefined" && localStorage.getItem("rc_sfx_vol") !== null
      ? Math.max(0, Math.min(1, Number(localStorage.getItem("rc_sfx_vol"))))
      : 0.55,
  );

  /** Music master volume 0–1 (persisted). */
  musicVolume = $state<number>(
    typeof localStorage !== "undefined" && localStorage.getItem("rc_music_vol") !== null
      ? Math.max(0, Math.min(1, Number(localStorage.getItem("rc_music_vol"))))
      : 0.55,
  );

  /** Graphics prefs — localStorage cache; account server copy when signed in. */
  graphics = $state<GraphicsSettings>(loadGraphicsFromStorage());

  private graphicsSaveTimer = 0;

  setAutoLoot(enabled: boolean): void {
    this.autoLoot = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc_autoloot", String(enabled));
    }
  }

  setShowPlayerNameplates(enabled: boolean): void {
    this.showPlayerNameplates = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc_player_nameplates", String(enabled));
    }
  }

  setShowMobNameplates(enabled: boolean): void {
    this.showMobNameplates = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc_mob_nameplates", String(enabled));
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc_sfx_vol", String(this.sfxVolume));
    }
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rc_music_vol", String(this.musicVolume));
    }
  }

  /** Seed from `/api/me` account.settings (account wins over local cache). */
  hydrateAccountSettings(settings: AccountSettings | null | undefined): void {
    if (!settings?.graphics) return;
    this.graphics = mergeGraphicsSettings(this.graphics, settings.graphics);
    this.graphics = {
      ...this.graphics,
      preset: resolveGraphicsPreset(this.graphics),
    };
    persistGraphicsLocal(this.graphics);
    void import("../game/instance").then(({ getGame }) => {
      getGame()?.applyGraphicsSettings(this.graphics);
    });
  }

  setGraphicsPreset(preset: GraphicsPresetId): void {
    this.commitGraphics(graphicsFromPreset(preset));
  }

  patchGraphics(partial: Partial<GraphicsSettings>): void {
    const next = clampGraphicsSettings({ ...this.graphics, ...partial });
    next.preset = resolveGraphicsPreset({ ...next, preset: "custom" });
    this.commitGraphics(next, partial);
  }

  private commitGraphics(next: GraphicsSettings, applyPartial?: Partial<GraphicsSettings>): void {
    this.graphics = next;
    persistGraphicsLocal(next);
    this.scheduleGraphicsAccountSave();
    void import("../game/instance").then(({ getGame }) => {
      getGame()?.applyGraphicsSettings(applyPartial ?? next);
    });
  }

  private scheduleGraphicsAccountSave(): void {
    if (typeof window === "undefined") return;
    window.clearTimeout(this.graphicsSaveTimer);
    this.graphicsSaveTimer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("rc:graphics-save", { detail: this.graphics }),
      );
    }, 450);
  }

  addChat(channel: ChatChannel, from: string, text: string): boolean {
    this.chatLog.push({ channel, from, text, at: Date.now() });
    if (this.chatLog.length > 150) this.chatLog.shift();
    if (
      channel !== "system" &&
      from !== this.selfName &&
      textMentionsName(text, this.selfName)
    ) {
      this.chatMention = { channel, from, at: Date.now() };
      return true;
    }
    return false;
  }

  addCombat(text: string): void {
    this.combatLog.push({ text, at: Date.now() });
    if (this.combatLog.length > 150) this.combatLog.shift();
  }

  nameOf(id: string | undefined): string {
    if (!id) return "something";
    return this.names.get(id) ?? (id.startsWith("m_") ? "Gray Wolf" : "someone");
  }

  toast(text: string): void {
    this.toasts.push({ id: ++toastId, text, at: Date.now() });
    if (this.toasts.length > 6) this.toasts.shift();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => Date.now() - t.at < 3800);
    }, 4000);
  }

  enterZone(id: string, name: string, subtitle: string): void {
    if (this.currentZoneId === id) return;
    this.currentZoneId = id;
    this.zoneBanner = { name, subtitle, key: ++toastId };
    setTimeout(() => {
      if (this.zoneBanner?.key === toastId) this.zoneBanner = null;
    }, 4200);
  }

  showLevelUpBanner(level: number): void {
    const key = ++toastId;
    this.levelUpBanner = { level, key };
    if (typeof window !== "undefined") {
      window.clearTimeout(this.levelUpBannerTimer);
      this.levelUpBannerTimer = window.setTimeout(() => {
        if (this.levelUpBanner?.key === key) this.levelUpBanner = null;
      }, 4800);
    }
  }

  reset(): void {
    this.connected = false;
    this.self = null;
    this.inventory = [];
    this.learnedSpells = [];
    this.selectedSlot = 0;
    this.chatLog = [];
    this.toasts = [];
    this.interactLabel = null;
    this.inventoryOpen = false;
    this.activeTab = "inventory";
    this.chatOpen = false;
    this.chatMention = null;
    this.worldMapOpen = false;
    this.disconnected = false;
    this.pvpEnabled = false;
    this.target = null;
    this.party = null;
    this.friends = [];
    this.pendingInvite = null;
    this.roster = [];
    this.combatLog = [];
    this.names.clear();
    this.questOffer = null;
    this.questLog = [];
    this.achievements = [];
    this.currentZoneId = null;
    this.zoneBanner = null;
    this.questMarkers = [];
    this.dungeonState = null;
    this.regionState = null;
    this.worldEvents = [];
    this.levelRewards = [];
    this.levelRewardOpenId = null;
    this.levelUpBanner = null;
    this.loading = false;
    this.loadingProgress = 0;
    this.loadingMessage = "";
  }
}

export function parseCoins(totalCopper: number): { gold: number; silver: number; copper: number } {
  const copperVal = Math.max(0, Math.floor(totalCopper || 0));
  const gold = Math.floor(copperVal / 10000);
  const silver = Math.floor((copperVal % 10000) / 100);
  const copper = copperVal % 100;
  return { gold, silver, copper };
}

export const game = new GameState();
