import type { CharacterAppearance, AccountSettings, GraphicsSettings } from "@rustcraft/shared";
import { game as gameUi } from "./gameState.svelte";

export type Screen = "loading" | "login" | "charselect" | "ingame" | "dungeoneditor" | "regioneditor" | "website";

export interface CharacterSummary extends CharacterAppearance {
  id: string;
  name: string;
  level: number;
  classId: string;
  /** Currently equipped item id per gear slot (weapon/head/chest/arms/legs/
   *  feet/shoulders/neck), keyed by GearSlot name -- so the character-select preview can
   *  show what this specific character actually has on. */
  equip?: Partial<Record<string, string>>;
}

export interface Realm {
  name: string;
  /** Base URL ('' = same origin). Cross-origin realms need CORS + SameSite=None on the server. */
  url: string;
}

export interface MeResponse {
  account: {
    id: string;
    displayName: string | null;
    provider: string;
    settings?: AccountSettings;
  } | null;
  characters: CharacterSummary[];
  providers: { discord: boolean; google: boolean; dev: boolean; password: boolean };
}

export interface RealmInfo {
  id: string;
  name: string;
  region: string;
  url: string;
  status: "online" | "maintenance" | "offline";
  population: "High" | "Medium" | "Low";
  ping: number;
}

export const REALM_LIST: RealmInfo[] = [
  { id: "eldor-us", name: "Eldor Prime", region: "US East", url: "", status: "online", population: "High", ping: 24 },
  { id: "shadowglen-eu", name: "Shadowglen", region: "EU Central", url: "", status: "online", population: "Medium", ping: 88 },
  { id: "whispering-us", name: "Whispering Woods", region: "US West", url: "", status: "online", population: "Low", ping: 45 },
  { id: "dev-realm", name: "Dev Sandbox Realm", region: "Local", url: "", status: "online", population: "Low", ping: 1 },
];

const LOCAL_REALM: Realm = { name: "Local Realm", url: "" };

class AppState {
  screen = $state<Screen>("loading");
  me = $state<MeResponse | null>(null);
  activeCharacter = $state<CharacterSummary | null>(null);
  error = $state<string | null>(null);
  realm = $state<Realm>(LOCAL_REALM);
  selectedRealm = $state<RealmInfo>(REALM_LIST[0]);
  private graphicsSaveBound = false;

  setScreen(s: Screen) {
    this.screen = s;
    window.dispatchEvent(new CustomEvent("rc:screen", { detail: s }));
  }

  apiUrl(path: string): string {
    return this.realm.url ? this.realm.url.replace(/\/$/, "") + path : path;
  }

  wsUrl(): string {
    if (this.realm.url) {
      return this.realm.url.replace(/\/$/, "").replace(/^http/, "ws") + "/ws";
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }

  private bindGraphicsSave(): void {
    if (this.graphicsSaveBound || typeof window === "undefined") return;
    this.graphicsSaveBound = true;
    window.addEventListener("rc:graphics-save", ((e: CustomEvent<GraphicsSettings>) => {
      void this.saveGraphicsSettings(e.detail);
    }) as EventListener);
  }

  async saveGraphicsSettings(graphics: GraphicsSettings): Promise<void> {
    if (!this.me?.account) return;
    try {
      await fetch(this.apiUrl("/api/me/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ graphics }),
      });
    } catch {
      /* offline / transient */
    }
  }

  selectRealm(realm: RealmInfo) {
    this.selectedRealm = realm;
    this.realm = { name: realm.name, url: realm.url };
  }

  enterDungeonEditor() {
    this.setScreen("dungeoneditor");
  }

  enterRegionEditor() {
    this.setScreen("regioneditor");
  }

  enterWebsite() {
    this.setScreen("website");
  }

  enterLogin() {
    this.setScreen("login");
  }

  enterCharSelect() {
    this.setScreen("charselect");
  }

  async refresh() {
    this.bindGraphicsSave();
    try {
      const res = await fetch(this.apiUrl("/api/me"), { credentials: "include" });
      this.me = (await res.json()) as MeResponse;
      if (this.me.account?.settings) {
        gameUi.hydrateAccountSettings(this.me.account.settings);
      }
      this.setScreen(this.me.account ? "charselect" : "login");
      this.error = null;
    } catch {
      this.error = `Could not reach ${this.realm.name}`;
      this.setScreen("login");
    }
  }

  async devLogin(name: string) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/auth/dev"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) {
      this.error = (await res?.json().catch(() => null))?.statusMessage ?? "Login failed";
      return;
    }
    await this.refresh();
  }

  async signup(email: string, password: string, displayName?: string) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/auth/signup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, displayName }),
    }).catch(() => null);
    if (!res?.ok) {
      this.error = (await res?.json().catch(() => null))?.statusMessage ?? "Could not create account";
      return;
    }
    await this.refresh();
  }

  async login(email: string, password: string) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (!res?.ok) {
      this.error = (await res?.json().catch(() => null))?.statusMessage ?? "Login failed";
      return;
    }
    await this.refresh();
  }

  async createCharacter(name: string, classId: string, appearance?: Partial<CharacterAppearance>) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/characters"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, classId, ...appearance }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      this.error = data?.statusMessage ?? "Could not create character";
      return;
    }
    await this.refresh();
  }

  enterWorld(character: CharacterSummary) {
    this.activeCharacter = character;
    this.setScreen("ingame");
    // Go fullscreen — this call is within the button-click user gesture.
    void document.documentElement.requestFullscreen?.().catch(() => {});
    window.dispatchEvent(
      new CustomEvent("rc:enterWorld", {
        detail: { characterId: character.id, name: character.name, wsUrl: this.wsUrl() },
      }),
    );
  }

  leaveWorld() {
    window.dispatchEvent(new CustomEvent("rc:leaveWorld"));
    this.activeCharacter = null;
    this.setScreen("charselect");
    void this.refresh();
  }

  async logout() {
    await fetch(this.apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    this.activeCharacter = null;
    await this.refresh();
  }
}

export const app = new AppState();
