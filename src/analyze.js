/**
 * analyze.js — session-level analysis over cumulative trace statistics.
 *
 * Like explain.js, every finding carries evidence. A finding about the hottest
 * address cites the recorded count, a loop finding cites the loop's least-used
 * edge, and so on. verifySessionAnalysis() checks those citations against the
 * stats before the UI shows them.
 */

import { disassembleOpcode } from './disassembler.js';

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Find strongly connected components that form loops.
 *
 * @param {Array<{ from: number, to: number, count: number }>} transitions
 * @returns {Array<{ addresses: number[], leastEdgeCount: number }>}
 */
export function findLoops(transitions) {
  const nodes = new Set();
  const adjacency = new Map();

  for (const { from, to } of transitions) {
    nodes.add(from);
    nodes.add(to);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }

  let index = 0;
  const indices = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  // Tarjan's strongly-connected-components algorithm.
  const connect = (node) => {
    indices.set(node, index);
    lowLink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!indices.has(next)) {
        connect(next);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(next)));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node), indices.get(next)));
      }
    }

    if (lowLink.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!indices.has(node)) connect(node);
  }

  const loops = [];
  for (const component of components) {
    const members = new Set(component);
    const internal = transitions.filter(({ from, to }) => members.has(from) && members.has(to));
    const isSelfLoop = internal.some(({ from, to }) => from === to);
    if (component.length === 1 && !isSelfLoop) continue;

    loops.push({
      addresses: component.slice().sort((a, b) => a - b),
      leastEdgeCount: Math.min(...internal.map(({ count }) => count)),
    });
  }

  return loops.sort((a, b) => b.leastEdgeCount - a.leastEdgeCount);
}

/**
 * Describe a session from cumulative trace stats.
 *
 * @param {object} stats  the object returned by createTrace().stats()
 */
export function analyzeSession(stats) {
  if (!stats || stats.total === 0) {
    return { empty: true, findings: [] };
  }

  const findings = [];

  findings.push({
    text: `Executed ${plural(stats.total, 'instruction')} across ${stats.uniqueAddresses} distinct ${stats.uniqueAddresses === 1 ? 'address' : 'addresses'}.`,
    evidence: [{
      type: 'stat',
      name: 'totals',
      total: stats.total,
      uniqueAddresses: stats.uniqueAddresses,
    }],
  });

  const hottest = stats.addresses[0];
  if (hottest) {
    findings.push({
      text: `The hottest address was 0x${hex(hottest.address, 3)}: ${plural(hottest.count, 'execution')} of ${disassembleOpcode(hottest.opcode).text}.`,
      evidence: [{ type: 'stat', name: 'hottest', address: hottest.address, count: hottest.count }],
    });
  }

  for (const loop of findLoops(stats.transitions)) {
    const addresses = loop.addresses.map((address) => `0x${hex(address, 3)}`);
    const text = loop.addresses.length === 1
      ? `A self-loop at ${addresses[0]} ran ${plural(loop.leastEdgeCount, 'time')}.`
      : `A loop spanning ${addresses.join(', ')} was detected; its least-used edge ran ${plural(loop.leastEdgeCount, 'time')}.`;
    findings.push({
      text,
      evidence: [{
        type: 'stat',
        name: 'loop',
        addresses: loop.addresses,
        leastEdgeCount: loop.leastEdgeCount,
      }],
    });
  }

  if (stats.calls > 0) {
    findings.push({
      text: `CALL was executed ${plural(stats.calls, 'time')}.`,
      evidence: [{ type: 'stat', name: 'calls', count: stats.calls }],
    });
  }

  if (stats.draws > 0) {
    findings.push({
      text: `The display was updated ${plural(stats.draws, 'time')}.`,
      evidence: [{ type: 'stat', name: 'draws', count: stats.draws }],
    });
  }

  if (stats.last) {
    findings.push({
      text: `The last retained instruction was ${stats.last.text} at 0x${hex(stats.last.address, 3)} (trace #${stats.last.seq}).`,
      evidence: [{ type: 'stat', name: 'last', seq: stats.last.seq }],
    });
  }

  return { empty: false, findings };
}

/** Does one cited stat match the current session? */
function supportsStat(evidence, stats) {
  if (evidence.type !== 'stat') return false;

  switch (evidence.name) {
    case 'totals':
      return evidence.total === stats.total && evidence.uniqueAddresses === stats.uniqueAddresses;

    case 'hottest': {
      const hottest = stats.addresses[0];
      return Boolean(hottest)
        && hottest.address === evidence.address
        && hottest.count === evidence.count;
    }

    case 'loop': {
      const loops = findLoops(stats.transitions);
      return loops.some((loop) => loop.leastEdgeCount === evidence.leastEdgeCount
        && loop.addresses.length === evidence.addresses.length
        && loop.addresses.every((address, index) => address === evidence.addresses[index]));
    }

    case 'calls':
      return stats.calls === evidence.count;

    case 'draws':
      return stats.draws === evidence.count;

    case 'last':
      return Boolean(stats.last) && stats.last.seq === evidence.seq;

    default:
      return false;
  }
}

/**
 * Check every session finding against the stats it claims to describe.
 *
 * @returns {{ ok: boolean, unsupported: string[] }}
 */
export function verifySessionAnalysis(analysis, stats) {
  if (!analysis || !stats) {
    return { ok: false, unsupported: ['Missing analysis or stats.'] };
  }

  if (analysis.empty) {
    return stats.total === 0
      ? { ok: true, unsupported: [] }
      : { ok: false, unsupported: ['The analysis claims no instructions were recorded.'] };
  }

  const unsupported = [];
  for (const finding of analysis.findings) {
    const evidence = finding.evidence || [];
    if (!evidence.length || !evidence.every((item) => supportsStat(item, stats))) {
      unsupported.push(finding.text);
    }
  }

  return { ok: unsupported.length === 0, unsupported };
}
