import type { EERC } from "@avalabs/eerc-sdk";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTIVE_CHAIN,
  EERC_CONVERTER_MODE,
  ENCRYPTED_ERC_ADDRESS,
  REGISTRAR_ADDRESS,
  RPC_URL,
  USDC_DECIMALS,
  USDC_TOKEN_ADDRESS,
} from "./network";
import type { BenzoAccount } from "@benzo/core";

type CircuitURLs = ConstructorParameters<typeof EERC>[5];

const env = import.meta.env as unknown as Record<string, string | undefined>;

function circuitUrl(operation: string, artifact: "wasm" | "zkey"): string {
  const key = `VITE_EERC_${operation.toUpperCase()}_${artifact.toUpperCase()}_URL`;
  return env[key] ?? `/circuits/${operation}.${artifact}`;
}

export const EERC_CIRCUIT_URLS: CircuitURLs = {
  register: { wasm: circuitUrl("registration", "wasm"), zkey: circuitUrl("registration", "zkey") },
  transfer: { wasm: circuitUrl("transfer", "wasm"), zkey: circuitUrl("transfer", "zkey") },
  mint: { wasm: circuitUrl("mint", "wasm"), zkey: circuitUrl("mint", "zkey") },
  withdraw: { wasm: circuitUrl("withdraw", "wasm"), zkey: circuitUrl("withdraw", "zkey") },
  burn: { wasm: circuitUrl("burn", "wasm"), zkey: circuitUrl("burn", "zkey") },
};

export function createViemClients(account: BenzoAccount): {
  publicClient: PublicClient;
  walletClient: WalletClient;
} {
  const viemAccount = privateKeyToAccount(account.evmPrivateKey);
  return {
    publicClient: createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL) }),
    walletClient: createWalletClient({
      account: viemAccount,
      chain: ACTIVE_CHAIN,
      transport: http(RPC_URL),
    }),
  };
}

// The eERC SDK bundles snarkjs + circuit tooling (multi-MB), and is only needed
// once the user performs an encrypted op (balance read / transfer). Load it via
// dynamic import so it stays out of the initial bundle and is fetched on demand.
let eercCtorPromise: Promise<typeof EERC> | null = null;
function loadEERC(): Promise<typeof EERC> {
  if (!eercCtorPromise) {
    eercCtorPromise = import("@avalabs/eerc-sdk").then((m) => m.EERC);
  }
  return eercCtorPromise;
}

export async function createEerc(account: BenzoAccount): Promise<EERC | null> {
  if (!ENCRYPTED_ERC_ADDRESS || !REGISTRAR_ADDRESS) return null;
  const EERCClass = await loadEERC();
  const { publicClient, walletClient } = createViemClients(account);
  return new EERCClass(
    publicClient,
    walletClient,
    ENCRYPTED_ERC_ADDRESS,
    REGISTRAR_ADDRESS,
    EERC_CONVERTER_MODE,
    EERC_CIRCUIT_URLS,
    account.eercDecryptionKey,
  );
}

function eercPublicClient(eerc: EERC): PublicClient {
  return (eerc as unknown as { client: PublicClient }).client;
}

export async function readPublicUsdcBalance(account: BenzoAccount): Promise<string | null> {
  if (!USDC_TOKEN_ADDRESS) return null;
  const { publicClient } = createViemClients(account);
  const balance = await publicClient.readContract({
    address: USDC_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  return balance.toString();
}

export async function readEercPrivateBalance(account: BenzoAccount): Promise<string | null> {
  const eerc = await createEerc(account);
  if (!eerc || !ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return null;
  const publicKey = await eerc.fetchPublicKey(account.address);
  if (publicKey[0] === 0n && publicKey[1] === 0n) return "0";
  const result = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS,
    abi: eerc.encryptedErcAbi,
    functionName: EERC_CONVERTER_MODE ? "getBalanceFromTokenAddress" : "balanceOf",
    args: EERC_CONVERTER_MODE ? [account.address, USDC_TOKEN_ADDRESS] : [account.address, 0n],
  } as never);
  const [eGCT, , amountPCTs, balancePCT] = result as [
    unknown,
    bigint,
    Array<{ pct: bigint[]; index: bigint }>,
    bigint[],
    bigint,
  ];
  return eerc.calculateTotalBalance(eGCT as never, amountPCTs, balancePCT).toString();
}

export async function transferPrivateUsdc(
  account: BenzoAccount,
  to: Address,
  amount: bigint,
  message?: string,
): Promise<{ txHash: Hex }> {
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  const eerc = await createEerc(account);
  if (!eerc) throw new Error("eERC contracts are not configured.");
  const balance = await readEercBalanceParts(eerc, account.address, USDC_TOKEN_ADDRESS);
  const auditor = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS!,
    abi: eerc.encryptedErcAbi,
    functionName: "auditorPublicKey",
    args: [],
  } as never) as bigint[];
  const result = await eerc.transfer(
    to,
    amount,
    balance.encryptedBalance,
    balance.decryptedBalance,
    auditor,
    USDC_TOKEN_ADDRESS,
    message,
  );
  return { txHash: result.transactionHash };
}

async function readEercBalanceParts(eerc: EERC, address: Address, token: Address): Promise<{
  decryptedBalance: bigint;
  encryptedBalance: bigint[];
}> {
  const result = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS!,
    abi: eerc.encryptedErcAbi,
    functionName: EERC_CONVERTER_MODE ? "getBalanceFromTokenAddress" : "balanceOf",
    args: EERC_CONVERTER_MODE ? [address, token] : [address, 0n],
  } as never);
  const [eGCT, , amountPCTs, balancePCT] = result as [
    { c1: { x: bigint; y: bigint }; c2: { x: bigint; y: bigint } },
    bigint,
    Array<{ pct: bigint[]; index: bigint }>,
    bigint[],
    bigint,
  ];
  return {
    decryptedBalance: eerc.calculateTotalBalance(eGCT, amountPCTs, balancePCT),
    encryptedBalance: [eGCT.c1.x, eGCT.c1.y, eGCT.c2.x, eGCT.c2.y],
  };
}

export function usdcBaseUnitsToDisplayUnits(value: bigint): bigint {
  return USDC_DECIMALS === 6 ? value : value / 10n ** BigInt(Math.max(USDC_DECIMALS - 6, 0));
}
