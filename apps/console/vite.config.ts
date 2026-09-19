import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// FROZEN (W0-4). Run 1 units change page and panel bodies, never this file.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
