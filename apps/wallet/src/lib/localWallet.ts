import { accountFromSignedMessage, createAccount, type BenzoAccount } from "@benzo/core";
import { IndexedDbKVStore, Keychain, newSalt, passphraseWrappingKey, prfWrappingKey } from "@benzo/wallet";
import type { Hex } from "viem";
import { registerEercAccount } from "./eerc";
import { isRegisteredOnEerc } from "./handleRegistry";
import { getLockSettings } from "./lock";
import { derivePasskeySecret, hasPasskey, registerPasskey } from "./passkey";

export interface WalletSecrets {
  evmPrivateKey: Hex;
  eercDecryptionKey: string;
  orgSpendId: string;
  mvkSeedHex: string;
}

let activeKeychain: Keychain | null = null;
let activeAccount: BenzoAccount | null = null;
// Kept alongside the account so a soft-restored session (no live Keychain) can
// still reveal its backup, and so lock can wipe it deterministically.
let activeSecrets: WalletSecrets | null = null;

const WALLET_TYPE_KEY = "benzo.wallet.type";
const RECOVERY_STATE_KEY = "benzo.recovery.v1";
// A short-lived, per-tab soft-unlock cache. It lets a page reload re-open the
// wallet WITHOUT a fresh biometric/passcode prompt — but only when the user has
// NOT opted into "require unlock on open" (lib/lock onOpen). Cleared on lock.
const SOFT_SESSION_KEY = "benzo.softSession.v1";

type WalletType = "passkey" | "passphrase";
type RecoveryBinding = "passkey-prf" | "manual-backup";

interface StoredRecoveryState {
  version: 1;
  walletType: WalletType;
  binding: RecoveryBinding;
  createdAt: number;
  lastExportedAt?: number;
  backupConfirmedAt?: number;
}

export interface LocalRecoveryStatus {
  bound: boolean;
  recoverable: boolean;
  status: "healthy" | "action-needed" | "locked";
  custody: "non-custodial";
  label: string;
  nextSteps: string[];
  createdAt?: number;
  lastExportedAt?: number;
  backupConfirmedAt?: number;
}

export interface PrivateBalanceActivation {
  alreadyRegistered: boolean;
  txHash?: Hex;
}

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

