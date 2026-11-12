/**
 * standalone-entry.js - entry point for the single-file browser test page.
 *
 * `test/index.html` imports ES modules, so it needs a server. This entry is
 * bundled into one plain script by scripts/build-test-page.mjs, which lets the
 * generated page run from file:// as well.
 */

import { runAll } from './harness.js';
import './all.js';

runAll().catch((error) => {
  const out = document.getElementById('results');
  if (out) out.textContent = `Test run crashed: ${error.message}`;
  console.error(error);
});
