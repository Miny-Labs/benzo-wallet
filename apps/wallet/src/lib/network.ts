import {
  benzonet,
  benzonetDeployments,
  BENZONET_CHAIN_ID,
  BENZONET_LOCAL_RPC_URL,
  deploymentsByNetwork,
  fuji,
  type DeploymentNetwork,
} from "@benzo/config";
import type { Address, Chain } from "viem";

const env = import.meta.env as unknown as Record<string, string | undefined>;

function deploymentNetwork(value: string | undefined): DeploymentNetwork {
  return value === "benzonet" ? "benzonet" : "fuji";
}

export const NETWORK = deploymentNetwork(env.VITE_CHAIN_ENV ?? env.VITE_BENZO_NETWORK);
export const DEPLOYMENT = deploymentsByNetwork[NETWORK];
export const CHAIN_ID = DEPLOYMENT.chainId;

const benzonetRpc = env.VITE_BENZONET_RPC_URL ?? env.VITE_RPC_URL ?? BENZONET_LOCAL_RPC_URL;
const fujiRpc = env.VITE_FUJI_RPC_URL ?? env.VITE_RPC_URL ?? fuji.rpcUrls.default.http[0];

export const RPC_URL = NETWORK === "benzonet" ? benzonetRpc : fujiRpc;

export const ACTIVE_CHAIN: Chain =
  NETWORK === "benzonet"
    ? {
        ...benzonet,
        rpcUrls: { default: { http: [RPC_URL] } },
      }
    : {
        ...fuji,
        rpcUrls: { default: { http: [RPC_URL] } },
      };

export const NETWORK_LABEL = ACTIVE_CHAIN.name;
export const EXPLORER_BASE_URL =
  ACTIVE_CHAIN.blockExplorers?.default.url ?? (CHAIN_ID === BENZONET_CHAIN_ID ? "https://rpc.benzo.space" : "https://testnet.snowtrace.io");

export const ENCRYPTED_ERC_ADDRESS = (env.VITE_EERC_ENCRYPTED_ERC_ADDRESS ??
  DEPLOYMENT.contracts.EncryptedERC) as Address | undefined;
export const REGISTRAR_ADDRESS = (env.VITE_EERC_REGISTRAR_ADDRESS ??
  DEPLOYMENT.contracts.Registrar) as Address | undefined;
export const USDC_TOKEN_ADDRESS = (env.VITE_USDC_TOKEN_ADDRESS ??
  DEPLOYMENT.contracts.tUSDC) as Address | undefined;
export const HANDLE_REGISTRY_ADDRESS = (env.VITE_HANDLE_REGISTRY_ADDRESS ??
  (DEPLOYMENT.contracts as { HandleRegistry?: Address }).HandleRegistry) as Address | undefined;

export const EERC_CONVERTER_MODE = (env.VITE_EERC_CONVERTER_MODE ?? "true") !== "false";
export const USDC_DECIMALS = Number(env.VITE_USDC_DECIMALS ?? "6");

export const USDC_ASSET = USDC_TOKEN_ADDRESS ?? "USDC";
export const VERIFIER_ID = DEPLOYMENT.contracts.verifiers.transfer;
