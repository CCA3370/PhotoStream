import { describe, expect, it } from "vitest";

import {
  dataSaverSettingViewSchema,
  updateDataSaverSettingRequestSchema,
} from "./bandwidth";

describe("data saver contracts", () => {
  it("accepts strict boolean settings", () => {
    expect(dataSaverSettingViewSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(updateDataSaverSettingRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(updateDataSaverSettingRequestSchema.safeParse({ enabled: "true" }).success).toBe(false);
    expect(updateDataSaverSettingRequestSchema.safeParse({ enabled: true, extra: true }).success).toBe(
      false,
    );
  });
});