function readRecoveryState(): StoredRecoveryState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_STATE_KEY) || "null") as StoredRecoveryState | null;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecoveryState(next: StoredRecoveryState): void {
  try {
    localStorage.setItem(RECOVERY_STATE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function currentWalletType(): WalletType | null {
  const stored = localStorage.getItem(WALLET_TYPE_KEY);
  return stored === "passkey" || stored === "passphrase" ? stored : null;
}

function updateRecoveryState(patch: Partial<StoredRecoveryState> & Pick<StoredRecoveryState, "walletType" | "binding">): void {
  const previous = readRecoveryState();
  const base: StoredRecoveryState = previous ?? {
    version: 1,
    walletType: patch.walletType,
    binding: patch.binding,
    createdAt: Date.now(),
  };
  writeRecoveryState({
    ...base,
    ...patch,
  });
}

function markBackupExported(): void {
  const previous = readRecoveryState();
  const walletType = previous?.walletType ?? currentWalletType();
  if (!walletType) return;
  writeRecoveryState({
    version: 1,
    walletType,
    binding: previous?.binding ?? "manual-backup",
    createdAt: previous?.createdAt ?? Date.now(),
    backupConfirmedAt: previous?.backupConfirmedAt,
    lastExportedAt: Date.now(),
  });
}

export function markWalletBackupConfirmed(): void {
  const previous = readRecoveryState();
  const walletType = previous?.walletType ?? currentWalletType();
  if (!walletType) return;
  writeRecoveryState({
    version: 1,
    walletType,
    binding: previous?.binding ?? "manual-backup",
    createdAt: previous?.createdAt ?? Date.now(),
    lastExportedAt: previous?.lastExportedAt ?? Date.now(),
    backupConfirmedAt: Date.now(),
  });
}

export function getLocalRecoveryStatus(): LocalRecoveryStatus {
  const state = readRecoveryState();
  const walletType = currentWalletType() ?? state?.walletType ?? null;
  const passkeyBound = walletType === "passkey" && state?.binding === "passkey-prf" && hasPasskey();
  const backupAvailable = !!state?.backupConfirmedAt || !!state?.lastExportedAt;

  if (passkeyBound) {
    return {
      bound: true,
      recoverable: true,
      status: "healthy",
      custody: "non-custodial",
      label: "Synced passkey",
      nextSteps: [
        "This wallet can be recreated from your synced passkey. Keep an export as a second backup.",
      ],
      createdAt: state?.createdAt,
      lastExportedAt: state?.lastExportedAt,
      backupConfirmedAt: state?.backupConfirmedAt,
    };
  }

  if (backupAvailable) {
    return {
      bound: false,
      recoverable: true,
      status: "healthy",
      custody: "non-custodial",
      label: state?.backupConfirmedAt ? "Backup saved" : "Backup revealed",
      nextSteps: [
        "Restore on another device with your backup JSON. Benzo cannot recover it for you.",
      ],
      createdAt: state?.createdAt,
      lastExportedAt: state?.lastExportedAt,
      backupConfirmedAt: state?.backupConfirmedAt,
    };
  }

  if (!state && !walletType) {
    return {
      bound: false,
      recoverable: false,
      status: "locked",
      custody: "non-custodial",
      label: "Wallet locked",
      nextSteps: ["Unlock this wallet to check local recovery state."],
    };
  }

  return {
    bound: false,
    recoverable: false,
    status: "action-needed",
    custody: "non-custodial",
    label: "Device only",
    nextSteps: [
      "Reveal and save a backup JSON, or create a passkey wallet on a device with synced passkeys.",
    ],
    createdAt: state?.createdAt,
    lastExportedAt: state?.lastExportedAt,
    backupConfirmedAt: state?.backupConfirmedAt,
  };
}

function notifyWalletChanged(): void {
  if (typeof window !== "undefined") {
    // Same channel the store listens on to (re)load balances/history when the
    // wallet unlocks, locks, or soft-restores. No backend round-trip involved.
    window.dispatchEvent(new Event("benzo:auth-changed"));
  }
}

function persistSoftSession(secrets: WalletSecrets): void {
  // Never cache secrets when the user asked to re-verify on open — that toggle
  // means every reload must go through the lock, so a soft session would defeat it.
  if (getLockSettings().onOpen) return;
  try {
    sessionStorage.setItem(SOFT_SESSION_KEY, JSON.stringify(secrets));
  } catch {
    /* ignore */
  }
}

function clearSoftSession(): void {
  try {
    sessionStorage.removeItem(SOFT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Re-open the wallet from the per-tab soft session after a reload, so a
 * self-custody wallet doesn't hard-lock on every refresh. No-op when the wallet
 * is already unlocked, and honored ONLY when the user hasn't opted into an
 * open-lock (lib/lock onOpen) — in which case the cached session is dropped and
 * the caller falls through to the lock screen.
 */
export function restoreSoftSession(): BenzoAccount | null {
  if (activeAccount) return activeAccount;
  if (getLockSettings().onOpen) {
    clearSoftSession();
    return null;
  }
  try {
    const raw = sessionStorage.getItem(SOFT_SESSION_KEY);
    if (!raw) return null;
    const secrets = JSON.parse(raw) as WalletSecrets;
    activeSecrets = secrets;
    activeAccount = accountFromSecrets(secrets);
    notifyWalletChanged();
    return activeAccount;
  } catch {
    clearSoftSession();
    return null;
  }
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

let eercRegistrationInFlight: Promise<PrivateBalanceActivation | null> | null = null;
// Once registration is confirmed for the ACTIVE session, later sends skip the
// redundant Registrar read (transferPrivateUsdc re-checks internally anyway).
// Reset on lock so a different account re-verifies against the chain.
let eercRegistrationConfirmed = false;

export async function activatePrivateBalance(): Promise<PrivateBalanceActivation | null> {
  const account = getLocalAccount();
  if (!account) return null;
  if (eercRegistrationConfirmed) return { alreadyRegistered: true };
  if (!eercRegistrationInFlight) {
    eercRegistrationInFlight = (async () => {
      if (await isRegisteredOnEerc(account.address)) {
        return { alreadyRegistered: true };
      }
      const txHash = await registerEercAccount(account);
      return { alreadyRegistered: !txHash, txHash };
    })()
      .then((result) => {
        eercRegistrationConfirmed = true;
        return result;
      })
      .finally(() => {
        eercRegistrationInFlight = null;
      });
  }
  return eercRegistrationInFlight;
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
  activeSecrets = secrets;

  localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
  writeRecoveryState({
    version: 1,
    walletType: "passphrase",
    binding: "manual-backup",
    createdAt: Date.now(),
  });
  persistSoftSession(secrets);
  notifyWalletChanged();
  return account;
}

export async function createWalletWithPasskey(userName: string): Promise<BenzoAccount> {
  const kv = await getStore();
  await registerPasskey({ userName, displayName: userName });

  const masterSeed = await derivePasskeySecret();
  const wrappingKey = prfWrappingKey(masterSeed);
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
  activeAccount = account;
  activeSecrets = secrets;

  localStorage.setItem(WALLET_TYPE_KEY, "passkey");
  writeRecoveryState({
    version: 1,
    walletType: "passkey",
    binding: "passkey-prf",
    createdAt: Date.now(),
  });
  persistSoftSession(secrets);
  notifyWalletChanged();
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
  activeSecrets = kc.secrets;
  localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
  persistSoftSession(kc.secrets);
  notifyWalletChanged();
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
  activeSecrets = kc.secrets;
  localStorage.setItem(WALLET_TYPE_KEY, "passkey");
  persistSoftSession(kc.secrets);
  notifyWalletChanged();
  return account;
}

export function lockWallet(): void {
  activeKeychain?.lock();
  activeKeychain = null;
  activeAccount = null;
  activeSecrets = null;
  clearSoftSession();
  // Drop any in-flight/confirmed registration so a re-unlocked (possibly
  // different) account can never inherit the prior session's result.
  eercRegistrationInFlight = null;
  eercRegistrationConfirmed = false;
  notifyWalletChanged();
}

export async function exportWallet(): Promise<string> {
  const secrets = activeKeychain?.secrets ?? activeSecrets;
  if (!secrets) throw new Error("Wallet is locked");
  markBackupExported();
  return JSON.stringify(secrets, null, 2);
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
    localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
    updateRecoveryState({ walletType: "passphrase", binding: "manual-backup" });
  } else {
    await registerPasskey({ userName: "imported-wallet" });
    const prfOutput = await derivePasskeySecret();
    const wrappingKey = prfWrappingKey(prfOutput);
    activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
    localStorage.setItem(WALLET_TYPE_KEY, "passkey");
    updateRecoveryState({ walletType: "passkey", binding: "manual-backup" });
  }

  activeAccount = accountFromSecrets(secrets);
  activeSecrets = secrets;
  persistSoftSession(secrets);
  notifyWalletChanged();
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
  localStorage.removeItem(WALLET_TYPE_KEY);
  localStorage.removeItem(RECOVERY_STATE_KEY);
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
