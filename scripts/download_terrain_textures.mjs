import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const BASE_URL = "https://raw.githubusercontent.com/levy-street/world-of-claudecraft/main";

const TERRAIN_FILES = [
  "Grass001_Color.jpg",
  "Grass001_NormalGL.jpg",
  "Grass001_AmbientOcclusion.jpg",
  "Grass001_Roughness.jpg",
  "Ground023_Color.jpg",
  "Ground023_NormalGL.jpg",
  "Ground023_AmbientOcclusion.jpg",
  "Ground023_Roughness.jpg",
  "Rock026_Color.jpg",
  "Rock026_NormalGL.jpg",
  "Rock026_AmbientOcclusion.jpg",
  "Rock026_Roughness.jpg",
  "Ground080_Color.jpg",
  "Ground080_NormalGL.jpg",
  "Ground080_AmbientOcclusion.jpg",
  "Ground080_Roughness.jpg",
  "Ground071_Color.jpg",
  "Ground071_NormalGL.jpg",
  "Ground071_AmbientOcclusion.jpg",
  "Ground071_Roughness.jpg",
  "Snow010A_Color.jpg",
  "Snow010A_NormalGL.jpg",
  "Snow010A_AmbientOcclusion.jpg",
  "Snow010A_Roughness.jpg",
  "PavingStones046_Color.jpg",
  "PavingStones046_NormalGL.jpg",
  "PavingStones046_AmbientOcclusion.jpg",
  "PavingStones046_Roughness.jpg",
  "Gravel024_Color.jpg",
  "Gravel024_NormalGL.jpg",
  "Lava004_Color.jpg",
  "Lava004_NormalGL.jpg",
  "Rock051_Color.jpg",
  "Rock051_NormalGL.jpg",
  "GroundAO_Packed.png",
];

const WATER_FILES = [
  "waternormals.jpg",
  "water_1_normal.jpg",
  "water_2_normal.jpg",
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve());
      });
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  const terrainDir = path.resolve("packages/client/public/assets/textures/terrain");
  const waterDir = path.resolve("packages/client/public/assets/textures/water");

  console.log("Downloading terrain textures...");
  for (const f of TERRAIN_FILES) {
    const url = `${BASE_URL}/public/textures/terrain/${f}`;
    const dest = path.join(terrainDir, f);
    console.log(` -> ${f}`);
    try {
      await downloadFile(url, dest);
    } catch (e) {
      console.error(`Error downloading ${f}:`, e.message);
    }
  }

  console.log("Downloading water textures...");
  for (const f of WATER_FILES) {
    const url = `${BASE_URL}/public/textures/water/${f}`;
    const dest = path.join(waterDir, f);
    console.log(` -> ${f}`);
    try {
      await downloadFile(url, dest);
    } catch (e) {
      console.error(`Error downloading ${f}:`, e.message);
    }
  }

  fs.copyFileSync(path.join(terrainDir, "Grass001_Color.jpg"), path.join(terrainDir, "grass.jpg"));
  fs.copyFileSync(path.join(terrainDir, "Ground023_Color.jpg"), path.join(terrainDir, "dirt.jpg"));
  fs.copyFileSync(path.join(terrainDir, "Rock026_Color.jpg"), path.join(terrainDir, "rock.jpg"));
  fs.copyFileSync(path.join(terrainDir, "Ground080_Color.jpg"), path.join(terrainDir, "sand.jpg"));
  fs.copyFileSync(path.join(terrainDir, "Snow010A_Color.jpg"), path.join(terrainDir, "snow.jpg"));
  fs.copyFileSync(path.join(terrainDir, "PavingStones046_Color.jpg"), path.join(terrainDir, "cobble.jpg"));

  console.log("All textures successfully downloaded!");
}

main().catch(console.error);
