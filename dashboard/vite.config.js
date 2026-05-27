import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://localhost:4700';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5700,
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/ingest': backend,
      '/healthz': backend,
    },
  },
});
