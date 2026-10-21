// @ts-check
import { defineConfig } from "astro/config";

// The smallest site the shared workflows can build: public npm packages only.
export default defineConfig({ output: "static", devToolbar: { enabled: false } });
