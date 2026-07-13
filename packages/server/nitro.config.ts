import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  compatibilityDate: "2026-07-11",
  srcDir: ".",
  experimental: {
    websocket: true,
  },
  imports: false,
});
