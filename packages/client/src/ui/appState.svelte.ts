export type Screen = "loading" | "login" | "charselect" | "ingame";

export interface CharacterSummary {
  id: string;
  name: string;
  level: number;
}

export interface Realm {
  name: string;
  /** Base URL ('' = same origin). Cross-origin realms need CORS + SameSite=None on the server. */
  url: string;
}

export interface MeResponse {
  account: { id: string; displayName: string | null; provider: string } | null;
  characters: CharacterSummary[];
  providers: { discord: boolean; google: boolean; dev: boolean };
}

const LOCAL_REALM: Realm = { name: "Local Realm", url: "" };

function loadRealms(): Realm[] {
  try {
    const saved = JSON.parse(localStorage.getItem("rc_realms") ?? "[]") as Realm[];
    return [LOCAL_REALM, ...saved.filter((r) => r.url)];
  } catch {
    return [LOCAL_REALM];
  }
}

class AppState {
  screen = $state<Screen>("loading");
  me = $state<MeResponse | null>(null);
  activeCharacter = $state<CharacterSummary | null>(null);
  error = $state<string | null>(null);
  realms = $state<Realm[]>(loadRealms());
  realm = $state<Realm>(LOCAL_REALM);

  constructor() {
    const savedName = localStorage.getItem("rc_realm");
    const found = this.realms.find((r) => r.name === savedName);
    if (found) this.realm = found;
  }

  private setScreen(s: Screen) {
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

  selectRealm(realm: Realm) {
    this.realm = realm;
    localStorage.setItem("rc_realm", realm.name);
    void this.refresh();
  }

  addRealm(name: string, url: string) {
    const trimmedUrl = url.trim().replace(/\/$/, "");
    const trimmedName = name.trim() || trimmedUrl;
    if (!/^https?:\/\//.test(trimmedUrl)) {
      this.error = "Realm URL must start with http(s)://";
      return;
    }
    const realm: Realm = { name: trimmedName, url: trimmedUrl };
    this.realms = [...this.realms.filter((r) => r.name !== trimmedName), realm];
    localStorage.setItem("rc_realms", JSON.stringify(this.realms.filter((r) => r.url)));
    this.selectRealm(realm);
  }

  removeRealm(realm: Realm) {
    if (!realm.url) return; // can't remove local
    this.realms = this.realms.filter((r) => r.name !== realm.name);
    localStorage.setItem("rc_realms", JSON.stringify(this.realms.filter((r) => r.url)));
    if (this.realm.name === realm.name) this.selectRealm(this.realms[0]!);
  }

  async refresh() {
    try {
      const res = await fetch(this.apiUrl("/api/me"), { credentials: "include" });
      this.me = (await res.json()) as MeResponse;
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

  async createCharacter(name: string) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/characters"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
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
