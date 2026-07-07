import { defineChain, type Address } from "viem";

// TODO(@benzo/config): replace this vendored slice with the published package
// from Miny-Labs/benzo once it is available to this frontend workspace.
export const FUJI_CHAIN_ID = 43_113;
export const BENZONET_CHAIN_ID = 68_420;
export const BENZONET_BLOCKCHAIN_ID =
  "21iisL1nkpM2AauUadAz7p1gK3waRBZLEJme3LU3gsWpaxy792";
export const BENZONET_RPC_PATH = `/ext/bc/${BENZONET_BLOCKCHAIN_ID}/rpc`;
export const BENZONET_LOCAL_RPC_URL = `http://127.0.0.1:9650${BENZONET_RPC_PATH}`;

export const fuji = defineChain({
  id: FUJI_CHAIN_ID,
  name: "Avalanche Fuji",
  nativeCurrency: {
    decimals: 18,
    name: "Avalanche Fuji AVAX",
    symbol: "AVAX",
  },
  rpcUrls: {
    default: {
      http: ["https://api.avax-test.network/ext/bc/C/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Snowtrace",
      url: "https://testnet.snowtrace.io",
    },
  },
  testnet: true,
});

export const benzonet = defineChain({
  id: BENZONET_CHAIN_ID,
  name: "BenzoNet",
  nativeCurrency: {
    decimals: 18,
    name: "Benzo Gas",
    symbol: "BGAS",
  },
  rpcUrls: {
    default: {
      http: [BENZONET_LOCAL_RPC_URL],
    },
  },
  testnet: true,
});

export const benzoChains = [fuji, benzonet] as const;

export const DEPLOYMENT_NETWORKS = ["fuji", "benzonet"] as const;
export type DeploymentNetwork = (typeof DEPLOYMENT_NETWORKS)[number];
export type DeploymentChainId = typeof FUJI_CHAIN_ID | typeof BENZONET_CHAIN_ID;
export type CircuitOperation = "registration" | "transfer" | "mint" | "withdraw" | "burn";
export type VerifierDeployments = Record<CircuitOperation, Address>;

export type DeploymentContracts = {
  verifiers: VerifierDeployments;
  Registrar?: Address;
  EncryptedERC?: Address;
  tUSDC?: Address;
  HandleRegistry?: Address;
  InvoiceRegistry?: Address;
  GiftEscrow?: Address;
};

export type Deployments = {
  network: DeploymentNetwork;
  chainId: DeploymentChainId;
  contracts: DeploymentContracts;
};

export const fujiDeployments = {
  network: "fuji",
  chainId: FUJI_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x4250bD1eb89Ef78469f94da2fE7738DCdcb09Ef7",
      transfer: "0x4bF3DBD3fF57943dC402ec1F280589E1032A32A5",
      mint: "0x0fE395F5E97Ee02c961DE3d035E5De2D9019D15E",
      withdraw: "0x7E194cb8A575d23f74EEDbEf1b519B281B29c30e",
      burn: "0x1BDfD6cB772D5F882622BaFD7B19898Da9F61d34",
    },
    Registrar: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
    EncryptedERC: "0x46688f1704a69a6c276cCCB823E36C80787B0FA2",
    tUSDC: "0x1226C73Bd8022080b8DbCDC24AA8B61D659A835f",
  },
} as const satisfies Deployments;

export const benzonetDeployments = {
  network: "benzonet",
  chainId: BENZONET_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
      transfer: "0xa1d0f50D5f479a2aeC3C67A38a6fa5c735CcC313",
      mint: "0x1226C73Bd8022080b8DbCDC24AA8B61D659A835f",
      withdraw: "0x46688f1704a69a6c276cCCB823E36C80787B0FA2",
      burn: "0x992014C9De921CC064Ea6BC03849aea638b86Fd1",
    },
    Registrar: "0xdfB9b7d958539FC4A1e31C9b813833Fb972B30Ff",
    EncryptedERC: "0x790Dd53099E5009a9Cf572769a5A663cCb7EfAcE",
    tUSDC: "0x85546bE3564d503F6ED77a4DA44BEF32EcAEd034",
  },
} as const satisfies Deployments;

export const deploymentsByNetwork = {
  fuji: fujiDeployments,
  benzonet: benzonetDeployments,
} as const satisfies Record<DeploymentNetwork, Deployments>;
