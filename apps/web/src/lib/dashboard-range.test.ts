import { describe, expect, it } from "vitest";

import { parseShanghaiInputValue, shanghaiInputValue } from "./dashboard-range";

describe("dashboard Shanghai custom range", () => {
  it("formats instants as Asia/Shanghai wall time", () => {
    expect(shanghaiInputValue(new Date("2026-09-18T12:30:00.000Z"))).toBe("2026-09-18T20:30");
  });

  it("parses Asia/Shanghai wall time independently of browser timezone", () => {
    expect(parseShanghaiInputValue("2026-09-18T20:30").toISOString()).toBe(
      "2026-09-18T12:30:00.000Z",
    );
  });

  it("rejects impossible local dates", () => {
    expect(Number.isNaN(parseShanghaiInputValue("2026-02-30T12:00").getTime())).toBe(true);
  });
});
