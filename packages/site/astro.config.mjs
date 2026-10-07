import { defineConfig } from 'astro/config';

// Static output: the page does all its work in the browser and has no server, no secrets and no network calls.
// Set `site` (and `base`, for a project page) here when it is published somewhere.
export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
});
