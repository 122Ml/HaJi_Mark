import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Compose exposes only the web gateway. Preserve the browser Host for Origin checks.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:18080', changeOrigin: false } } },
});
