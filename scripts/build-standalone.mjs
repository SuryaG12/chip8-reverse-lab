/**
 * build-standalone.mjs - pack the built app into one self-contained HTML file.
 *
 * Run `npm run build` first (or use `npm run build:standalone`, which does
 * both). The script inlines the CSS, the JS bundle and the woff2 fonts into
 * dist/chip8-reverse-lab.html, so the result opens by double-clicking and
 * needs no server, no network and no node_modules.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const htmlPath = join(dist, 'index.html');

let html;
try {
  html = readFileSync(htmlPath, 'utf8');
} catch {
  throw new Error('dist/index.html is missing. Run `npm run build` first.');
}

const cssTag = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
const jsTag = html.match(/<script type="module"[^>]*src="([^"]+)"><\/script>/);
if (!cssTag || !jsTag) {
  throw new Error('Could not find the built CSS and JS tags in dist/index.html.');
}

/** Map a URL from the built HTML to a file inside dist. */
function assetPath(url) {
  const relative = url.replace(/^\.?\//, '');
  return join(dist, relative);
}

let css = readFileSync(assetPath(cssTag[1]), 'utf8');
css = css.replace(/url\((['"]?)((?:\.?\/)?assets\/[^)'"]+\.woff2)\1\)/g, (whole, quote, url) => {
  const base64 = readFileSync(assetPath(url)).toString('base64');
  return `url(data:font/woff2;base64,${base64})`;
});

let js = readFileSync(assetPath(jsTag[1]), 'utf8');
// Keep an accidental closing tag inside a string from ending the inline script.
js = js.replace(/<\/script/gi, '<\\/script');

// Use functions here: the bundles contain `$&`, `$'` and similar sequences,
// which a string replacement would treat as special patterns.
const out = html
  .replace(cssTag[0], () => `<style>\n${css}\n</style>`)
  .replace(jsTag[0], () => `<script type="module">\n${js}\n</script>`);

const target = join(dist, 'chip8-reverse-lab.html');
writeFileSync(target, out, 'utf8');

const megabytes = (Buffer.byteLength(out) / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${target} (${megabytes} MB)`);
