import { createContext, DragEvent, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  applyNodeChanges, Background, Connection, Controls, Edge, EdgeChange, Handle, MarkerType, Node, NodeChange, NodeProps,
  Position, ReactFlow, ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { COLORS } from "../components/FlowDiagram";
import { ErrorBox, Loading } from "../components/ui";
import { branchShifts, checkGraph, explicitEdges, layout, withExplicitNext } from "../flow";
import { api, useApi } from "../lib";
import type { Workflow } from "../types";
import { DEFAULTS, EStep, Fields, TYPES } from "./WorkflowEditor";

type StepNode = Node<{ stepId: string }, "step">;
const Ctx = createContext<{ steps: Map<string, EStep>; problems: Set<string> }>({ steps: new Map(), problems: new Set() });
const DRAG_TYPE = "application/autoflow-step";
const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  const { steps, problems } = useContext(Ctx);
  const s = steps.get(data.stepId);
  if (!s) return null;
  const [fill, border, label] = COLORS[s.type] ?? COLORS.end;
  return (
    <div style={{ background: fill, borderColor: problems.has(s.id) ? "#ef4444" : border, width: 200 }}
      className={`relative rounded-xl border-2 px-3 py-2 text-left shadow-sm ${selected ? "ring-2 ring-brand ring-offset-1" : ""}`}>
      {s.type !== "trigger" && <Handle type="target" position={Position.Top} />}
      <p className="truncate text-sm font-semibold text-slate-900">{s.name || label}</p>
      <p className="text-xs text-slate-600">{label}</p>
      {s.type === "condition" ? (
        <>
          <Handle type="source" id="on_true" position={Position.Bottom} style={{ left: "28%" }} />
          <Handle type="source" id="on_false" position={Position.Bottom} style={{ left: "72%" }} />
          <span className="absolute -bottom-5 left-[16%] text-[10px] font-semibold text-emerald-700">true</span>
          <span className="absolute -bottom-5 right-[14%] text-[10px] font-semibold text-red-700">false</span>
        </>
      ) : s.type !== "end" && <Handle type="source" id="next" position={Position.Bottom} />}
    </div>
  );
}
const nodeTypes = { step: StepNodeView };
const asNode = (id: string, position: { x: number; y: number }): StepNode => ({ id, type: "step", position, data: { stepId: id } });

