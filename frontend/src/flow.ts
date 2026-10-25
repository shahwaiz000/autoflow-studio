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

/* ---- helpers for the drag-and-drop builder: every arrow is stored explicitly ---- */
export type Handle = "next" | "on_true" | "on_false";
export interface PortEdge extends Edge { handle: Handle }

export function explicitEdges(steps: FlowStep[]): PortEdge[] {
  const ids = new Set(steps.map((s) => s.id));
  const out: PortEdge[] = [];
  for (const s of steps) {
    if (s.type === "end") continue;
    if (s.type === "condition") {
      const c = s.config ?? {};
      if (c.on_true && ids.has(c.on_true)) out.push({ from: s.id, to: c.on_true, label: "true", handle: "on_true" });
      if (c.on_false && ids.has(c.on_false)) out.push({ from: s.id, to: c.on_false, label: "false", handle: "on_false" });
    } else if (s.next && ids.has(s.next)) out.push({ from: s.id, to: s.next, handle: "next" });
  }
  return out;
}

/** Older workflows follow "the next step in the list" without saying so. Make that arrow explicit. */
export function withExplicitNext<T extends FlowStep>(steps: T[]): T[] {
  const ids = new Set(steps.map((s) => s.id));
  return steps.map((s, i) => (s.type === "end" || s.type === "condition" || (s.next && ids.has(s.next)) ? s
    : { ...s, next: steps[i + 1]?.id }));
}

/** What must be fixed before a drawn workflow can be saved. */
export function checkGraph(steps: FlowStep[]): { messages: string[]; ids: Set<string> } {
  const messages: string[] = [], ids = new Set<string>();
  const label = (s: FlowStep) => `"${s.name || s.type}"`;
  const triggers = steps.filter((s) => s.type === "trigger");
  if (triggers.length !== 1) messages.push("A workflow needs exactly one Trigger (start) step.");
  const edges = explicitEdges(steps);
  for (const s of steps) {
    if (s.type === "end") continue;
    if (s.type === "condition") {
      if (!edges.some((e) => e.from === s.id && e.handle === "on_true") || !edges.some((e) => e.from === s.id && e.handle === "on_false")) {
        messages.push(`${label(s)} needs both a true arrow and a false arrow.`); ids.add(s.id);
      }
    } else if (!edges.some((e) => e.from === s.id)) { messages.push(`${label(s)} has no arrow leaving it.`); ids.add(s.id); }
  }
  if (triggers.length === 1) {
    const seen = new Set([triggers[0].id]), queue = [triggers[0].id];
    for (let i = 0; i < queue.length; i++) {  // walk the arrows outward from the Trigger
      for (const e of edges) if (e.from === queue[i] && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
    for (const s of steps) if (!seen.has(s.id)) { messages.push(`${label(s)} is not connected to the start.`); ids.add(s.id); }
  }
  return { messages, ids };
}

/** Sideways nudge for boxes that belong to only one side of an if/else, so branches sit beside each other. */
export function branchShifts(steps: FlowStep[], gap = 130): Map<string, number> {
  const edges = explicitEdges(steps), shifts = new Map<string, number>();
  const reach = (start: string) => {
    const seen = new Set<string>(), queue = [start];
    for (let i = 0; i < queue.length; i++) {
      if (seen.has(queue[i])) continue;
      seen.add(queue[i]);
      for (const e of edges) if (e.from === queue[i]) queue.push(e.to);
    }
    return seen;
  };
  for (const s of steps) {
    const t = s.config?.on_true, f = s.config?.on_false;
    if (s.type !== "condition" || !t || !f) continue;
    const onlyT = reach(t), onlyF = reach(f);
    for (const id of onlyT) if (!onlyF.has(id)) shifts.set(id, (shifts.get(id) ?? 0) - gap);
    for (const id of onlyF) if (!onlyT.has(id)) shifts.set(id, (shifts.get(id) ?? 0) + gap);
  }
  return shifts;
}
