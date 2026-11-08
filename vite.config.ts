import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Strict CSP, injected only into production builds (the dev server needs inline scripts for HMR).
// connect-src 'self' means file contents can never be sent to another origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'silent-diff-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// Emits sw.js with the full list of build files to precache.
function serviceWorker(): Plugin {
  return {
    name: 'silent-diff-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).map((f) => './' + f), './favicon.svg'];
      const version = Date.now().toString(36);
      const src = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8')
        .replace('__FILES__', JSON.stringify(files))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), csp(), serviceWorker()],
  worker: { format: 'es' },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
} as any);
