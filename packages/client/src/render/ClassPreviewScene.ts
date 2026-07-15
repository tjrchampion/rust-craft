import * as THREE from "three";
import { CLASS_IDS, classDef, itemDef, type ClassId } from "@rustcraft/shared";
import { AnimatedModel, PLAYER_ANIMS } from "./gltf";
import { CLASS_MODEL_URLS, CLASS_WEAPON_NODES } from "./classModels";

/**
 * Small self-contained turntable viewer for the character-creation screen:
 * one AnimatedModel per class, preloaded and kept in the scene (hidden)
 * so switching the preview is instant instead of re-fetching/re-cloning.
 */
export class ClassPreviewScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private models = new Map<ClassId, AnimatedModel>();
  private activeId: ClassId | null = null;
  private running = true;
  private lastFrame = performance.now();
  private yaw = 0;
  private autoRotate = true;
  private dragging = false;
  private moved = false;
  private lastPointerX = 0;
  private downX = 0;
  private downY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.05, 5.2);
    this.camera.lookAt(0, 0.95, 0);

    this.scene.add(new THREE.AmbientLight(0xfff2da, 1.0));
    const key = new THREE.DirectionalLight(0xffe4b0, 1.6);
    key.position.set(-2, 3, 2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db9ff, 0.6);
    rim.position.set(2, 1.5, -2);
    this.scene.add(rim);

    this.resize();
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    requestAnimationFrame(this.frame);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Load every class model up front so hover/select never has to wait. */
  async preloadAll(): Promise<void> {
    await Promise.all(CLASS_IDS.map((id) => this.ensureLoaded(id)));
  }

  private async ensureLoaded(id: ClassId): Promise<AnimatedModel> {
    let model = this.models.get(id);
    if (!model) {
      model = new AnimatedModel(PLAYER_ANIMS);
      model.group.visible = false;
      this.scene.add(model.group);
      this.models.set(id, model);
      await model.loadFrom(CLASS_MODEL_URLS[id], 1.75);
      const weaponGear = classDef(id).startingGear.find((g) => g.slot === "weapon");
      const def = weaponGear ? itemDef(weaponGear.itemId) : null;
      model.setWeapon(def?.weaponModel ?? [], CLASS_WEAPON_NODES[id] ?? []);
      void model.setWeaponProp(def?.weaponProp ?? null);
    }
    return model;
  }

  /** Switch the visible turntable model. Loads on demand if not preloaded yet. */
  setClass(id: ClassId): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.yaw = 0;
    void this.ensureLoaded(id).then(() => {
      if (this.activeId !== id) return; // superseded by a later hover/select
      for (const [otherId, m] of this.models) m.group.visible = otherId === id;
    });
  }

  /** Play a celebratory flourish animation on the currently visible model. */
  flourish(): void {
    const model = this.activeId ? this.models.get(this.activeId) : null;
    if (!model?.loaded) return;
    model.play("cheer");
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.autoRotate = false;
    this.moved = false;
    this.lastPointerX = e.clientX;
    this.downX = e.clientX;
    this.downY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;
    if (Math.abs(e.clientX - this.downX) > 4 || Math.abs(e.clientY - this.downY) > 4) this.moved = true;
    this.yaw += dx * 0.012;
  };

  private onPointerUp = (): void => {
    if (this.dragging && !this.moved) this.flourish();
    this.dragging = false;
    this.autoRotate = true;
  };

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.autoRotate) this.yaw += dt * 0.5;
    const model = this.activeId ? this.models.get(this.activeId) : null;
    if (model) {
      model.group.rotation.y = this.yaw;
      model.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.running = false;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.dispose();
  }
}
