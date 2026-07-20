export type Screen = "loading" | "login" | "charselect" | "ingame";

export interface CharacterSummary {
  id: string;
  name: string;
  level: number;
  classId: string;
  /** Currently equipped item id per gear slot (weapon/head/chest/arms/legs/
   *  feet), keyed by GearSlot name -- so the character-select preview can
   *  show what this specific character actually has on. */
  equip?: Partial<Record<string, string>>;
}

export interface Realm {
  name: string;
  /** Base URL ('' = same origin). Cross-origin realms need CORS + SameSite=None on the server. */
  url: string;
}

export interface MeResponse {
  account: { id: string; displayName: string | null; provider: string } | null;
  characters: CharacterSummary[];
  providers: { discord: boolean; google: boolean; dev: boolean; password: boolean };
}

const LOCAL_REALM: Realm = { name: "Local Realm", url: "" };

class AppState {
  screen = $state<Screen>("loading");
  me = $state<MeResponse | null>(null);
  activeCharacter = $state<CharacterSummary | null>(null);
  error = $state<string | null>(null);
  realm = $state<Realm>(LOCAL_REALM);

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

  async createCharacter(name: string, classId: string) {
    this.error = null;
    const res = await fetch(this.apiUrl("/api/characters"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, classId }),
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
