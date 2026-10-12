import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 1200 },
  server: { port: 5173, strictPort: true },
});
