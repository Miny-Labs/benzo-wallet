import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { BenzoRecipient } from "@benzo/core";
import {
  createEerc,
  readEercPrivateBalance,
  readPublicUsdcBalance,
  shieldPublicUsdc,
  transferPrivateUsdc,
  transferPublicUsdc,
  unshieldPrivateUsdc,
} from "./eerc";
import { claimHandleOnChain } from "./handleRegistry";
import { getLocalAccount } from "./localWallet";

export async function getClient() {
  const account = getLocalAccount();
  return account ? await createEerc(account) : null;
}

export async function sendClientSide(
  to: Address | BenzoRecipient,
  amountBaseUnits: string,
  memo?: string,
): Promise<{ txHash?: string; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const address = typeof to === "string" ? to : to.address;
  if (!address) return null;
  const result = await transferPrivateUsdc(account, address, BigInt(amountBaseUnits), memo);
  return { txHash: result.txHash, prover: "local" };
}

/**
 * Claim a @handle on-chain with the device wallet, so HandleRegistry.ownerOf
 * resolves to the user's own address. Returns null when the wallet is locked.
 * No registration UI surfaces this yet; it is the client-side registration
 * primitive a future "claim your @handle" screen should call.
 */
export async function claimHandleClientSide(
  handle: string,
): Promise<{ handle: string; txHash: Hex; address: Address } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return claimHandleOnChain(account, handle);
}

export async function sendPublicClientSide(
  to: string,
  amountBaseUnits: string,
): Promise<{ txHash?: string; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  if (!isAddress(to, { strict: false })) throw new Error("Enter a valid Avalanche wallet address.");
  const result = await transferPublicUsdc(account, getAddress(to), BigInt(amountBaseUnits));
  return { txHash: result.txHash, prover: "local" };
}

export async function shieldPublicUsdcClientSide(
  amountBaseUnits: string,
  memo?: string,
): Promise<{ approvalTxHash?: string; registrationTxHash?: string; txHash?: string; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const result = await shieldPublicUsdc(account, BigInt(amountBaseUnits), memo);
  return { ...result, prover: "local" };
}

export async function unshieldPrivateUsdcClientSide(
  amountBaseUnits: string,
  memo?: string,
): Promise<{ registrationTxHash?: string; txHash?: string; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const result = await unshieldPrivateUsdc(account, BigInt(amountBaseUnits), memo);
  return { ...result, prover: "local" };

}

export async function clientSideReadsAvailable(): Promise<boolean> {
  return getLocalAccount() !== null;
}

export async function readShieldedBalanceClientSide(): Promise<string | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return readEercPrivateBalance(account);
}

export async function readPublicBalanceClientSide(): Promise<string | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return readPublicUsdcBalance(account);
}

export async function proveBalanceClientSide(
  _minBaseUnits: string,
): Promise<{ holds: boolean; onChain: boolean; provingMs?: number; verifyMs?: number } | null> {
  return null;
}

export async function createInviteClientSide(_amountBaseUnits: string): Promise<{ link: string; claimSecretHex: string; txHash?: string } | null> {
  return null;
}

export async function refundInviteClientSide(_claimSecretHex: string): Promise<{ txHash?: string } | null> {
  return null;
}

export async function claimLinkClientSide(_claimSecretHex: string): Promise<{ amount: string; txHash?: string } | null> {
  return null;
}
