import { defineConfig } from 'astro/config';

// Static output: the page does all its work in the browser and has no server, no secrets and no network calls.
// It is published as a GitHub Pages project page, so every address starts with `/sorogate`. If the repository is
// renamed or the page moves to its own domain, change `site` and `base` here.
export default defineConfig({
  output: 'static',
  site: 'https://sorogate.github.io',
  base: '/sorogate',
  devToolbar: { enabled: false },
});
