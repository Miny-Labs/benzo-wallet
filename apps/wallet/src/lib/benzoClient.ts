import type { Address } from "viem";
import type { BenzoRecipient } from "@benzo/core";
import { createEerc, readEercPrivateBalance, readPublicUsdcBalance, transferPrivateUsdc } from "./eerc";
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
