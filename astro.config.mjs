// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";

const isDev = process.argv.includes("dev");

// https://astro.build/config
export default defineConfig({
  site: "https://vega.8man.in",

  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },

  // Local development uses Astro's native asset server. The deployment worker
  // serves compiled files and must not intercept Vite's source/image requests.
  adapter: isDev ? node({mode: "standalone"}) : cloudflare({
    imageService: "compile",
  }),
});
