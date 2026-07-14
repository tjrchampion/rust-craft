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
  /** Edge-triggered (true on the frame they fire). */
  interactPressed: boolean;
  attackPressed: boolean;
  /** Index into learnedSpells the player wants to cast this frame, or null. */
  castSlot: number | null;
  inventoryPressed: boolean;
  chatPressed: boolean;
  respawnPressed: boolean;
  pvpTogglePressed: boolean;
  mountPressed: boolean; // G: toggle mount / raft
  targetPressed: boolean; // CapsLock: cycle/clear nearest enemy
  clearTargetPressed: boolean; // Escape
  mapPressed: boolean; // M: toggle world map
  hotbarDelta: number; // -1 | 0 | 1 from wheel / dpad
  hotbarSlot: number | null; // direct 1-6 selection
  menuUp: boolean;
  menuDown: boolean;
  menuLeft: boolean;
  menuRight: boolean;
  menuConfirm: boolean;
  menuCancel: boolean;
}

const GAMEPAD_DEADZONE = 0.18;
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

    const pressed = (code: string) => this.pressedQueue.has(code);
    let interactPressed = pressed("KeyE");
    let attackPressed = this.mouseAttackQueued || pressed("KeyF");
    let castSlot: number | null = null;
    if (pressed("KeyQ")) castSlot = 0;
    else if (pressed("KeyZ")) castSlot = 1;
    else if (pressed("KeyX")) castSlot = 2;
    else if (pressed("KeyC")) castSlot = 3;
    let inventoryPressed = pressed("Tab") || pressed("KeyI");
    const chatPressed = pressed("Enter");
    let respawnPressed = pressed("KeyR");
    const pvpTogglePressed = pressed("KeyP");
    let mountPressed = pressed("KeyG");
    let mapPressed = pressed("KeyM");
    // CapsLock cycles to / clears the nearest enemy target.
    let targetPressed = this.capsQueued;
    this.capsQueued = false;
    let clearTargetPressed = pressed("Escape");
    let hotbarDelta = Math.sign(this.wheelDelta);
    let hotbarSlot: number | null = null;
    for (let i = 1; i <= 6; i++) {
      if (pressed(`Digit${i}`)) hotbarSlot = i - 1;
    }
    let menuUp = pressed("ArrowUp");
    let menuDown = pressed("ArrowDown");
    let menuLeft = pressed("ArrowLeft");
    let menuRight = pressed("ArrowRight");
    let menuConfirm = pressed("Enter") || pressed("KeyE");
    let menuCancel = pressed("Escape") || pressed("Tab") || pressed("KeyI");

    // --- gamepad (standard mapping) ---
    if (pad) {
      const padPressed = (i: number) => {
        const now = pad.buttons[i]?.pressed ?? false;
        const before = this.prevPadButtons[i] ?? false;
        return now && !before;
      };
      const ax = dz(pad.axes[0] ?? 0);
      const ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);

      if (Math.abs(ax) + Math.abs(ay) + Math.abs(rx) + Math.abs(ry) > 0.05 || pad.buttons.some((b) => b.pressed)) {
        this.lastDevice = "gamepad";
      }

      moveX += ax;
      moveY += ay;
      lookX += -rx * STICK_LOOK_SPEED * dt;
      lookY += -ry * STICK_LOOK_SPEED * dt;
      jump ||= pad.buttons[0]?.pressed ?? false; // A / Cross
      // Run by default; hold L3 to walk carefully.
      if (pad.buttons[10]?.pressed) sprint = false;

      interactPressed ||= padPressed(2); // X / Square
      attackPressed ||= padPressed(7) || padPressed(5); // RT or RB
      if (castSlot === null && padPressed(3)) castSlot = 0; // Y / Triangle: primary spell
      inventoryPressed ||= padPressed(9); // Start
      respawnPressed ||= padPressed(0);
      mountPressed ||= padPressed(8); // Back/Select: toggle mount
      targetPressed ||= padPressed(4); // LB: snap/cycle target
      clearTargetPressed ||= padPressed(6); // LT: clear target
      mapPressed ||= padPressed(11); // R3: toggle world map
      if (padPressed(14)) hotbarDelta -= 1; // dpad left
      if (padPressed(15)) hotbarDelta += 1; // dpad right

      menuUp ||= padPressed(12) || (this.edgeAxis(pad, 1, -1) ?? false);
      menuDown ||= padPressed(13) || (this.edgeAxis(pad, 1, 1) ?? false);
      menuLeft ||= padPressed(14) || (this.edgeAxis(pad, 0, -1) ?? false);
      menuRight ||= padPressed(15) || (this.edgeAxis(pad, 0, 1) ?? false);
      menuConfirm ||= padPressed(0); // A
      menuCancel ||= padPressed(1) || padPressed(9); // B / Start

      this.prevPadButtons = pad.buttons.map((b) => b.pressed);
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
      attackPressed = false;
      castSlot = null;
      interactPressed = false;
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
      interactPressed,
      attackPressed,
      castSlot,
      inventoryPressed,
      chatPressed,
      respawnPressed,
      pvpTogglePressed,
      mountPressed,
      targetPressed,
      clearTargetPressed,
      mapPressed,
      hotbarDelta,
      hotbarSlot,
      menuUp,
      menuDown,
      menuLeft,
      menuRight,
      menuConfirm,
      menuCancel,
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
