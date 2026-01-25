import { defineConfig, Plugin } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// Plugin to exclude playwright from renderer bundle
function excludePlaywright(): Plugin {
  return {
    name: 'exclude-playwright',
    resolveId(id) {
      if (
        id === 'playwright' ||
        id === 'playwright-core' ||
        id === 'chromium-bidi' ||
        id.startsWith('chromium-bidi/') ||
        id.startsWith('playwright-core/')
      ) {
        return { id: 'data:text/javascript,export default {}', external: true }
      }
    },
  }
}

export default defineConfig({
  server: {
    port: 5178,
  },
  optimizeDeps: {
    exclude: ['playwright', 'playwright-core', 'chromium-bidi'],
  },
  plugins: [
    react(),
    excludePlaywright(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            commonjsOptions: {
              ignoreTryCatch: false,
            },
            rollupOptions: {
              external: [
                'playwright',
                'playwright-core',
                'chromium-bidi',
                /^chromium-bidi\/.*/,
                /^playwright-core\/.*/,
              ],
            },
          },
          optimizeDeps: {
            exclude: ['playwright', 'playwright-core', 'chromium-bidi'],
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
})
