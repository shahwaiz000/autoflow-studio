import { comparePeriods, estimateSavedMinutes, formatDuration, formatMinutes, pctChange, timeAgo } from "./lib";

describe("formatDuration", () => {
  it("handles empty, ms, seconds and minutes", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(12.34)).toBe("12.3 s");
    expect(formatDuration(154)).toBe("2m 34s");
  });
});

describe("comparePeriods and pctChange", () => {
  const days = (n: number, success: number, failed: number) => Array.from({ length: n }, () => ({ success, failed }));
  it("splits the trend into the latest 7 days and the 7 before", () => {
    const { current, previous } = comparePeriods([...days(7, 1, 0), ...days(7, 2, 1)]);
    expect(previous).toEqual({ success: 7, failed: 0 });
    expect(current).toEqual({ success: 14, failed: 7 });
  });
  it("returns null instead of dividing by zero", () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(15, 10)).toBe(50);
    expect(pctChange(5, 10)).toBe(-50);
  });
});

describe("time saved estimate", () => {
  it("is not calculated until a manual time per run is entered", () => {
    expect(estimateSavedMinutes(40, null)).toBeNull();
    expect(estimateSavedMinutes(40, 0)).toBeNull();
    expect(estimateSavedMinutes(40, NaN)).toBeNull();
  });
  it("multiplies successful runs by the entered minutes", () => {
    expect(estimateSavedMinutes(40, 6)).toBe(240);
    expect(formatMinutes(240)).toBe("4 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
    expect(formatMinutes(30)).toBe("30 min");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-26T12:00:00Z").getTime();
  it("describes recent and older times", () => {
    expect(timeAgo("2026-10-26T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-26T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-10-26T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-24T12:00:00Z", now)).toBe("2 d ago");
    expect(timeAgo(null, now)).toBe("-");
  });
});

describe("waitForRun", () => {
  test("keeps asking until the run is finished and reports each update", async () => {
    const states = ["queued", "running", "failed"];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 5, status: states.shift() }) })));
    const seen: string[] = [];
    const { waitForRun } = await import("./lib");
    const final = await waitForRun(5, (e) => seen.push(e.status), 1);
    expect(seen).toEqual(["queued", "running", "failed"]);
    expect(final.status).toBe("failed");
  });
  test("gives up after the time limit instead of waiting forever", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 5, status: "running" }) })));
    const { waitForRun } = await import("./lib");
    expect((await waitForRun(5, undefined, 1, 20)).status).toBe("running");
  });
});
