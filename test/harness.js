/**
 * harness.js — a tiny test framework (~40 lines) so we need no installs.
 * Works in the browser (test/index.html) and in Node (see the README).
 */

const tests = [];

/** Register a test. */
export function test(name, fn) {
  tests.push({ name, fn });
}

export function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    const hex = (v) => (typeof v === 'number' ? `${v} (0x${v.toString(16)})` : String(v));
    throw new Error(`${label ? label + ': ' : ''}expected ${hex(expected)}, got ${hex(actual)}`);
  }
}

export function assertThrows(fn, label = '') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label ? label + ': ' : ''}expected an error to be thrown`);
}

/** Run every registered test. Shows results on the page if there is one. */
export function runAll() {
  let passed = 0;
  const lines = [];

  for (const { name, fn } of tests) {
    try {
      fn();
      passed++;
      lines.push({ ok: true, text: `PASS  ${name}` });
    } catch (err) {
      lines.push({ ok: false, text: `FAIL  ${name}\n      ${err.message}` });
    }
  }

  const summary = `${passed} / ${tests.length} tests passed`;
  lines.forEach((l) => console.log(l.text));
  console.log(summary);

  if (typeof document !== 'undefined') {
    const out = document.getElementById('results');
    out.textContent = '';
    for (const l of lines) {
      const div = document.createElement('div');
      div.textContent = l.text;
      div.style.color = l.ok ? 'green' : 'crimson';
      out.appendChild(div);
    }
    const s = document.createElement('h2');
    s.textContent = summary;
    out.prepend(s);
  }
  return passed === tests.length;
}
