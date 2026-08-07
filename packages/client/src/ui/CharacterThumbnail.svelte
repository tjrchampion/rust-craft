<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import {
    classDef,
    itemDef,
    CLASSES,
    type ClassId,
    type CharacterGender,
    type CharacterAppearance,
  } from "@rustcraft/shared";
  import { AnimatedModel, PLAYER_ANIMS } from "../render/gltf";
  import { GENDER_MODEL_URLS } from "../render/classModels";
  import { applyModularGearFromSnapAsync } from "../render/modularGear";

  let {
    classId = "warrior",
    gender = "male",
    appearance,
    equip = null,
    mode = "head",
  }: {
    classId: ClassId;
    gender?: CharacterGender;
    appearance?: CharacterAppearance;
    equip?: Partial<Record<string, string>> | null;
    mode?: "head" | "full";
  } = $props();

  let canvas: HTMLCanvasElement;

  // Thematic full class armor defaults so character thumbnails are always fully geared
  const CLASS_FULL_ARMOR: Record<ClassId, Record<string, string>> = {
    warrior: {
      head: "knight_helmet",
      chest: "knight_chest",
      arms: "knight_arms",
      legs: "knight_legs",
      feet: "knight_feet",
      shoulders: "knight_pauldrons_round",
    },
    paladin: {
      head: "knight_helmet",
      chest: "knight_chest",
      arms: "knight_arms",
      legs: "knight_legs",
      feet: "knight_feet",
      shoulders: "knight_pauldrons_spike",
    },
    berserker: {
      chest: "knight_chest_cloth",
      arms: "knight_arms",
      legs: "knight_legs",
      feet: "knight_feet",
      shoulders: "knight_horns",
    },
    ranger: {
      head: "ranger_hood",
      chest: "ranger_chest",
      arms: "ranger_arms",
      legs: "ranger_legs",
      feet: "ranger_feet",
      shoulders: "ranger_pauldrons",
    },
    rogue: {
      head: "ranger_hood",
      chest: "ranger_chest",
      arms: "ranger_arms",
      legs: "ranger_legs",
      feet: "ranger_feet",
    },
    assassin: {
      head: "ranger_hood",
      chest: "ranger_chest",
      arms: "ranger_arms",
      legs: "ranger_legs",
      feet: "ranger_feet",
    },
    mage: {
      chest: "wizard_chest",
      arms: "wizard_arms",
      legs: "wizard_legs",
      feet: "wizard_feet",
    },
    cleric: {
      head: "peasant_hood",
      chest: "wizard_chest",
      arms: "wizard_arms",
      legs: "wizard_legs",
      feet: "wizard_feet",
    },
    druid: {
      head: "peasant_hood",
      chest: "wizard_chest",
      arms: "wizard_arms",
      legs: "wizard_legs",
      feet: "wizard_feet",
    },
    engineer: {
      chest: "noble_chest",
      arms: "noble_arms",
      legs: "noble_legs",
      feet: "noble_feet",
      shoulders: "noble_pauldrons",
    },
  };

  onMount(() => {
    let active = true;
    let renderer: THREE.WebGLRenderer | null = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(128, 128, false);

    const scene = new THREE.Scene();
    const fov = mode === "head" ? 32 : 30;
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 10);
    
    if (mode === "head") {
      // Model total height is 1.75m with feet at Y=0. Head/face center is at Y ≈ 1.58m!
      camera.position.set(0, 1.58, 0.55);
      camera.lookAt(0, 1.56, 0);
    } else {
      // Full body view
      camera.position.set(0, 1.0, 2.2);
      camera.lookAt(0, 0.9, 0);
    }

    const ambient = new THREE.AmbientLight(0xfff2da, 0.95);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffe4b0, 1.4);
    keyLight.position.set(-1.5, 2.5, 2);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xa060ff, 1.2);
    rimLight.position.set(1.5, 1, -1.5);
    scene.add(rimLight);

    const model = new AnimatedModel(PLAYER_ANIMS);
    scene.add(model.group);

    const targetGender = gender ?? appearance?.gender ?? "male";
    const app: CharacterAppearance = appearance ?? {
      gender: targetGender,
      hairStyle: "short",
      facialHair: "none",
      hairColor: 0x2b1a12,
      eyeColor: 0x6b4423,
      outfitHue: 0xffffff,
    };

    // Full class armor default merged with character equip
    const defaultArmor = CLASS_FULL_ARMOR[classId] ?? {};
    const effectiveEquip: Partial<Record<string, string>> = {
      head: equip?.head ?? defaultArmor.head ?? null,
      chest: equip?.chest ?? defaultArmor.chest ?? null,
      arms: equip?.arms ?? defaultArmor.arms ?? null,
      legs: equip?.legs ?? defaultArmor.legs ?? null,
      feet: equip?.feet ?? defaultArmor.feet ?? null,
      shoulders: equip?.shoulders ?? defaultArmor.shoulders ?? null,
      neck: equip?.neck ?? defaultArmor.neck ?? null,
    };

    let animReqId: number | null = null;
    let lastTime = performance.now();

    const animate = (now: number) => {
      if (!active || !renderer) return;
      renderer.render(scene, camera);
      animReqId = requestAnimationFrame(animate);
    };

    void model.loadFrom(GENDER_MODEL_URLS[targetGender], 1.75).then(() => {
      if (!active) return;

      void applyModularGearFromSnapAsync(model, targetGender, {
        headId: effectiveEquip.head ?? null,
        chestId: effectiveEquip.chest ?? null,
        armsId: effectiveEquip.arms ?? null,
        legsId: effectiveEquip.legs ?? null,
        feetId: effectiveEquip.feet ?? null,
        shouldersId: effectiveEquip.shoulders ?? null,
        neckId: effectiveEquip.neck ?? null,
      });
      void model.applyAppearance(targetGender, app);

      // Rotate model slightly for a classic 3/4 heroic portrait angle
      model.group.rotation.y = 0.28;
      model.play("idle");
      model.update(0);

      // Start animation loop
      lastTime = performance.now();
      animReqId = requestAnimationFrame(animate);
    });

    return () => {
      active = false;
      if (animReqId !== null) cancelAnimationFrame(animReqId);
      model.dispose();
      renderer?.dispose();
      renderer = null;
    };
  });
</script>

<canvas bind:this={canvas} class="thumb-canvas" width="128" height="128"></canvas>

<style>
  .thumb-canvas {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    border-radius: 6px;
  }
</style>
