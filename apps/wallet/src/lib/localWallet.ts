import { accountFromSignedMessage, createAccount, type BenzoAccount } from "@benzo/core";
import { IndexedDbKVStore, Keychain, newSalt, passphraseWrappingKey, prfWrappingKey } from "@benzo/wallet";
import type { Hex } from "viem";
import { api } from "./api";
import { createDeviceAuthProof, derivePasskeySecret, registerPasskey } from "./passkey";

export interface WalletSecrets {
  evmPrivateKey: Hex;
  eercDecryptionKey: string;
  orgSpendId: string;
  mvkSeedHex: string;
}

let activeKeychain: Keychain | null = null;
let activeAccount: BenzoAccount | null = null;

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(s: string): Uint8Array {
  const clean = s.startsWith("0x") ? s.slice(2) : s;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function secretsFromAccount(account: BenzoAccount, seed: Uint8Array): WalletSecrets {
  return {
    evmPrivateKey: account.evmPrivateKey,
    eercDecryptionKey: account.eercDecryptionKey,
    orgSpendId: account.spendSk.toString(),
    mvkSeedHex: toHex(seed),
  };
}

function accountFromSecrets(secrets: WalletSecrets): BenzoAccount {
  return createAccount({
    eercDecryptionKey: secrets.eercDecryptionKey,
    evmPrivateKey: secrets.evmPrivateKey,
    seed: fromHex(secrets.mvkSeedHex),
    spendSk: BigInt(secrets.orgSpendId),
  });
}

export async function getStore(): Promise<IndexedDbKVStore> {
  return IndexedDbKVStore.open("benzo-wallet", "keychain");
}

export async function walletExists(): Promise<boolean> {
  const kv = await getStore();
  return Keychain.exists(kv);
}

export function getLocalAccount(): BenzoAccount | null {
  return activeAccount;
}

export function isWalletUnlocked(): boolean {
  return activeAccount !== null;
}

async function loginSiweSession(): Promise<void> {
  const account = getLocalAccount();
  if (!account || !activeKeychain) return;
  try {
    const signer = activeKeychain.signer();
    await api.signInWithSiwe(account.address, (message) => signer.signMessage(message));
    window.dispatchEvent(new Event("benzo:auth-changed"));
  } catch (e) {
    console.error("Failed to authenticate local wallet with Benzo API:", e);
  }
}

/**
 * Best-effort background SIWE re-auth. No-ops when the wallet is locked, and
 * swallows/logs errors, so a 401 can silently refresh the backend session
 * without ever tearing down the device-local wallet.
 */
export async function reauthenticateSession(): Promise<void> {
  await loginSiweSession();
}

export async function createWallet(passphrase: string): Promise<BenzoAccount> {
  const kv = await getStore();
  const salt = newSalt();
  await kv.set("benzo/keychain/v1/salt", salt);

  const wrappingKey = passphraseWrappingKey(passphrase, salt);
  const masterSeed = crypto.getRandomValues(new Uint8Array(32));
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
  activeAccount = account;

  localStorage.setItem("benzo.wallet.type", "passphrase");
  await loginSiweSession();
  return account;
}

export async function createWalletWithPasskey(userName: string): Promise<BenzoAccount> {
  const kv = await getStore();
  await registerPasskey({ userName, displayName: userName });

  const prfOutput = await derivePasskeySecret();
  const wrappingKey = prfWrappingKey(prfOutput);

  const masterSeed = crypto.getRandomValues(new Uint8Array(32));
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
  activeAccount = account;

  localStorage.setItem("benzo.wallet.type", "passkey");
  await loginSiweSession();
  return account;
}

export async function unlockWallet(passphrase: string): Promise<BenzoAccount> {
  const kv = await getStore();
  const salt = await kv.get("benzo/keychain/v1/salt");
  if (!salt) throw new Error("Wallet salt not found. Try importing your wallet.");

  const wrappingKey = passphraseWrappingKey(passphrase, salt);
  const kc = await Keychain.unlock({ kv, wrappingKey });
  const account = accountFromSecrets(kc.secrets);

  activeKeychain = kc;
  activeAccount = account;
  await loginSiweSession();
  return account;
}

export async function unlockWalletWithPasskey(): Promise<BenzoAccount> {
  const kv = await getStore();
  const prfOutput = await derivePasskeySecret();
  const wrappingKey = prfWrappingKey(prfOutput);

  const kc = await Keychain.unlock({ kv, wrappingKey });
  const account = accountFromSecrets(kc.secrets);

  activeKeychain = kc;
  activeAccount = account;
  await loginSiweSession();
  return account;
}

export function lockWallet(): void {
  activeKeychain?.lock();
  activeKeychain = null;
  activeAccount = null;
  void api.logout().catch(() => {});
}

export async function exportWallet(): Promise<string> {
  if (!activeKeychain) throw new Error("Wallet is locked");
  return JSON.stringify(activeKeychain.secrets, null, 2);
}

export async function importWallet(importedText: string, passphrase?: string): Promise<BenzoAccount> {
  const kv = await getStore();
  let secrets: WalletSecrets;

  const cleanText = importedText.trim();
  if (cleanText.startsWith("{")) {
    const parsed = JSON.parse(cleanText) as Partial<WalletSecrets> & { stellarSecret?: string };
    if (parsed.stellarSecret) {
      throw new Error("Stellar backups belong to the retired wallet. Import an Avalanche Benzo backup JSON.");
    }
    secrets = parsed as WalletSecrets;
  } else if (/^0x[0-9a-fA-F]{64}$/.test(cleanText)) {
    const seed = fromHex(cleanText);
    const account = createAccount({ evmPrivateKey: cleanText as Hex, seed });
    secrets = secretsFromAccount(account, seed);
  } else if (/^S[A-Z2-7]{55}$/.test(cleanText)) {
    throw new Error("Stellar secret keys are not valid for the Avalanche wallet.");
  } else {
    throw new Error("Invalid import format. Provide Avalanche Benzo backup JSON or a 0x EVM private key.");
  }

  if (passphrase) {
    const salt = newSalt();
    await kv.set("benzo/keychain/v1/salt", salt);
    const wrappingKey = passphraseWrappingKey(passphrase, salt);
    activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
    localStorage.setItem("benzo.wallet.type", "passphrase");
  } else {
    await registerPasskey({ userName: "imported-wallet" });
    const prfOutput = await derivePasskeySecret();
    const wrappingKey = prfWrappingKey(prfOutput);
    activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
    localStorage.setItem("benzo.wallet.type", "passkey");
  }

  activeAccount = accountFromSecrets(secrets);
  await loginSiweSession();
  return activeAccount;
}

export async function deleteWallet(): Promise<void> {
  const kv = await getStore();
  if (activeKeychain) {
    await activeKeychain.wipe();
  } else {
    const kc = await Keychain.unlock({ kv, wrappingKey: new Uint8Array(32) }).catch(() => null);
    if (kc) await kc.wipe();
    else await kv.delete("benzo/keychain/v1");
  }
  await kv.delete("benzo/keychain/v1/salt");
  localStorage.removeItem("benzo.wallet.type");
  lockWallet();
}

export function getLocalAccountSummary() {
  if (!activeAccount) return null;
  return {
    address: activeAccount.address,
    spendPub: activeAccount.spendPub.toString(),
    mvkPub: toHex(activeAccount.mvkPub),
  };
}

export function getLocalDeviceAuthProof() {
  if (!activeAccount) return null;
  return createDeviceAuthProof(activeAccount);
}
