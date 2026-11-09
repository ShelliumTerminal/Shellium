import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// The app version shown in Help > About comes from package.json (bumped by `npm version`).
const appVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version as string

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }: { startup: () => Promise<void> }) {
          delete process.env.ELECTRON_RUN_AS_NODE
          startup()
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['sql.js/dist/sql-asm.js', 'ssh2'],
            },
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