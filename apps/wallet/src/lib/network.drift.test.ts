import { afterEach, describe, expect, it, vi } from "vitest";

// Drift guard: the wallet transacts client-side against the eERC deployment
// published by @benzo/config. If this shape drifts, the browser will build proofs
// and transactions for the wrong contract cluster.

const NETWORK_ENV_KEYS = [
  "VITE_CHAIN_ENV",
  "VITE_BENZO_NETWORK",
  "VITE_RPC_URL",
  "VITE_BENZONET_RPC_URL",
  "VITE_FUJI_RPC_URL",
  "VITE_AVALANCHE_RPC_URL",
  "VITE_EERC_ENCRYPTED_ERC_ADDRESS",
  "VITE_EERC_REGISTRAR_ADDRESS",
  "VITE_USDC_TOKEN_ADDRESS",
  "VITE_PRIVATE_GIFT_ESCROW_ADDRESS",
  "VITE_EERC_USDC_TOKEN_ID",
];

async function loadNetwork(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  const viteEnv = import.meta.env as unknown as Record<string, string | undefined>;
  for (const key of NETWORK_ENV_KEYS) delete viteEnv[key];
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./network");
}

describe("wallet deployment drift guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wallet contract IDs expose the current Fuji eERC deployment", async () => {
    const { DEPLOYMENT, VERIFIER_ID } = await loadNetwork({ VITE_CHAIN_ENV: "fuji" });

    expect(DEPLOYMENT.contracts.EncryptedERC).toBeDefined();
    expect(DEPLOYMENT.contracts.Registrar).toBeDefined();
    expect(DEPLOYMENT.contracts.tUSDC).toBeDefined();
    expect(DEPLOYMENT.contracts.verifiers.transfer).toBeDefined();
    expect(typeof DEPLOYMENT.chainId).toBe("number");
    expect(VERIFIER_ID).toBe(DEPLOYMENT.contracts.verifiers.transfer);
  });

  it("selects BenzoNet without changing its deployed addresses", async () => {
    const { ACTIVE_CHAIN, DEPLOYMENT, NETWORK, RPC_URL } = await loadNetwork({ VITE_BENZO_NETWORK: "benzonet" });

    expect(NETWORK).toBe("benzonet");
    expect(ACTIVE_CHAIN.id).toBe(68420);
    expect(RPC_URL).toBe("http://127.0.0.1:9650/ext/bc/21iisL1nkpM2AauUadAz7p1gK3waRBZLEJme3LU3gsWpaxy792/rpc");
    expect(DEPLOYMENT.contracts.EncryptedERC).toBe("0x790Dd53099E5009a9Cf572769a5A663cCb7EfAcE");
    expect(DEPLOYMENT.contracts.Registrar).toBe("0xdfB9b7d958539FC4A1e31C9b813833Fb972B30Ff");
    expect(DEPLOYMENT.contracts.tUSDC).toBe("0x85546bE3564d503F6ED77a4DA44BEF32EcAEd034");
    expect(DEPLOYMENT.contracts.verifiers.transfer).toBe("0xa1d0f50D5f479a2aeC3C67A38a6fa5c735CcC313");
  });

  it("selects Avalanche mainnet from VITE_BENZO_NETWORK", async () => {
    const {
      ACTIVE_CHAIN,
      DEPLOYMENT,
      ENCRYPTED_ERC_ADDRESS,
      EERC_USDC_TOKEN_ID,
      EXPLORER_BASE_URL,
      NETWORK,
      PRIVATE_GIFT_ESCROW_ADDRESS,
      REGISTRAR_ADDRESS,
      RPC_URL,
      USDC_TOKEN_ADDRESS,
      VERIFIER_ID,
    } = await loadNetwork({ VITE_BENZO_NETWORK: "avalanche" });

    expect(NETWORK).toBe("avalanche");
    expect(ACTIVE_CHAIN.id).toBe(43114);
    expect(RPC_URL).toBe("https://api.avax.network/ext/bc/C/rpc");
    expect(EXPLORER_BASE_URL).toBe("https://snowtrace.io");
    expect(DEPLOYMENT.contracts.EncryptedERC).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");
    expect(DEPLOYMENT.contracts.Registrar).toBe("0x902B8D5585A5124C9B9c001A95b7f520C07a79F2");
    expect(DEPLOYMENT.contracts.tUSDC).toBe("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
    expect(DEPLOYMENT.contracts.PrivateGiftEscrow).toBe("0xb22c366e000165683A51C2630F6Ab818e5227C94");
    expect(ENCRYPTED_ERC_ADDRESS).toBe(DEPLOYMENT.contracts.EncryptedERC);
    expect(REGISTRAR_ADDRESS).toBe(DEPLOYMENT.contracts.Registrar);
    expect(USDC_TOKEN_ADDRESS).toBe(DEPLOYMENT.contracts.tUSDC);
    expect(PRIVATE_GIFT_ESCROW_ADDRESS).toBe(DEPLOYMENT.contracts.PrivateGiftEscrow);
    expect(EERC_USDC_TOKEN_ID).toBe(1n);
    expect(VERIFIER_ID).toBe("0x4A716026a0C1F7158165520B6DF2009fFeB79f01");
  });
});
