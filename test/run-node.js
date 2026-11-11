/**
 * run-node.js — run the shared test suite headlessly.
 *
 * The same test files power test/index.html; importing them registers every
 * test with the tiny harness. `npm test` runs this file and exits non-zero if
 * anything fails, which is what CI needs.
 */

import { runAll } from './harness.js';
import './all.js';

const ok = await runAll();
process.exit(ok ? 0 : 1);
