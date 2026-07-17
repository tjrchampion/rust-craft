import type { SelfState, ItemSnap, PartyMemberSnap, RosterEntry, QuestOfferInfo, QuestLogEntry } from "@rustcraft/shared";
import type { TargetInfo } from "../render/entities";

export type ChatChannel = "realm" | "party" | "system";
export type CharacterTab = "inventory" | "quests" | "spellbook" | "craft" | "party" | "system";

export interface ChatLine {
  channel: ChatChannel;
  from: string;
  text: string;
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

class GameState {
  connected = $state(false);
  self = $state<SelfState | null>(null);
  selfName = $state("");
  selfId = $state("");
  classId = $state("");
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
  questMarkers = $state<QuestMarker[]>([]);
  lastDevice = $state<"kbm" | "gamepad">("kbm");
  /** Master flag for the unified full-page character screen (Inventory /
   *  Spell Book / Crafting / System tabs) -- which tab is showing is
   *  tracked separately in `activeTab` so Tab and K can both open the same
   *  screen on a different starting tab. */
  inventoryOpen = $state(false);
  activeTab = $state<CharacterTab>("inventory");
  chatOpen = $state(false);
  worldMapOpen = $state(false);
  disconnected = $state(false);
  pvpEnabled = $state(false);
  target = $state<TargetInfo | null>(null);
  party = $state<PartyMemberSnap[] | null>(null);
  pendingInvite = $state<string | null>(null);
  /** Every currently-connected player in the realm, for the Party tab's
   *  invite list -- distinct from `party`, which is just the current group. */
  roster = $state<RosterEntry[]>([]);
  combatLog = $state<{ text: string; at: number }[]>([]);
  /** id -> display name, for combat-log attribution (not reactive). */
  names = new Map<string, string>();
  questOffer = $state<{ npcId: string; npcName: string; offers: QuestOfferInfo[] } | null>(null);
  questLog = $state<QuestLogEntry[]>([]);
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

  addChat(channel: ChatChannel, from: string, text: string): void {
    this.chatLog.push({ channel, from, text, at: Date.now() });
    if (this.chatLog.length > 150) this.chatLog.shift();
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
    this.worldMapOpen = false;
    this.disconnected = false;
    this.pvpEnabled = false;
    this.target = null;
    this.party = null;
    this.pendingInvite = null;
    this.roster = [];
    this.combatLog = [];
    this.names.clear();
    this.questOffer = null;
    this.questLog = [];
    this.currentZoneId = null;
    this.zoneBanner = null;
    this.questMarkers = [];
    this.dungeonState = null;
  }
}

export const game = new GameState();
