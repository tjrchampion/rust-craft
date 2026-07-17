/**
 * Action-based input layer. Keyboard/mouse and Gamepad API feed the same
 * action state; game code never reads raw keys. The HUD reads `lastDevice`
 * to swap button glyphs.
 */
export type InputDevice = "kbm" | "gamepad";

export interface FrameActions {
  /** Movement intent, camera-relative, magnitude <= 1. */
  moveX: number;
  moveY: number;
  /** Camera deltas for this frame (radians-ish). */
  lookX: number;
  lookY: number;
  jump: boolean;
  sprint: boolean;
  block: boolean; // V (held): shield block -- roots movement, halves damage
  /** Edge-triggered (true on the frame they fire). */
  interactPressed: boolean;
  /** Level-triggered (true every frame the button/key is down) -- for the
   *  hold-to-revive channel, which needs a duration, not just an edge. */
  interactHeld: boolean;
  attackPressed: boolean;
  /** Double-tap W/A/S/D on keyboard, Y/Triangle (btn 3) on gamepad -- a
   *  quick directional burst move. Not bound to gamepad B: B is already
   *  essential (clear target, plus the LB/RB hotbar chords), so Y is used
   *  instead even though the original ask was for B. */
  dodgePressed: boolean;
  inventoryPressed: boolean;
  spellbookPressed: boolean; // K: toggle Spell Book tab
  craftingPressed: boolean; // J: toggle Crafting tab
  systemPressed: boolean; // O: toggle System tab
  chatPressed: boolean;
  respawnPressed: boolean;
  pvpTogglePressed: boolean;
  mountPressed: boolean; // G: toggle mount / raft
  targetPressed: boolean; // CapsLock: cycle/clear nearest enemy
  clearTargetPressed: boolean; // gamepad B only -- keyboard has no bind (Escape does nothing but exit fullscreen)
  mapPressed: boolean; // M: toggle world map
  systemMenuPressed: boolean; // gamepad Start only -- toggle the System tab
  hotbarDelta: number; // -1 | 0 | 1 from wheel / dpad
  /** Direct selection into the unified 10-slot action bar: 0-5 are number
   *  keys 1-6, 6-9 are Q/Z/X/C. Game.ts decides cast-vs-select by checking
   *  what's actually socketed in that slot. On gamepad, reached via the
   *  LB/RB chords documented on lbHeldSince below. */
  hotbarSlot: number | null;
  menuUp: boolean;
  menuDown: boolean;
  menuLeft: boolean;
  menuRight: boolean;
  menuConfirm: boolean;
  menuCancel: boolean;
  menuClear: boolean;
  /** Gamepad LB/RB only, no keyboard equivalent -- cycle tabs (Inventory /
   *  Spell Book / Crafting / System) while the character screen is open. */
  tabPrevPressed: boolean;
  tabNextPressed: boolean;
}

const GAMEPAD_DEADZONE = 0.18;
/** Window between two taps of the same movement key to count as a
 *  double-tap-to-dodge, rather than two unrelated presses. */
const DOUBLE_TAP_MS = 280;
const STICK_LOOK_SPEED = 2.6; // rad/s at full deflection
const MOUSE_SENSITIVITY = 0.0024;

function dz(v: number): number {
  return Math.abs(v) < GAMEPAD_DEADZONE ? 0 : v;
}

