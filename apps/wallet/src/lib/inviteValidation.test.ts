import { describe, expect, it } from "vitest";
import { inviteAmountToStroops, validateFundedInviteAmount } from "./inviteValidation";

describe("funded invite amount validation", () => {
  it("rejects empty, zero, and invalid amounts", () => {
    expect(validateFundedInviteAmount("", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: null });
    expect(validateFundedInviteAmount("0", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
    expect(validateFundedInviteAmount("abc", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
  });

  it("rejects amounts above the public balance", () => {
    expect(validateFundedInviteAmount("5", "1000000")).toMatchObject({
      amountOk: true,
      amountStroops: "5000000",
      insufficient: true,
      message: "Not enough public USDC. Unshield some funds or use a smaller amount.",
    });
  });

  it("accepts amounts within the public balance", () => {
    expect(inviteAmountToStroops("1.25")).toBe("1250000");
    expect(validateFundedInviteAmount("1.25", "1250000")).toMatchObject({
      amountOk: true,
      amountStroops: "1250000",
      insufficient: false,
      message: null,
    });
  });
});
