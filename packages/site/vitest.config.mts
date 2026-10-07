import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The page uses the SDK's source directly, so its tests do not depend on the SDK having been built first.
    alias: { '@sorogate/sdk/model': fileURLToPath(new URL('../sdk/src/model.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