function Canvas() {
  const { id } = useParams();
  const nav = useNavigate();
  const rf = useReactFlow();
  const samples = useApi<string[]>("/samples");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [builtIn, setBuiltIn] = useState(false);
  const [steps, setSteps] = useState<EStep[]>(id ? [] : [
    { id: "s1", type: "trigger", name: "Start", retries: 0, next: "s2", config: { ...DEFAULTS.trigger } },
    { id: "s2", type: "end", name: "Done", retries: 0, next: "", config: {} }]);
  const [nodes, setNodes] = useState<StepNode[]>(id ? [] : [asNode("s1", { x: 160, y: 40 }), asNode("s2", { x: 160, y: 220 })]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    api<Workflow>(`/workflows/${id}`).then((w) => {
      setName(w.name); setDescription(w.description); setCategory(w.category); setBuiltIn(!!w.built_in);
      const loaded = withExplicitNext((w.definition?.steps ?? []).map((s) => ({ id: s.id, type: s.type, name: s.name,
        retries: s.retries ?? 0, next: s.next ?? "", config: { ...s.config }, pos: s.pos })));
      const auto = layout(loaded, explicitEdges(loaded)).placed;  // used for workflows that were never drawn
      const shift = branchShifts(loaded);
      setSteps(loaded);
      setNodes(loaded.map((s) => {
        const a = auto.find((p) => p.step.id === s.id);
        return asNode(s.id, s.pos ?? { x: (a?.x ?? 0) + (shift.get(s.id) ?? 0), y: a?.y ?? 0 });
      }));
    }).catch((e: Error) => setLoadError(e.message)).finally(() => setLoading(false));
  }, [id]);

  const check = useMemo(() => checkGraph(steps.map((s) => ({ id: s.id, type: s.type, name: s.name, next: s.next || undefined, config: s.config }))), [steps]);
  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const edges: Edge[] = useMemo(() => explicitEdges(steps.map((s) => ({ id: s.id, type: s.type, name: s.name, next: s.next || undefined, config: s.config }))).map((e) => ({
    id: `${e.from}:${e.handle}`, source: e.from, target: e.to, sourceHandle: e.handle, type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 }, selected: selectedEdges.has(`${e.from}:${e.handle}`),
  })), [steps, selectedEdges]);

  const patch = (sid: string, p: Partial<EStep>) => setSteps((all) => all.map((s) => (s.id === sid ? { ...s, ...p } : s)));
  const removeStep = useCallback((sid: string) => setSteps((all) => all.filter((s) => s.id !== sid).map((s) => ({
    ...s, next: s.next === sid ? "" : s.next,
    config: { ...s.config, ...(s.config.on_true === sid ? { on_true: "" } : {}), ...(s.config.on_false === sid ? { on_false: "" } : {}) } }))), []);
  const clearArrow = useCallback((edgeId: string) => {
    const [from, handle] = edgeId.split(":");
    setSteps((all) => all.map((s) => (s.id !== from ? s : handle === "next" ? { ...s, next: "" } : { ...s, config: { ...s.config, [handle]: "" } })));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<StepNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) {
      if (c.type === "select") { if (c.selected) setSelectedId(c.id); else setSelectedId((cur) => (cur === c.id ? null : cur)); }
      if (c.type === "remove") { removeStep(c.id); setSelectedId((cur) => (cur === c.id ? null : cur)); }
    }
  }, [removeStep]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) {
      if (c.type === "select") setSelectedEdges((cur) => { const n = new Set(cur); if (c.selected) n.add(c.id); else n.delete(c.id); return n; });
      if (c.type === "remove") clearArrow(c.id);
    }
  }, [clearArrow]);
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const h = c.sourceHandle ?? "next", to = c.target;
    setSteps((all) => all.map((s) => (s.id !== c.source ? s : h === "next" ? { ...s, next: to } : { ...s, config: { ...s.config, [h]: to } })));
  }, []);

  function addStep(type: string, position?: { x: number; y: number }) {
    const n = Math.max(0, ...steps.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0))) + 1;
    const sid = `s${n}`;
    const anchor = nodes.find((x) => x.id === selectedId) ?? nodes[nodes.length - 1];
    const maxY = Math.max(0, ...nodes.map((x) => x.position.y));
    const at = position ?? (anchor && selectedId ? { x: anchor.position.x, y: anchor.position.y + 120 } : { x: anchor?.position.x ?? 160, y: maxY + 120 });
    setSteps((all) => [...all, { id: sid, type, name: TYPES.find((t) => t.value === type)!.name, retries: 0, next: "", config: JSON.parse(JSON.stringify(DEFAULTS[type])) }]);
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...asNode(sid, at), selected: true }]);
    setSelectedId(sid);
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DRAG_TYPE);
    if (!DEFAULTS[type]) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addStep(type, { x: p.x - 100, y: p.y - 27 });
  };

  async function save() {
    if (check.messages.length) { setErrors(check.messages); return; }
    const where = new Map(nodes.map((n) => [n.id, n.position]));
    const ordered = [...steps.filter((s) => s.type === "trigger"), ...steps.filter((s) => s.type !== "trigger")];  // the Trigger starts the run
    const payload = { name, description, category, steps: ordered.map((s) => ({
      id: s.id, type: s.type, name: s.name, retries: s.retries,
      ...(s.type !== "end" && s.type !== "condition" && s.next ? { next: s.next } : {}),
      config: s.type === "condition" ? { ...s.config, value: s.config.value === "" ? "" : Number(s.config.value) } : s.config,
      pos: { x: Math.round(where.get(s.id)?.x ?? 0), y: Math.round(where.get(s.id)?.y ?? 0) } })) };
    setSaving(true); setErrors([]);
    try { await api(id ? `/workflows/${id}` : "/workflows", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); nav("/workflows"); }
    catch (e) { setErrors([(e as Error).message]); }
    setSaving(false);
  }

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox message={loadError} />;
  const sel = selectedId ? stepMap.get(selectedId) : undefined;
  return (
    <Ctx.Provider value={{ steps: stepMap, problems: check.ids }}>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <Link to="/workflows" className="text-brand-dark hover:underline">Back to workflows</Link>
        <Link to={id ? `/workflows/${id}/edit` : "/workflows/new"} className="text-brand-dark hover:underline">Prefer a form? Use the form editor</Link>
      </div>
      <div className="mb-3 grid gap-3 text-sm sm:grid-cols-[1fr_180px_2fr_auto]">
        <label>Name<input className={field} value={name} disabled={builtIn} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <label>Category<input className={field} value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} /></label>
        <label>Description<input className={field} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label>
        <button onClick={save} disabled={saving} className="self-end rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-50">{saving ? "Saving..." : "Save workflow"}</button>
      </div>
      {errors.length > 0 && <ul role="alert" className="mb-3 list-disc space-y-1 rounded-lg bg-red-50 py-3 pl-8 pr-4 text-sm text-red-800">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="grid gap-3 lg:grid-cols-[170px_1fr_320px]">
        <aside className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-slate-900">Steps</p>
          <p className="mb-2 text-xs text-slate-500">Drag onto the canvas, or click to add.</p>
          <div className="space-y-1.5">
            {TYPES.map((t) => {
              const [fill, border] = COLORS[t.value];
              return <button key={t.value} type="button" draggable onClick={() => addStep(t.value)}
                onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, t.value); e.dataTransfer.effectAllowed = "move"; }}
                style={{ background: fill, borderColor: border }} className="w-full cursor-grab rounded-lg border px-2 py-1.5 text-left text-xs font-medium text-slate-800">{t.label}</button>;
            })}
          </div>
        </aside>
        <div className="h-[68vh] min-h-[460px] rounded-xl border border-slate-200 bg-white" data-testid="canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            isValidConnection={(c) => c.source !== c.target} deleteKeyCode={["Backspace", "Delete"]} fitView fitViewOptions={{ maxZoom: 1 }}>
            <Background gap={20} color="#e2e8f0" /><Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          {!sel ? (
            <div className="space-y-2 text-slate-600">
              <p className="font-semibold text-slate-900">How to use the builder</p>
              <p>1. Drag a step from the left onto the canvas.</p>
              <p>2. Drag from the round dot under a box to the round dot on top of another box to draw an arrow.</p>
              <p>3. Click a box to change its settings here.</p>
              <p>4. Click an arrow or box and press Delete to remove it.</p>
            </div>
          ) : (
            <>
              <label className="block font-semibold text-slate-900">Step name
                <input className={field} value={sel.name} maxLength={120} onChange={(e) => patch(sel.id, { name: e.target.value })} /></label>
              <Fields step={sel} steps={steps} samples={samples.data ?? []} set={(config) => patch(sel.id, { config })} />
              {!["trigger", "end", "condition"].includes(sel.type) && (
                <label className="block">Try again if it fails
                  <select className={field} value={sel.retries} onChange={(e) => patch(sel.id, { retries: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "No retries" : `${n} ${n === 1 ? "retry" : "retries"}`}</option>)}</select></label>)}
              <button onClick={() => { removeStep(sel.id); setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setSelectedId(null); }}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50">Delete this step</button>
            </>
          )}
        </aside>
      </div>
      <p className={`mt-3 rounded-lg px-4 py-2 text-sm ${check.messages.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
        {check.messages.length ? `To fix before saving: ${check.messages.join(" ")}` : "The drawing is complete and ready to save."}
      </p>
    </Ctx.Provider>
  );
}

export default function WorkflowBuilder() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>;
}
