import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-icons',
      closeBundle() {
        // Copy manifest.json
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );

        // Copy icons
        mkdirSync(resolve(__dirname, 'dist/icons'), { recursive: true });
        copyFileSync(
          resolve(__dirname, 'public/icons/icon16.png'),
          resolve(__dirname, 'dist/icons/icon16.png')
        );
        copyFileSync(
          resolve(__dirname, 'public/icons/icon48.png'),
          resolve(__dirname, 'dist/icons/icon48.png')
        );
        copyFileSync(
          resolve(__dirname, 'public/icons/icon128.png'),
          resolve(__dirname, 'dist/icons/icon128.png')
        );
      },
    },
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel/index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        // content-live-mode removed - built separately with vite.config.content.ts
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        format: 'es',
      },
    },
  },
});
