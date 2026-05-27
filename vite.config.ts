import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { intradayCachePlugin } from "./vite.intraday-cache-plugin.js";

export default defineConfig({
  plugins: [react(), intradayCachePlugin()],
});
