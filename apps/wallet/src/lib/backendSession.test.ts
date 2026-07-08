import { describe, expect, it } from "vitest";
import { backendAuthLossEjectsWallet } from "./backendSession";

describe("backendAuthLossEjectsWallet", () => {
  it("keeps a valid device-local wallet in place on a backend 401 (no eject)", () => {
    // WL0: a 401 must not tear down a self-custodial wallet.
    expect(backendAuthLossEjectsWallet(true)).toBe(false);
  });

  it("returns to Onboarding only when there is no wallet on this device", () => {
    expect(backendAuthLossEjectsWallet(false)).toBe(true);
  });
});
