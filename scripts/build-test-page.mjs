/**
 * build-test-page.mjs - bundle the test suite into one standalone HTML page.
 *
 * The normal page at test/index.html uses ES modules, which browsers only load
 * over http://. This script bundles the same tests into a plain script and
 * inlines it, so the result opens from file:// with no server and no install.
 *
 * Output: dist/chip8-tests.html
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'dist');

const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    lib: {
      entry: join(root, 'test', 'standalone-entry.js'),
      formats: ['iife'],
      name: 'Chip8Tests',
      fileName: () => 'chip8-tests.js',
    },
  },
});

const bundles = Array.isArray(result) ? result : [result];
const code = bundles
  .flatMap((item) => item.output ?? [])
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n');

if (!code) throw new Error('The test bundle is empty.');

// Keep a closing tag inside a string from ending the inline script.
const safeCode = code.replace(/<\/script/gi, '<\\/script');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CHIP-8 tests</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 2rem 1.25rem 3rem;
      background: #f7f7f2;
      color: #1c1c1c;
      font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    main { max-width: 60rem; margin: 0 auto; }
    h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
    p { margin: 0 0 1.25rem; color: #52605a; }
    #results { padding: 1rem; border: 1px solid #d8ddd8; border-radius: 8px; background: #ffffff; }
    #results h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
    #results div { padding: 1px 0; }
  </style>
</head>
<body>
  <main>
    <h1>CHIP-8 tests</h1>
    <p>Single-file run of the same suite as <code>npm test</code>. No server needed.</p>
    <div id="results">Running...</div>
  </main>
  <script>
${safeCode}
  </script>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
const target = join(outDir, 'chip8-tests.html');
writeFileSync(target, html, 'utf8');

const kilobytes = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`Wrote ${target} (${kilobytes} KB)`);
