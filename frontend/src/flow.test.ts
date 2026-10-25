import { buildEdges, layout, FlowStep } from "./flow";

const s = (id: string, type: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, type, name: id, ...extra });

it("connects a simple list in order", () => {
  const edges = buildEdges([s("a", "trigger"), s("b", "load_csv"), s("c", "end")]);
  expect(edges).toEqual([{ from: "a", to: "b" }, { from: "b", to: "c" }]);
});

it("draws true and false branches and honours an explicit next", () => {
  const steps = [s("t", "trigger"), s("c", "condition", { config: { on_true: "n", on_false: "r" } }),
    s("n", "notify", { next: "r" }), s("r", "report"), s("e", "end")];
  const edges = buildEdges(steps);
  expect(edges).toContainEqual({ from: "c", to: "n", label: "true" });
  expect(edges).toContainEqual({ from: "c", to: "r", label: "false" });
  expect(edges).toContainEqual({ from: "n", to: "r" });
  const { placed } = layout(steps, edges);
  const lvl = (id: string) => placed.find((p) => p.step.id === id)!.level;
  expect(lvl("r")).toBeGreaterThan(lvl("n"));  // report sits below notify, not beside it
});

it("marks steps that can never be reached and survives loops", () => {
  const steps = [s("a", "trigger", { next: "c" }), s("b", "report"), s("c", "load_csv", { next: "a" })];
  const { placed } = layout(steps, buildEdges(steps));
  expect(placed.find((p) => p.step.id === "b")!.reached).toBe(false);
  expect(placed).toHaveLength(3);
});

it("leaves room for arrows that skip a row", () => {
  const plain = layout([s("a", "trigger"), s("b", "end")], [{ from: "a", to: "b" }]);
  const steps = [s("t", "trigger"), s("c", "condition", { config: { on_true: "n", on_false: "r" } }), s("n", "notify", { next: "r" }), s("r", "report")];
  expect(layout(steps, buildEdges(steps)).width).toBeGreaterThan(plain.width);
});

import { checkGraph, explicitEdges, withExplicitNext } from "./flow";

it("turns the old 'next in the list' rule into real arrows", () => {
  const steps = withExplicitNext([s("a", "trigger"), s("b", "report"), s("c", "end")]);
  expect(explicitEdges(steps)).toEqual([{ from: "a", to: "b", handle: "next" }, { from: "b", to: "c", handle: "next" }]);
});

it("accepts a complete drawing", () => {
  const steps = [s("a", "trigger", { next: "b" }), s("b", "end")];
  expect(checkGraph(steps).messages).toEqual([]);
});

it("explains what is wrong with an unfinished drawing", () => {
  const steps = [s("a", "trigger", { next: "b" }), s("b", "report"), s("c", "condition", { config: { on_true: "b" } }), s("d", "end")];
  const { messages, ids } = checkGraph(steps);
  expect(messages.join(" ")).toMatch(/no arrow leaving/);
  expect(messages.join(" ")).toMatch(/true arrow and a false arrow/);
  expect(messages.join(" ")).toMatch(/not connected to the start/);
  expect([...ids].sort()).toEqual(["b", "c", "d"]);
  expect(checkGraph([s("x", "report")]).messages[0]).toMatch(/exactly one Trigger/);
});

import { branchShifts } from "./flow";

it("moves one-sided branches apart but leaves shared boxes in the middle", () => {
  const steps = [s("t", "trigger", { next: "c" }), s("c", "condition", { config: { on_true: "n", on_false: "r" } }),
    s("n", "notify", { next: "r" }), s("r", "report", { next: "e" }), s("e", "end")];
  const m = branchShifts(steps);
  expect(m.get("n")).toBeLessThan(0);
  expect(m.get("r")).toBeUndefined();
  expect(m.get("e")).toBeUndefined();
});
