/**
 * graph.test.js — control-flow graph model and layout tests.
 */

import { test, assertEqual } from './harness.js';
import {
  buildControlFlowGraph,
  layoutGraph,
  GRAPH_LAYOUT,
} from '../src/graph.js';

const makeStats = (overrides = {}) => ({
  total: 20,
  addresses: [
    { address: 0x200, opcode: 0xA050, count: 5 },
    { address: 0x202, opcode: 0x1202, count: 10 },
    { address: 0x204, opcode: 0x6001, count: 5 },
  ],
  transitions: [
    { from: 0x200, to: 0x202, count: 5 },
    { from: 0x202, to: 0x202, count: 10 },
    { from: 0x202, to: 0x204, count: 5 },
  ],
  ...overrides,
});

const addresses = (graph) => graph.nodes.map((node) => node.address);

test('an empty session produces an empty graph', () => {
  const graph = buildControlFlowGraph({ total: 0, addresses: [], transitions: [] });
  assertEqual(graph.nodes.length, 0);
  assertEqual(graph.edges.length, 0);
  assertEqual(graph.truncated, false);
  assertEqual(graph.totalAddresses, 0);

  assertEqual(buildControlFlowGraph(null).nodes.length, 0);
});

test('graph nodes are ordered by address and carry decoded text and counts', () => {
  const graph = buildControlFlowGraph(makeStats());

  assertEqual(addresses(graph).join(','), '512,514,516');
  assertEqual(graph.nodes[0].text.includes('LD I'), true);
  assertEqual(graph.nodes[1].text, 'JP 0x202');
  assertEqual(graph.nodes[2].text.includes('LD V0'), true);
  assertEqual(graph.nodes[0].count, 5);
  assertEqual(graph.nodes[1].count, 10);
  assertEqual(graph.truncated, false);
  assertEqual(graph.totalAddresses, 3);
});

test('graph edges keep their execution counts', () => {
  const graph = buildControlFlowGraph(makeStats());
  assertEqual(graph.edges.length, 3);

  const loop = graph.edges.find((edge) => edge.from === 0x202 && edge.to === 0x202);
  assertEqual(loop.count, 10);

  const fallThrough = graph.edges.find((edge) => edge.from === 0x202 && edge.to === 0x204);
  assertEqual(fallThrough.count, 5);
});

test('the node limit keeps the entry point and the hottest addresses', () => {
  const graph = buildControlFlowGraph(makeStats(), { limit: 2 });

  assertEqual(addresses(graph).join(','), '512,514');
  assertEqual(graph.truncated, true);
  assertEqual(graph.totalAddresses, 3);

  // The edge into the dropped 0x204 node is removed with it.
  assertEqual(graph.edges.length, 2);
  assertEqual(graph.edges.some((edge) => edge.to === 0x204), false);
});

test('addresses seen only in transitions still become nodes', () => {
  const graph = buildControlFlowGraph({
    total: 1,
    addresses: [],
    transitions: [{ from: 0x300, to: 0x302, count: 1 }],
  });

  assertEqual(addresses(graph).join(','), '768,770');
  assertEqual(graph.nodes[0].opcode, null);
  assertEqual(graph.nodes[0].text, '???');
  assertEqual(graph.nodes[0].count, 0);
  assertEqual(graph.edges.length, 1);
});

test('layout places nodes in a deterministic grid', () => {
  const stats = makeStats({
    addresses: [
      { address: 0x200, opcode: 0x6001, count: 1 },
      { address: 0x202, opcode: 0x6002, count: 1 },
      { address: 0x204, opcode: 0x6003, count: 1 },
      { address: 0x206, opcode: 0x6004, count: 1 },
      { address: 0x208, opcode: 0x6005, count: 1 },
    ],
    transitions: [{ from: 0x200, to: 0x208, count: 1 }],
  });
  const layout = layoutGraph(buildControlFlowGraph(stats));

  assertEqual(layout.nodes.length, 5);
  assertEqual(layout.width, 4 * 150 + 3 * 24);
  assertEqual(layout.height, 2 * 44 + 14);

  assertEqual(layout.nodes[0].x, 0);
  assertEqual(layout.nodes[0].y, 0);
  assertEqual(layout.nodes[3].x, 3 * (150 + 24));
  assertEqual(layout.nodes[3].y, 0);
  assertEqual(layout.nodes[4].x, 0);
  assertEqual(layout.nodes[4].y, 44 + 14);

  assertEqual(layout.edges[0].from.address, 0x200);
  assertEqual(layout.edges[0].to.address, 0x208);
  assertEqual(layout.edges[0].from.x, 0);
  assertEqual(layout.edges[0].to.x, 0);
  assertEqual(layout.edges[0].to.y, 58);
});

test('layout is stable across calls', () => {
  const graph = buildControlFlowGraph(makeStats());
  const first = layoutGraph(graph);
  const second = layoutGraph(graph);
  assertEqual(JSON.stringify(first), JSON.stringify(second));
});

test('layout supports custom grid options', () => {
  const graph = buildControlFlowGraph(makeStats());
  const layout = layoutGraph(graph, { columns: 2, nodeWidth: 100, nodeHeight: 30, gapX: 10, gapY: 5 });

  assertEqual(layout.width, 2 * 100 + 10);
  assertEqual(layout.height, 2 * 30 + 5);
  assertEqual(layout.nodes[2].x, 0);
  assertEqual(layout.nodes[2].y, 35);
});

test('an empty graph lays out to zero size', () => {
  const layout = layoutGraph({ nodes: [], edges: [] });
  assertEqual(layout.width, 0);
  assertEqual(layout.height, 0);
  assertEqual(layout.nodes.length, 0);
  assertEqual(layout.edges.length, 0);
});

test('the default layout constants are the documented grid', () => {
  assertEqual(GRAPH_LAYOUT.columns, 4);
  assertEqual(GRAPH_LAYOUT.nodeWidth, 150);
  assertEqual(GRAPH_LAYOUT.nodeHeight, 44);
});
