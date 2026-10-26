import { FlowStep, NODE_H, NODE_W, buildEdges, layout } from "../flow";

export const COLORS: Record<string, [string, string, string]> = {  // [fill, border, label]
  trigger: ["#eef0ff", "#5b5ff0", "Trigger"], load_csv: ["#e0f2fe", "#0284c7", "Load file"], validate: ["#cffafe", "#0891b2", "Validate"],
  compare: ["#ffedd5", "#ea580c", "Compare"],
  condition: ["#fef3c7", "#d97706", "Condition"], transform: ["#f3e8ff", "#9333ea", "Clean data"], notify: ["#fce7f3", "#db2777", "Notify"],
  report: ["#dcfce7", "#16a34a", "Report"], end: ["#f1f5f9", "#64748b", "End"],
};
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "..." : t);

export default function FlowDiagram({ steps, results }: { steps: FlowStep[]; results?: Record<string, "success" | "failed"> }) {
  const edges = buildEdges(steps);
  const { placed, width, height } = layout(steps, edges);
  const pos = new Map(placed.map((p) => [p.step.id, p]));
  const ran = (id: string) => results?.[id];
  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={`Flow diagram with ${steps.length} steps`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mx-auto block max-w-full">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#94a3b8" /></marker></defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
          const detour = b.level - a.level !== 1;  // skips a row or goes back: draw around the boxes
          const d = detour ? `M${x1} ${y1} C${x1 + 175} ${y1 + 20} ${x2 + 175} ${y2 - 20} ${x2} ${y2}`
            : `M${x1} ${y1} C${x1} ${y1 + 26} ${x2} ${y2 - 26} ${x2} ${y2}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.6} markerEnd="url(#arrow)" />
              {e.label && <text x={(x1 + x2) / 2 + (detour ? 120 : 6)} y={(y1 + y2) / 2} fontSize={11} fill={e.label === "true" ? "#15803d" : "#b91c1c"} fontWeight={600}>{e.label}</text>}
            </g>);
        })}
        {placed.map(({ step, x, y, reached }) => {
          const [fill, border, label] = COLORS[step.type] ?? COLORS.end;
          const r = ran(step.id);
          const stroke = results ? (r === "success" ? "#10b981" : r === "failed" ? "#ef4444" : "#cbd5e1") : border;
          return (
            <g key={step.id} opacity={results && !r ? 0.45 : 1}>
              <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={10} fill={fill} stroke={stroke} strokeWidth={results && r ? 2.5 : 1.5} strokeDasharray={reached ? undefined : "5 4"} />
              <text x={x + 12} y={y + 23} fontSize={12} fontWeight={600} fill="#0f172a">{cut(step.name || step.type, 23)}</text>
              <text x={x + 12} y={y + 41} fontSize={11} fill="#475569">{label}{!reached ? " (never reached)" : ""}{r === "failed" ? " - failed" : ""}</text>
            </g>);
        })}
      </svg>
      {results && <p className="mt-2 text-center text-xs text-slate-500">Colored outline: step ran (green) or failed (red). Faded: not run.</p>}
    </div>
  );
}