export class InputManager {
  lastDevice: InputDevice = "kbm";
  /** When true (menus open), movement/attack actions are suppressed. */
  uiMode = false;

  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheelDelta = 0;
  private pressedQueue = new Set<string>();
  private mouseAttackQueued = false;
  private capsQueued = false;
  private lastCapsAt = 0;
  private pointerLocked = false;
  private prevPadButtons: boolean[] = [];
  private canvas: HTMLCanvasElement;
  /** LB/RB tap-vs-hold-chord disambiguation: a bare tap keeps the button's
   *  normal meaning (LB = cycle/snap target, RB = attack), but holding it
   *  down and pressing a face button or d-pad direction jumps to an action-
   *  bar slot instead -- the bare-tap action only fires on release, and only
   *  if no chord fired during the hold. Same deferred-edge idea as the
   *  CapsLock debounce below. Between the two modifiers, all 10 unified
   *  action-bar slots (1-6, Q, Z, X, C) are reachable on a 4-face-button pad:
   *  LB+{A,B,X,Y} -> slots 0-3, LB+dpad{Up,Down,Left,Right} -> slots 4-7,
   *  RB+{A,B} -> slots 8-9. */
  private lbHeldSince: number | null = null;
  private lbChordUsed = false;
  private rbHeldSince: number | null = null;
  private rbChordUsed = false;
  /** Timestamp of the last tap of each WASD key, for double-tap-to-dodge. */
  private lastTapTime: Partial<Record<string, number>> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener("keydown", (e) => {
      if (this.isTypingTarget(e.target)) return;
      this.lastDevice = "kbm";
      // CapsLock is a toggle: on macOS it only fires keydown when turning ON
      // and keyup when turning OFF. Treat every edge as one target press,
      // debounced so platforms that fire both don't double-trigger.
      if (e.code === "CapsLock") {
        this.queueCaps();
        return;
      }
      if (!e.repeat) this.pressedQueue.add(e.code);
      this.keys.add(e.code);
      if (["Space", "Tab", "KeyE"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "CapsLock") {
        this.queueCaps();
        return;
      }
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("click", () => {
      if (!this.uiMode && !this.pointerLocked) void canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        this.mouseDx += e.movementX;
        this.mouseDy += e.movementY;
      }
    });
    window.addEventListener("mousedown", (e) => {
      if (this.pointerLocked && e.button === 0) {
        this.lastDevice = "kbm";
        this.mouseAttackQueued = true;
      }
    });
    window.addEventListener("wheel", (e) => {
      if (this.pointerLocked) this.wheelDelta += Math.sign(e.deltaY);
    });
    window.addEventListener("gamepadconnected", () => {
      this.lastDevice = "gamepad";
    });
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  }

  /** True the frame a movement key is tapped twice within DOUBLE_TAP_MS --
   *  drives keyboard dodge instead of a dedicated key. Direction itself
   *  still comes from whichever WASD keys are held (see Game.tryDodge), so
   *  this only needs to detect the double-tap edge, not track which key. */
  private checkDoubleTap(code: string): boolean {
    const now = performance.now();
    const last = this.lastTapTime[code] ?? 0;
    this.lastTapTime[code] = now;
    return now - last < DOUBLE_TAP_MS;
  }

  /** Debounced CapsLock edge (handles the macOS on/off-only quirk). */
  private queueCaps(): void {
    const now = performance.now();
    if (now - this.lastCapsAt < 150) return;
    this.lastCapsAt = now;
    this.capsQueued = true;
  }

  releasePointer(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  requestPointer(): void {
    if (!this.pointerLocked) {
      void this.canvas.requestPointerLock();
    }
  }

  get hasPointerLock(): boolean {
    return this.pointerLocked;
  }

  /** Sample and reset per-frame input. Call once per rAF with dt in seconds. */
  sample(dt: number): FrameActions {
    const pad = navigator.getGamepads?.()[0] ?? null;

    // --- keyboard/mouse ---
    let moveX = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    let moveY = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    let lookX = -this.mouseDx * MOUSE_SENSITIVITY;
    let lookY = -this.mouseDy * MOUSE_SENSITIVITY;
    let jump = this.keys.has("Space");
    // Hold Shift to run; walk otherwise.
    let sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    // Hold V to raise a shield block.
    let block = this.keys.has("KeyV");

    const pressed = (code: string) => this.pressedQueue.has(code);
    let interactPressed = pressed("KeyE");
    let interactHeld = this.keys.has("KeyE");
    let attackPressed = this.mouseAttackQueued;
    // Double-tap W/A/S/D to dodge (rather than a dedicated key) -- direction
    // comes from whichever of those keys is actually held at the moment of
    // the second tap, same as any other movement input.
    let dodgePressed = false;
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
      if (pressed(code) && this.checkDoubleTap(code)) dodgePressed = true;
    }
    let inventoryPressed = pressed("Tab") || pressed("KeyI");
    const spellbookPressed = pressed("KeyK");
    const craftingPressed = pressed("KeyJ");
    const systemPressed = pressed("KeyO");
    const chatPressed = pressed("Enter");
    let respawnPressed = pressed("KeyR");
    let pvpTogglePressed = pressed("KeyP");
    let mountPressed = pressed("KeyG");
    let mapPressed = pressed("KeyM");
    let systemMenuPressed = false; // gamepad-only, no keyboard equivalent needed
    let tabPrevPressed = false; // gamepad-only, no keyboard equivalent needed
    let tabNextPressed = false; // gamepad-only, no keyboard equivalent needed
    // CapsLock cycles to / clears the nearest enemy target.
    let targetPressed = this.capsQueued;
    this.capsQueued = false;
    let clearTargetPressed = false; // gamepad-only, see FrameActions doc comment
    let hotbarDelta = Math.sign(this.wheelDelta);
    let hotbarSlot: number | null = null;
    for (let i = 1; i <= 6; i++) {
      if (pressed(`Digit${i}`)) hotbarSlot = i - 1;
    }
    // Q/Z/X/C are slots 6-9 of the same unified bar (not a separate spell-only zone).
    if (pressed("KeyQ")) hotbarSlot = 6;
    else if (pressed("KeyZ")) hotbarSlot = 7;
    else if (pressed("KeyX")) hotbarSlot = 8;
    else if (pressed("KeyC")) hotbarSlot = 9;
    let menuUp = pressed("ArrowUp");
    let menuDown = pressed("ArrowDown");
    let menuLeft = pressed("ArrowLeft");
    let menuRight = pressed("ArrowRight");
    let menuConfirm = pressed("Enter") || pressed("KeyE");
    let menuCancel = pressed("Tab") || pressed("KeyI");
    let menuClear = pressed("KeyX") || pressed("Backspace") || pressed("Delete");

    // --- gamepad (standard mapping) ---
    if (pad) {
      // Analog triggers (LT/RT, btns 6/7) report a real 0..1 `.value`, but
      // `.pressed` on them is unreliable across browsers/drivers -- it can
      // stay false until the trigger is pulled almost all the way, or never
      // flip at all. Treat any button as "held" past a light pull so Block
      // and RT-attack aren't dead/laggy on hardware where that happens.
      const TRIGGER_THRESHOLD = 0.3;
      const padHeld = (i: number): boolean => {
        const btn = pad.buttons[i];
        if (!btn) return false;
        return btn.pressed || btn.value > TRIGGER_THRESHOLD;
      };
      const padPressed = (i: number) => {
        const now = padHeld(i);
        const before = this.prevPadButtons[i] ?? false;
        return now && !before;
      };
      const ax = dz(pad.axes[0] ?? 0);
      const ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);

      if (Math.abs(ax) + Math.abs(ay) + Math.abs(rx) + Math.abs(ry) > 0.05 || pad.buttons.some((_, i) => padHeld(i))) {
        this.lastDevice = "gamepad";
      }

      moveX += ax;
      moveY += ay;
      lookX += -rx * STICK_LOOK_SPEED * dt;
      lookY += -ry * STICK_LOOK_SPEED * dt;
      // Run by default; hold L3 to walk carefully.
      if (padHeld(10)) sprint = false;

      // LB/RB also cycle tabs (Inventory/Spell Book/Crafting/System) when the
      // character screen is open -- a plain press-edge, not the deferred
      // tap-vs-hold dance below, since there's no competing chord meaning to
      // disambiguate against while a menu (not gameplay) is what's active.
      // Game.ts only acts on these while that screen is actually open.
      tabPrevPressed = padPressed(4);
      tabNextPressed = padPressed(5);

      // LB (btn 4): a bare tap cycles/snaps target; held, it turns the face
      // buttons and d-pad into action-bar slots 0-3 (1/2/3/4) and 4-7
      // (5/6/Q/Z). RB (btn 5): a bare tap attacks (same as RT); held, it
      // turns A/B into slots 8-9 (X/C). Either bare-tap action only fires on
      // release, and only if no chord fired during the hold -- we can't know
      // a plain tap was "just a tap" until the button comes back up.
      const lbHeld = padHeld(4);
      if (lbHeld && this.lbHeldSince === null) {
        this.lbHeldSince = performance.now();
        this.lbChordUsed = false;
      }
      if (lbHeld) {
        if (padPressed(0)) {
          hotbarSlot = 0;
          this.lbChordUsed = true;
        } else if (padPressed(1)) {
          hotbarSlot = 1;
          this.lbChordUsed = true;
        } else if (padPressed(2)) {
          hotbarSlot = 2;
          this.lbChordUsed = true;
        } else if (padPressed(3)) {
          hotbarSlot = 3;
          this.lbChordUsed = true;
        } else if (padPressed(12)) {
          hotbarSlot = 4;
          this.lbChordUsed = true;
        } else if (padPressed(13)) {
          hotbarSlot = 5;
          this.lbChordUsed = true;
        } else if (padPressed(14)) {
          hotbarSlot = 6;
          this.lbChordUsed = true;
        } else if (padPressed(15)) {
          hotbarSlot = 7;
          this.lbChordUsed = true;
        }
      }
      if (!lbHeld && this.lbHeldSince !== null) {
        if (!this.lbChordUsed) targetPressed = true;
        this.lbHeldSince = null;
        this.lbChordUsed = false;
      }

      const rbHeld = padHeld(5);
      if (rbHeld && this.rbHeldSince === null) {
        this.rbHeldSince = performance.now();
        this.rbChordUsed = false;
      }
      if (rbHeld) {
        if (padPressed(0)) {
          hotbarSlot = 8;
          this.rbChordUsed = true;
        } else if (padPressed(1)) {
          hotbarSlot = 9;
          this.rbChordUsed = true;
        }
      }
      if (!rbHeld && this.rbHeldSince !== null) {
        if (!this.rbChordUsed) attackPressed = true;
        this.rbHeldSince = null;
        this.rbChordUsed = false;
      }

      // Face buttons and d-pad double as the chord layers above -- only fire
      // their own bare action when neither LB nor RB is being held as a
      // modifier this frame.
      if (!lbHeld && !rbHeld) {
        jump ||= padPressed(0); // A / Cross
        clearTargetPressed ||= padPressed(1); // B: clear target -> close panels -> open menu
        interactPressed ||= padPressed(2); // X / Square
        interactHeld ||= padHeld(2);
        dodgePressed ||= padPressed(3); // Y / Triangle
      }
      if (!lbHeld) {
        mountPressed ||= padPressed(12); // dpad up: toggle mount
        pvpTogglePressed ||= padPressed(13); // dpad down: toggle PvP
        if (padPressed(14)) hotbarDelta -= 1; // dpad left
        if (padPressed(15)) hotbarDelta += 1; // dpad right
      }
      attackPressed ||= padPressed(7); // RT (RB's own attack-tap is handled above via the chord dance)
      block ||= padHeld(6); // LT (held): shield block
      inventoryPressed ||= padPressed(8); // Back/View: inventory
      systemMenuPressed ||= padPressed(9); // Start: dedicated pause menu
      respawnPressed ||= padPressed(0);
      mapPressed ||= padPressed(11); // R3: toggle world map

      menuUp ||= padPressed(12) || (this.edgeAxis(pad, 1, -1) ?? false);
      menuDown ||= padPressed(13) || (this.edgeAxis(pad, 1, 1) ?? false);
      menuLeft ||= padPressed(14) || (this.edgeAxis(pad, 0, -1) ?? false);
      menuRight ||= padPressed(15) || (this.edgeAxis(pad, 0, 1) ?? false);
      menuConfirm ||= padPressed(0); // A
      menuCancel ||= padPressed(1); // B
      menuClear ||= padPressed(2); // X / Square

      this.prevPadButtons = pad.buttons.map((_, i) => padHeld(i));
      this.prevAxes = [...pad.axes];
    }

    // reset per-frame accumulators
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheelDelta = 0;
    this.pressedQueue.clear();
    this.mouseAttackQueued = false;

    if (this.uiMode) {
      moveX = 0;
      moveY = 0;
      lookX = 0;
      lookY = 0;
      jump = false;
      sprint = false;
      block = false;
      pvpTogglePressed = false;
      mountPressed = false;
      attackPressed = false;
      dodgePressed = false;
      interactPressed = false;
      interactHeld = false;
      targetPressed = false;
      hotbarDelta = 0;
      hotbarSlot = null;
    }

    return {
      moveX,
      moveY,
      lookX,
      lookY,
      jump,
      sprint,
      block,
      interactPressed,
      interactHeld,
      attackPressed,
      dodgePressed,
      inventoryPressed,
      spellbookPressed,
      craftingPressed,
      systemPressed,
      chatPressed,
      respawnPressed,
      pvpTogglePressed,
      mountPressed,
      targetPressed,
      clearTargetPressed,
      mapPressed,
      systemMenuPressed,
      hotbarDelta,
      hotbarSlot,
      menuUp,
      menuDown,
      menuLeft,
      menuRight,
      menuConfirm,
      menuCancel,
      menuClear,
      tabPrevPressed,
      tabNextPressed,
    };
  }

  private prevAxes: number[] = [];

  /** Edge-detect a stick pushed past threshold (menu navigation with sticks). */
  private edgeAxis(pad: Gamepad, axis: number, dir: -1 | 1): boolean {
    const now = (pad.axes[axis] ?? 0) * dir > 0.6;
    const before = (this.prevAxes[axis] ?? 0) * dir > 0.6;
    return now && !before;
  }
}
