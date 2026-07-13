import type { SelfState, ItemSnap, PartyMemberSnap, QuestOfferInfo, QuestLogEntry } from "@rustcraft/shared";
import type { TargetInfo } from "../render/entities";

export type ChatChannel = "realm" | "party" | "system";

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

let toastId = 0;

class GameState {
  connected = $state(false);
  self = $state<SelfState | null>(null);
  selfName = $state("");
  selfId = $state("");
  inventory = $state<ItemSnap[]>([]);
  learnedSpells = $state<string[]>([]);
  selectedSlot = $state(0);
  chatLog = $state<ChatLine[]>([]);
  toasts = $state<Toast[]>([]);
  interactLabel = $state<string | null>(null);
  timeOfDay = $state(0.3);
  compassYaw = $state(0);
  lastDevice = $state<"kbm" | "gamepad">("kbm");
  inventoryOpen = $state(false);
  chatOpen = $state(false);
  disconnected = $state(false);
  pvpEnabled = $state(false);
  target = $state<TargetInfo | null>(null);
  party = $state<PartyMemberSnap[] | null>(null);
  pendingInvite = $state<string | null>(null);
  combatLog = $state<{ text: string; at: number }[]>([]);
  /** id -> display name, for combat-log attribution (not reactive). */
  names = new Map<string, string>();
  questOffer = $state<{ npcId: string; npcName: string; offers: QuestOfferInfo[] } | null>(null);
  questLog = $state<QuestLogEntry[]>([]);
  currentZoneId = $state<string | null>(null);
  zoneBanner = $state<{ name: string; subtitle: string; key: number } | null>(null);

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
    this.chatOpen = false;
    this.disconnected = false;
    this.pvpEnabled = false;
    this.target = null;
    this.party = null;
    this.pendingInvite = null;
    this.combatLog = [];
    this.names.clear();
    this.questOffer = null;
    this.questLog = [];
    this.currentZoneId = null;
    this.zoneBanner = null;
  }
}

export const game = new GameState();
