import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let version = "0.1.0";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  version = pkg.version;
} catch (e) {}

let commitHash = "unknown";
try {
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch (e) {}

const appVersion = `v${version}-${commitHash}`;

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
    watch: {
      ignored: [
        "**/packages/shared/src/content/dungeonBlueprints/**",
        "**/packages/shared/src/content/regionBlueprints/**",
      ],
    },
  },
});
