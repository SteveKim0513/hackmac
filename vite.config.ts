import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: { build: { rollupOptions: { external: ['electron-log', 'electron-log/main'] } } },
        onstart(args) {
          // VS Code sets ELECTRON_RUN_AS_NODE=1 which makes Electron act as
          // plain Node.js (no app.whenReady, no BrowserWindow). Unset it so
          // dev mode works when launched from an integrated terminal.
          delete process.env.ELECTRON_RUN_AS_NODE;
          args.startup();
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  base: './',
  build: {
    outDir: 'dist',
  },
});
