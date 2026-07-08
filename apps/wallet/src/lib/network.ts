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

// On-chain gift escrow (PrivateGiftEscrow.sol). Wired from env, falling back to
// the @benzo/config deployment. The zero placeholder is the "not deployed yet"
// default — the WL7 deploy step writes the real Fuji address here (or via
// VITE_PRIVATE_GIFT_ESCROW_ADDRESS), and requireGiftEscrowAddress() throws a
// clear error until then, so gift ops fail loudly rather than sending to 0x0.
const PRIVATE_GIFT_ESCROW_PLACEHOLDER = "0x0000000000000000000000000000000000000000";
export const PRIVATE_GIFT_ESCROW_ADDRESS = (env.VITE_PRIVATE_GIFT_ESCROW_ADDRESS ??
  (DEPLOYMENT.contracts as { PrivateGiftEscrow?: Address }).PrivateGiftEscrow ??
  PRIVATE_GIFT_ESCROW_PLACEHOLDER) as Address;

export const EERC_CONVERTER_MODE = (env.VITE_EERC_CONVERTER_MODE ?? "true") !== "false";
export const USDC_DECIMALS = Number(env.VITE_USDC_DECIMALS ?? "6");
export const EERC_USDC_TOKEN_ID = BigInt(env.VITE_EERC_USDC_TOKEN_ID ?? "1");

const FUJI_EERC_ACTIVITY_START_BLOCK = "56879304";
const FUJI_CURRENT_EERC_ADDRESS = "0x9e16ed3b799541b4929f7e2014904c65e81035b1";
export const EERC_ACTIVITY_START_BLOCK = BigInt(
  env.VITE_EERC_ACTIVITY_START_BLOCK ??
    (NETWORK === "fuji" && ENCRYPTED_ERC_ADDRESS?.toLowerCase() === FUJI_CURRENT_EERC_ADDRESS
      ? FUJI_EERC_ACTIVITY_START_BLOCK
      : "0"),
);
export const EERC_ACTIVITY_LOG_WINDOW_BLOCKS = BigInt(env.VITE_EERC_ACTIVITY_LOG_WINDOW_BLOCKS ?? "10000");

export const USDC_ASSET = USDC_TOKEN_ADDRESS ?? "USDC";
export const VERIFIER_ID = DEPLOYMENT.contracts.verifiers.transfer;
