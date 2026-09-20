import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// FROZEN (W0-4). Run 1 units change page and panel bodies, never this file.
export default defineConfig({
  plugins: [react()],
  // Bind IPv4 explicitly: Vite otherwise listened on [::1] only, and a browser
  // resolving localhost to 127.0.0.1 got a connection error (DECISIONS S1-2).
  server: { host: '127.0.0.1', port: 5173, strictPort: false },

  preview: { host: '127.0.0.1', port: 4173 },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
