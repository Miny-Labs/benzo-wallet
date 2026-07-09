import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/store", () => ({
  useWallet: () => ({
    balance: { baseUnits: "0" },
    publicBalance: { baseUnits: "0" },
    refresh: vi.fn(),
  }),
}));

vi.mock("../lib/api", () => ({
  api: {
    importDeposit: vi.fn(),
    makePublic: vi.fn(),
  },
}));

vi.mock("../lib/proverPolicy", () => ({
  apiBoundaryProverPlan: () => ({ kind: "local", reason: "Local prover", onDevice: true }),
  apiProverKind: () => "local",
  proverPlan: () => ({ kind: "local", reason: "Local prover", onDevice: true }),
}));

import { convertQuickAmounts } from "./Convert";

describe("convertQuickAmounts", () => {
  it("offers usable small presets for judge-scale testnet balances", () => {
    expect(convertQuickAmounts("5000000")).toEqual(["1", "5"]);
    expect(convertQuickAmounts("10000000")).toEqual(["1", "5", "10"]);
  });

  it("keeps the largest valid presets for larger balances", () => {
    expect(convertQuickAmounts("50000000")).toEqual(["10", "20", "50"]);
    expect(convertQuickAmounts("100000000")).toEqual(["20", "50", "100"]);
  });

  it("does not offer impossible presets for empty balances", () => {
    expect(convertQuickAmounts("0")).toEqual([]);
  });
});
