/* Pure helpers that turn workflow steps into a diagram. No React here, so they are easy to test. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FlowStep { id: string; type: string; name: string; next?: string; config?: Record<string, any> }
export interface Edge { from: string; to: string; label?: string }
export interface Placed { step: FlowStep; x: number; y: number; level: number; reached: boolean }

export const NODE_W = 200, NODE_H = 54, GAP_X = 28, GAP_Y = 52, PAD = 16;

/** Same rules as the backend engine: go to "next" if set, otherwise the following step in the list. */
export function buildEdges(steps: FlowStep[]): Edge[] {
  const ids = new Set(steps.map((s) => s.id));
  const out: Edge[] = [];
  steps.forEach((s, i) => {
    if (s.type === "end") return;
    if (s.type === "condition") {
      const c = s.config ?? {};
      if (c.on_true && ids.has(c.on_true)) out.push({ from: s.id, to: c.on_true, label: "true" });
      if (c.on_false && ids.has(c.on_false)) out.push({ from: s.id, to: c.on_false, label: "false" });
      return;
    }
    const target = s.next && ids.has(s.next) ? s.next : steps[i + 1]?.id;
    if (target) out.push({ from: s.id, to: target });
  });
  return out;
}

export function layout(steps: FlowStep[], edges: Edge[]) {
  const level = new Map<string, number>();
  if (steps.length) level.set(steps[0].id, 0);
  for (let pass = 0; pass < steps.length; pass++) {  // longest path; the pass limit stops endless loops
    for (const e of edges) {
      const from = level.get(e.from);
      if (from !== undefined) level.set(e.to, Math.min(Math.max(level.get(e.to) ?? 0, from + 1), steps.length));
    }
  }
  const maxReached = Math.max(-1, ...level.values());
  const rows: Placed[][] = [];
  for (const s of steps) {
    const reached = level.has(s.id);
    const l = reached ? level.get(s.id)! : maxReached + 1;
    (rows[l] ??= []).push({ step: s, x: 0, y: 0, level: l, reached });
  }
  const cols = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  const baseWidth = cols * (NODE_W + GAP_X) - GAP_X + PAD * 2;
  // arrows that skip a row or go backwards are drawn around the boxes, so keep room on the right
  const side = edges.some((e) => level.has(e.from) && level.has(e.to) && level.get(e.to)! - level.get(e.from)! !== 1) ? 100 : 0;
  const width = baseWidth + side;
  const placed: Placed[] = [];
  rows.forEach((row, l) => {
    if (!row) return;
    const rowW = row.length * (NODE_W + GAP_X) - GAP_X;
    row.forEach((p, i) => placed.push({ ...p, x: (baseWidth - rowW) / 2 + i * (NODE_W + GAP_X), y: PAD + l * (NODE_H + GAP_Y) }));
  });
  const height = PAD * 2 + rows.length * (NODE_H + GAP_Y) - GAP_Y;
  return { placed, width, height: Math.max(height, NODE_H + PAD * 2) };
}
