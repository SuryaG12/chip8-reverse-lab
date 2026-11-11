import { layoutGraph } from '@/graph';

const hex = (value) => value.toString(16).toUpperCase().padStart(3, '0');
const clampText = (text) => (text.length > 22 ? `${text.slice(0, 21)}…` : text);

/** A cubic path between two node rectangles. */
function edgePath(from, to) {
  if (from.id === to.id) {
    const cx = from.x + from.width / 2;
    const top = from.y;
    return `M ${cx - 12} ${top} C ${cx - 28} ${top - 26}, ${cx + 28} ${top - 26}, ${cx + 12} ${top}`;
  }

  const fy = from.y + from.height / 2;
  const ty = to.y + to.height / 2;

  if (to.x > from.x) {
    const fx = from.x + from.width;
    const tx = to.x;
    const dx = Math.max(8, Math.abs(tx - fx) * 0.5);
    return `M ${fx} ${fy} C ${fx + dx} ${fy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  }

  if (to.address === from.address + 2 && to.y > from.y) {
    // Fall-through across a row boundary: route through the gap between rows.
    const sx = from.x + from.width / 2;
    const tx = to.x + to.width / 2;
    const gap = to.y - (from.y + from.height);
    return `M ${sx} ${from.y + from.height} C ${sx} ${from.y + from.height + gap / 2}, ${tx} ${to.y - gap / 2}, ${tx} ${to.y}`;
  }

  if (to.x === from.x && to.y > from.y) {
    // Fall-through down a column: a short vertical connector.
    const cx = from.x + from.width / 2;
    return `M ${cx} ${from.y + from.height} L ${cx} ${to.y}`;
  }

  // Back edge: leave the left side, re-enter the right side, and bow below.
  const sx = from.x;
  const ex = to.x + to.width;
  const bow = Math.max(28, Math.abs(from.y - to.y) + 28);
  return `M ${sx} ${fy} C ${sx - bow} ${fy + bow}, ${ex + bow} ${ty + bow}, ${ex} ${ty}`;
}

/**
 * Compact SVG map of executed addresses and their transitions.
 * Clicking a node toggles a breakpoint at that address.
 */
export function ControlFlow({ graph, breakpoints, onToggleBreakpoint }) {
  if (!graph.nodes.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Run or step a ROM to map its control flow.
      </p>
    );
  }

  const layout = layoutGraph(graph);
  const maxCount = Math.max(...layout.nodes.map((node) => node.count), 1);
  const maxEdge = Math.max(...layout.edges.map((edge) => edge.count), 1);
  const pad = 34;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border/60 bg-[#070a0d] p-2">
        <svg
          viewBox={`-${pad} -${pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`}
          className="h-auto w-full min-w-[36rem]"
          role="img"
          aria-label="Control flow graph"
        >
          <defs>
            <marker
              id="cf-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.75)" />
            </marker>
          </defs>

          {layout.edges.map((edge, index) => (
            <path
              key={`${edge.from.id}-${edge.to.id}-${index}`}
              d={edgePath(edge.from, edge.to)}
              fill="none"
              stroke="rgba(125,255,178,0.35)"
              strokeWidth={1 + (edge.count / maxEdge) * 2.5}
              markerEnd="url(#cf-arrow)"
            >
              <title>
                {`0x${hex(edge.from.address)} → 0x${hex(edge.to.address)} · ${edge.count}×`}
              </title>
            </path>
          ))}

          {layout.nodes.map((node) => {
            const ratio = node.count / maxCount;
            const hasBreakpoint = Boolean(breakpoints?.has(node.address));
            const toggle = () => onToggleBreakpoint?.(node.address);

            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`0x${hex(node.address)} ${node.text}, ${node.count} execution${node.count === 1 ? '' : 's'}${hasBreakpoint ? ', breakpoint set' : ''}`}
                aria-pressed={hasBreakpoint}
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                  }
                }}
                className="cursor-pointer focus:outline-none"
              >
                <title>
                  {`0x${hex(node.address)} ${node.text} · ${node.count}× · ${hasBreakpoint ? 'click to remove breakpoint' : 'click to set a breakpoint'}`}
                </title>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={8}
                  fill={`rgba(125,255,178,${0.05 + ratio * 0.22})`}
                  stroke={hasBreakpoint ? 'rgba(248,113,113,0.95)' : `rgba(125,255,178,${0.28 + ratio * 0.45})`}
                  strokeWidth={hasBreakpoint ? 2 : 1}
                />
                <text
                  x={node.x + 10}
                  y={node.y + 17}
                  fill="#7dffb2"
                  fontFamily="monospace"
                  fontSize="11"
                >
                  {`0x${hex(node.address)}`}
                </text>
                <text
                  x={node.x + node.width - 10}
                  y={node.y + 17}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontFamily="monospace"
                  fontSize="10"
                >
                  {`×${node.count}`}
                </text>
                <text
                  x={node.x + 10}
                  y={node.y + 33}
                  fill="#e2e8f0"
                  fontFamily="monospace"
                  fontSize="11"
                >
                  {clampText(node.text)}
                </text>
                {hasBreakpoint ? (
                  <circle
                    cx={node.x + node.width - 7}
                    cy={node.y + 7}
                    r={2.5}
                    fill="#f87171"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground">
        {`${layout.nodes.length} address${layout.nodes.length === 1 ? '' : 'es'} · ${layout.edges.length} transition${layout.edges.length === 1 ? '' : 's'} · click a node to toggle a breakpoint`}
        {graph.truncated
          ? ` · top ${layout.nodes.length} of ${graph.totalAddresses} addresses by activity`
          : ''}
      </p>
    </div>
  );
}
