import { formatDuration } from "./lib";

describe("formatDuration", () => {
  it("handles empty, ms, seconds and minutes", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(12.34)).toBe("12.3 s");
    expect(formatDuration(154)).toBe("2m 34s");
  });
});
