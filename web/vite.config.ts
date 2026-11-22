import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function stripLegacyKatexFonts(): Plugin {
  return {
    name: 'strip-legacy-katex-fonts',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0];
      if (!cleanId.includes('katex') || !cleanId.endsWith('.css')) {
        return null;
      }
      const stripped = code.replace(
        /(src\s*:\s*)([^;}]+)/gi,
        (_match, prefix: string, list: string) => {
          const kept = list
            .split(',')
            .map((item) => item.trim())
            .filter(
              (item) =>
                !/url\([^)]+\.(?:woff(?!2)|ttf)(?:[?#][^)]*)?\)/i.test(item),
            );
          return kept.length ? `${prefix}${kept.join(', ')}` : `${prefix}${list}`;
        },
      );
      return { code: stripped, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripLegacyKatexFonts(), react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            /[\\/](react|react-dom|react-router|react-router-dom|scheduler|@tanstack)[\\/]/.test(
              id,
            )
          ) {
            return 'react-vendor';
          }
          if (
            /[\\/](react-markdown|remark-|rehype-|katex|micromark|mdast|hast|unist|vfile|property-information|comma-separated-tokens|space-separated-tokens|decode-named-character-reference|character-entities|bail|trough|devlop)[\\/]/.test(
              id,
            )
          ) {
            return 'markdown-katex';
          }
          return undefined;
        },
      },
    },
  },
  // Compose exposes only the web gateway. Preserve the browser Host for Origin checks.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:18080', changeOrigin: false } } },
});
