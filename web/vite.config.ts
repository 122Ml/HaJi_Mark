import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler|@tanstack)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          if (/[\\/](react-markdown|remark-|rehype-|katex|micromark|mdast|hast|unist|vfile|property-information|comma-separated-tokens|space-separated-tokens|decode-named-character-reference|character-entities|bail|trough|devlop)[\\/]/.test(id)) {
            return 'markdown-katex';
          }
          if (/[\\/](antd|@ant-design|rc-|@rc-component|dayjs|async-validator|classnames|scroll-into-view-if-needed|compute-scroll-into-view|@babel|@ctrl|resize-observer-polyfill|copy-to-clipboard|toggle-selection|throttle-debounce)[\\/]/.test(id)) {
            return 'antd-vendor';
          }
          return undefined;
        },
      },
    },
  },
  // Compose exposes only the web gateway. Preserve the browser Host for Origin checks.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:18080', changeOrigin: false } } },
});
