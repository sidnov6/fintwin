import { describe, expect, it } from "vitest";

describe("P0 UI contract", () => {
  it("keeps regulated recommendations disabled", () => {
    expect(process.env.ENABLE_REGULATED_RECOMMENDATIONS ?? "false").toBe("false");
  });
});
