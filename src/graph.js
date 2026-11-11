/**
 * graph.js — turn cumulative trace stats into a small control-flow graph.
 *
 * The model is pure data so it can be tested without a DOM. Rendering lives in
 * components/control-flow.jsx. Nodes are kept by activity (with the entry point
 * always included) and then ordered by address, so fall-through edges stay
 * close together in the grid layout.
 */

import { PROGRAM_START } from './cpu.js';
import { disassembleOpcode } from './disassembler.js';

export const GRAPH_NODE_LIMIT = 40;

export const GRAPH_LAYOUT = {
  columns: 4,
  nodeWidth: 150,
  nodeHeight: 44,
  gapX: 24,
  gapY: 14,
};

/**
 * @param {object} stats  the object returned by createTrace().stats()
 * @param {{ limit?: number }} [options]
 */
export function buildControlFlowGraph(stats, { limit = GRAPH_NODE_LIMIT } = {}) {
  if (!stats || !stats.total) {
    return { nodes: [], edges: [], truncated: false, totalAddresses: 0 };
  }

  const byAddress = new Map();
  for (const entry of stats.addresses || []) {
    byAddress.set(entry.address, entry);
  }

  const allAddresses = new Set(byAddress.keys());
  for (const edge of stats.transitions || []) {
    allAddresses.add(edge.from);
    allAddresses.add(edge.to);
  }

  const ranked = Array.from(allAddresses).sort((a, b) => {
    if (a === PROGRAM_START) return -1;
    if (b === PROGRAM_START) return 1;
    const countA = byAddress.get(a)?.count ?? 0;
    const countB = byAddress.get(b)?.count ?? 0;
    return countB - countA || a - b;
  });

  const kept = new Set(ranked.slice(0, limit));
  const nodes = Array.from(kept)
    .sort((a, b) => a - b)
    .map((address) => {
      const entry = byAddress.get(address);
      return {
        id: address,
        address,
        opcode: entry?.opcode ?? null,
        text: entry ? disassembleOpcode(entry.opcode).text : '???',
        count: entry?.count ?? 0,
      };
    });

  const edges = (stats.transitions || [])
    .filter((edge) => kept.has(edge.from) && kept.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to, count: edge.count }));

  return {
    nodes,
    edges,
    truncated: ranked.length > kept.size,
    totalAddresses: ranked.length,
  };
}

/**
 * Assign each node a grid position and attach positions to edges.
 * Pure and deterministic: the same graph always produces the same layout.
 */
export function layoutGraph(graph, options = {}) {
  const { columns, nodeWidth, nodeHeight, gapX, gapY } = { ...GRAPH_LAYOUT, ...options };

  if (!graph.nodes.length) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      columns,
      nodeWidth,
      nodeHeight,
    };
  }

  const positions = new Map();
  graph.nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(node.id, {
      ...node,
      x: column * (nodeWidth + gapX),
      y: row * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
    });
  });

  const rows = Math.ceil(graph.nodes.length / columns);
  return {
    nodes: Array.from(positions.values()),
    edges: graph.edges.map((edge) => ({
      ...edge,
      from: positions.get(edge.from),
      to: positions.get(edge.to),
    })),
    width: columns * nodeWidth + (columns - 1) * gapX,
    height: rows * nodeHeight + (rows - 1) * gapY,
    columns,
    nodeWidth,
    nodeHeight,
  };
}
