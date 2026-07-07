import { describe, it, expect } from "vitest";
import { DEPLOYMENT, VERIFIER_ID } from "./network";

// Drift guard: the wallet transacts client-side against the eERC deployment
// published by @benzo/config. If this shape drifts, the browser will build proofs
// and transactions for the wrong contract cluster.

describe("wallet deployment drift guard", () => {
  it("wallet contract IDs expose the current eERC deployment", () => {
    expect(DEPLOYMENT.contracts.EncryptedERC).toBeDefined();
    expect(DEPLOYMENT.contracts.Registrar).toBeDefined();
    expect(DEPLOYMENT.contracts.tUSDC).toBeDefined();
    expect(DEPLOYMENT.contracts.verifiers.transfer).toBeDefined();
    expect(typeof DEPLOYMENT.chainId).toBe("number");
    expect(VERIFIER_ID).toBe(DEPLOYMENT.contracts.verifiers.transfer);
  });
});
