import { createSiweMessage } from "viem/siwe";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./network";
import { handleAvailableOnChain, normalizeHandle } from "./handleRegistry";
import { usdcToStroops } from "./format";
import { saveLocalHistory } from "./history";
import { INVALID_USDC_AMOUNT_ERROR } from "./errors";

export type ProverKind = "local";

export interface Session {
  profile: { handle: string; name: string };
  handle?: string;
  kycTier?: number;
  live: boolean;
  mode: "live" | "unavailable";
  missing: string[];
  prover: { available: ProverKind[]; mode: "local"; location: "local" };
}
export interface Balance {
  stroops: string;
  live: boolean;
  source?: "chain" | "ledger";
  syncing?: boolean;
}
export interface ActivityRow {
  id: string;
  type: string;
  name: string;
  note: string;
  amount: string;
  direction: "in" | "out";
  status: "settled" | "pending" | "proving" | "arriving" | "failed";
  timestamp: number;
  txHash?: string;
  tone?: "accent" | "amber" | "neutral";
  unverified?: boolean;
}
export interface Contact {
  handle: string;
  name: string;
  tone?: "accent" | "amber" | "neutral";
}
export interface SettleResult {
  status: "settled" | "failed";
  txHash?: string;
  provingMs?: number;
  prover: ProverKind;
  amount: string;
  onChain: boolean;
  sorobanPublics?: string[];
  nullifier?: string;
  requestId?: string;
  error?: string;
}

export interface SendPhaseEvent {
  phase: "building" | "proving" | "submitting" | "confirmed" | "failed";
  provingMs?: number;
  txHash?: string;
  onChain?: boolean;
  error?: string;
}

export interface InviteResult {
  link: string;
  localId: string;
  claimAccountPub: string;
  amount: string;
  expiresAt: number;
  onChain: boolean;
  sorobanPublics?: string[];
}
export interface InviteSummary {
  localId: string;
  amount: string;
  note?: string;
  link: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "claimed" | "refunded" | "expired";
}
export interface ClaimStatus {
  status: "open" | "claimed" | "refunded" | "expired";
  amount?: string;
  expiresAt?: number;
  onChain: boolean;
}
export interface ProofReceipt {
  id: string;
  action: string;
  vkId: string;
  prover?: ProverKind;
  verified: boolean;
  publicInputs?: unknown;
  txHash?: string;
  verifier?: string;
  createdAt: number;
}

export interface RecoveryStatus {
  status: "ok";
  recovery: {
    bound: boolean;
    createdAt?: number;
    lastSeenAt?: number;
    status: "unbound" | "healthy";
    custody: "non-custodial";
    nextSteps: string[];
  };
}

export interface DeleteAccountResult {
  deleted: boolean;
}

export interface DeviceAuthProof {
  address: string;
  message: string;
  signature: string;
  ttlSeconds?: number;
}

type ApiUser = {
  address: string;
  id: string;
  roles: string[];
};

const env = import.meta.env as unknown as Record<string, string | undefined>;
const API_BASE_URL = (env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const IDEMPOTENCY_PREFIX = "benzo.idempotency.wallet.v1:";
const SIWE_ADDRESS_KEY = "benzo.siweAddress";
const READ_TIMEOUT_MS = 15_000;

export const AUTH_REQUIRED_EVENT = "benzo:auth-required";
export const AUTH_CHANGED_EVENT = "benzo:auth-changed";

export function apiHref(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export function clearHostedAuthState(): void {
  localStorage.removeItem(SIWE_ADDRESS_KEY);
  localStorage.removeItem("benzo.onboarded");
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function notifyAuthRequired(): void {
  clearHostedAuthState();
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

export function authHeaders(): Record<string, string> {
  return {};
}

export function currentGoogleCredential(): string | null {
  return localStorage.getItem(SIWE_ADDRESS_KEY);
}

export function storeGoogleCredential(address: string): void {
  if (isAddress(address, { strict: false })) {
    localStorage.setItem(SIWE_ADDRESS_KEY, getAddress(address).toLowerCase());
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export function clearGoogleCredential(): void {
  localStorage.removeItem(SIWE_ADDRESS_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function credentialLooksWellFormed(credential = currentGoogleCredential()): boolean {
  return !!credential && isAddress(credential, { strict: false });
}

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (const ch of input) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function randomIdempotencyKey(): string {
  const uuid = crypto.randomUUID?.();
  if (uuid) return `idem_${uuid}`;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `idem_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function idempotencyKey(path: string, init?: RequestInit): { key: string; clear: () => void } | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const body = typeof init?.body === "string" ? init.body : "";
  const storageKey = `${IDEMPOTENCY_PREFIX}${shortHash(`${method}:${path}:${body}`)}`;
  let key = localStorage.getItem(storageKey);
  if (!key) {
    key = randomIdempotencyKey();
    localStorage.setItem(storageKey, key);
  }
  return { key, clear: () => localStorage.removeItem(storageKey) };
}

export function prepareApiRequest(path: string, init?: RequestInit): {
  url: string;
  init: RequestInit;
  clearIdempotency?: () => void;
  authToken: string | null;
} {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const idem = idempotencyKey(path, init);
  if (idem) headers.set("Idempotency-Key", idem.key);
  return {
    url: apiHref(path),
    init: { ...init, credentials: "include", headers },
    clearIdempotency: idem?.clear,
    authToken: currentGoogleCredential(),
  };
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const prepared = prepareApiRequest(path, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const timeoutController = method === "GET" ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const requestInit = timeoutController
    ? { ...prepared.init, signal: timeoutController.signal }
    : prepared.init;
  let res: Response | undefined;
  try {
    if (timeoutController) timeout = setTimeout(() => timeoutController.abort(), READ_TIMEOUT_MS);
    res = await fetch(prepared.url, requestInit);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      if (res.status === 401) {
        // Log only the method, never the path — any path segment can carry a
        // secret (e.g. an invite/claim token) that must not leak into logs.
        console.warn(
          `Benzo API session expired (${method}); the device wallet stays usable offline.`,
        );
        notifyAuthRequired();
      }
      throw new Error(detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("This is taking too long. Please try again.");
    }
    throw e;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (res && res.status < 500) prepared.clearIdempotency?.();
  }
}

function sessionFromUser(user: ApiUser): Session {
  const handle = user.address;
  return {
    profile: { handle, name: `${user.address.slice(0, 6)}…${user.address.slice(-4)}` },
    handle,
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  };
}

function unsupportedWorkflow(_amount = "0"): SettleResult {
  throw new Error("This workflow is waiting for the Avalanche/eERC flow issue.");
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function parseDisplayAmount(amount: string): bigint {
  try {
    return usdcToStroops(amount);
  } catch (e) {
    const message = (e as Error).message;
    throw new Error(message.startsWith("USDC has at most") ? message : INVALID_USDC_AMOUNT_ERROR);
  }
}

function makeLocalSettleResult(args: {
  amount: bigint;
  onChain: boolean;
  prover: ProverKind;
  provingMs?: number;
  status?: SettleResult["status"];
  txHash?: string;
}): SettleResult {
  return {
    amount: args.amount.toString(),
    onChain: args.onChain,
    prover: args.prover,
    provingMs: args.provingMs,
    status: args.status ?? "settled",
    txHash: args.txHash,
  };
}

async function localPublicBalance(): Promise<string> {
  const { readPublicBalanceClientSide } = await import("./benzoClient");
  return (await readPublicBalanceClientSide()) ?? "0";
}

async function localWalletAddress(): Promise<Address | null> {
  const { getLocalAccountSummary } = await import("./localWallet");
  return (getLocalAccountSummary()?.address ?? null) as Address | null;
}

async function shieldAmountFromInput(amount: string): Promise<bigint> {
  const requested = parseDisplayAmount(amount);
  if (requested < 0n) throw new Error(INVALID_USDC_AMOUNT_ERROR);
  if (requested > 0n) return requested;
  const available = BigInt(await localPublicBalance());
  if (available > 0n) return available;
  throw new Error("No public USDC is available to make private.");
}

async function shieldClientSide(amount: string, _prover: ProverKind = "local"): Promise<SettleResult> {
  const amountBaseUnits = await shieldAmountFromInput(amount);
  const { shieldPublicUsdcClientSide } = await import("./benzoClient");
  const startedAt = nowMs();
  const result = await shieldPublicUsdcClientSide(
    amountBaseUnits.toString(),
    "Benzo make-private: public deposit amount is visible; resulting eERC balance is encrypted.",
  );
  if (!result?.txHash) throw new Error("Local eERC deposit did not return a transaction hash.");
  const settled = makeLocalSettleResult({
    amount: amountBaseUnits,
    onChain: true,
    prover: "local",
    provingMs: Math.round(nowMs() - startedAt),
    txHash: result.txHash,
  });
  saveLocalHistory({
    id: result.txHash,
    type: "shield",
    name: "Made private",
    note: "Public deposit amount is visible; resulting eERC balance is encrypted.",
    amount: amountBaseUnits.toString(),
    direction: "in",
    status: "settled",
    timestamp: Math.floor(Date.now() / 1000),
    txHash: result.txHash,
  });
  return settled;
}

async function unshieldClientSide(amount: string, _prover: ProverKind = "local"): Promise<SettleResult> {
  const amountBaseUnits = parseDisplayAmount(amount);
  if (amountBaseUnits <= 0n) throw new Error("Enter an amount greater than zero.");
  const { unshieldPrivateUsdcClientSide } = await import("./benzoClient");
  const startedAt = nowMs();
  const result = await unshieldPrivateUsdcClientSide(
    amountBaseUnits.toString(),
    "Benzo make-public: withdraw proof was generated locally.",
  );
  if (!result?.txHash) throw new Error("Local eERC withdraw did not return a transaction hash.");
  const settled = makeLocalSettleResult({
    amount: amountBaseUnits,
    onChain: true,
    prover: "local",
    provingMs: Math.round(nowMs() - startedAt),
    txHash: result.txHash,
  });
  saveLocalHistory({
    id: result.txHash,
    type: "unshield",
    name: "Made public",
    note: "Moved to Public balance",
    amount: amountBaseUnits.toString(),
    direction: "out",
    status: "settled",
    timestamp: Math.floor(Date.now() / 1000),
    txHash: result.txHash,
  });
  return settled;
}

function tokenClaimLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/claim?token=${encodeURIComponent(token)}`;
}

function mapActivity(row: Record<string, unknown>): ActivityRow {
  const txHash = typeof row.txHash === "string" ? row.txHash : undefined;
  const from = typeof row.fromAddr === "string" ? row.fromAddr : "";
  const to = typeof row.toAddr === "string" ? row.toAddr : "";
  const eventName = typeof row.eventName === "string" ? row.eventName : "eERC event";
  const blockTime = typeof row.blockTime === "string" ? Date.parse(row.blockTime) : Date.now();
  return {
    id: txHash ?? `${eventName}-${blockTime}`,
    type: eventName,
    name: to || from || "Encrypted eERC event",
    note: "Encrypted eERC activity. Amount decrypts on your device.",
    amount: "0",
    direction: to ? "in" : "out",
    status: "settled",
    timestamp: Math.floor(blockTime / 1000),
    txHash,
  };
}

export const api = {
  signInWithSiwe: async (
    address: Address,
    signMessage: (message: string) => Promise<Hex>,
  ): Promise<{ user: ApiUser }> => {
    const normalized = getAddress(address);
    const nonce = await http<{ expiresAt: string; nonce: string }>(`/auth/nonce?address=${encodeURIComponent(normalized)}`);
    const apiUrl = API_BASE_URL
      ? new URL(API_BASE_URL, typeof window !== "undefined" ? window.location.origin : "http://localhost")
      : new URL(typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const message = createSiweMessage({
      address: normalized,
      chainId: CHAIN_ID,
      domain: apiUrl.host,
      nonce: nonce.nonce,
      statement: "Sign in to Benzo Wallet.",
      uri: typeof window !== "undefined" ? window.location.origin : apiUrl.origin,
      version: "1",
    });
    const signature = await signMessage(message);
    const result = await http<{ user: ApiUser }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    });
    storeGoogleCredential(normalized);
    return result;
  },
  logout: async () => {
    const result = await http<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" });
    clearGoogleCredential();
    return result;
  },
  authConfig: async () => ({ googleClientId: null, google: false }),
  localVerificationAuth: async (_subject?: string) => {
    throw new Error("Local token auth was replaced by SIWE.");
  },
  deviceAuth: async (_proof: DeviceAuthProof) => {
    throw new Error("Device token auth was replaced by SIWE.");
  },
  googleVerify: async (_credential: string, _nonce?: string) => ({
    verified: false,
    configured: false,
    error: "Google auth was replaced by SIWE.",
  }),
  session: async () => {
    const { user } = await http<{ user: ApiUser }>("/auth/me");
    return sessionFromUser(user);
  },
  recoveryStatus: async (): Promise<RecoveryStatus> => ({
    status: "ok",
    recovery: {
      bound: false,
      status: "unbound",
      custody: "non-custodial",
      nextSteps: ["Your wallet is secured by this device backup."],
    },
  }),
  deleteAccount: async (): Promise<DeleteAccountResult> => {
    await api.logout();
    return { deleted: true };
  },
  balance: async () => ({ stroops: "0", live: false, source: "chain" as const }),
  rampReserve: async () => ({ reserve: null, live: false }),
  depositInfo: async () => {
    const [address, liquid] = await Promise.all([localWalletAddress(), localPublicBalance()]);
    return { address, liquid, asset: "USDC", issuer: "", live: !!address };
  },
  importDeposit: async (amount = "0", prover: ProverKind = "local") => shieldClientSide(amount, prover),
  publicBalance: async () => {
    const [address, stroops] = await Promise.all([localWalletAddress(), localPublicBalance()]);
    return { stroops, address: address ?? "", asset: "USDC", issuer: "", live: !!address };
  },
  makePublic: async (amount: string, prover: ProverKind = "local") => unshieldClientSide(amount, prover),
  sendPublic: async (_to: string, amount: string) => ({
    txHash: undefined,
    onChain: false,
    amount,
    status: "failed" as const,
    prover: "local" as const,
  }),
  history: async () => {
    const result = await http<{ activity: Array<Record<string, unknown>>; nextCursor: string | null }>("/activity");
    return result.activity.map(mapActivity);
  },
  proofReceipts: async () => [] as ProofReceipt[],
  contacts: async () => {
    const result = await http<{
      contacts: Array<{ address: string; alias: string | null; favorite: boolean; handle: string | null }>;
    }>("/contacts");
    return result.contacts.map((row) => ({
      handle: row.handle ? `@${row.handle}` : row.address,
      name: row.alias ?? row.handle ?? `${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
    }));
  },
  send: async (_to: string, amount: string, _memo?: string, _prover: ProverKind = "local", _requestId?: string) =>
    unsupportedWorkflow(amount),
  sendStream: async (
    args: { to: string; amount: string; memo?: string; prover?: ProverKind; requestId?: string },
    onPhase: (e: SendPhaseEvent) => void,
  ): Promise<SettleResult> => {
    onPhase({ phase: "failed", error: "Private sends are handled by the local eERC client." });
    return unsupportedWorkflow(args.amount);
  },
  // OPTIONAL fast-path / display-metadata cache only. HandleRegistry on Fuji is
  // the source of truth (see lib/handleRegistry.ts); never gate a send on this.
  resolveHandle: async (handle: string) => {
    const normalized = normalizeHandle(handle);
    return http<{ address: Address; registeredOnEerc: boolean; source: string }>(`/resolve/${encodeURIComponent(normalized)}`);
  },
  // Availability reads the on-chain registry, not the BFF.
  handleAvailable: (h: string) => handleAvailableOnChain(h),
  // OPTIONAL backend augment (indexing / off-chain metadata). The authoritative
  // registration is the client-side on-chain claim in lib/handleRegistry.ts
  // (claimHandleOnChain), exposed via benzoClient.claimHandleClientSide, so
  // ownerOf(handle) == the user's own address rather than the ops key.
  claimHandle: async (handle: string) =>
    http<{ handle: string; address: Address; registeredOnEerc: boolean; source: string }>("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: normalizeHandle(handle) }),
    }).then((result) => ({ handle: `@${result.handle}`, txHash: undefined, onChain: result.registeredOnEerc })),
  request: async (_amount?: string, _memo?: string) => ({ link: "", id: "" }),
  requestStatus: async (id: string) => ({ id, status: "missing" as const, onChain: false }),
  reconcileRequest: async (id: string) => ({ id, status: "missing" as const, onChain: false, reconciled: false }),
  cancelRequest: async (id: string) => ({ id, status: "cancelled" as const, onChain: false }),
  invite: async (amount: string, note?: string): Promise<InviteResult> => {
    const result = await http<{
      invite: { expiresAt: string; id: string; kind: "invite" | "gift"; note: string | null; status: string };
      token: string;
    }>("/invites", {
      method: "POST",
      body: JSON.stringify({ giftAmount: amount, kind: "gift", note: note ?? null }),
    });
    const expiresAt = Date.parse(result.invite.expiresAt);
    return {
      amount,
      claimAccountPub: "",
      expiresAt,
      link: tokenClaimLink(result.token),
      localId: result.invite.id,
      onChain: false,
    };
  },
  invites: async () => [] as InviteSummary[],
  refundInvite: async (localId: string) => ({ amount: "0", onChain: false, txHash: localId }),
  claimStatus: async (secret: string, _amount?: string, _expiresAt?: string) => {
    const result = await http<{ invite: { expiresAt: string; status: string } }>(`/invites/${encodeURIComponent(secret)}`);
    const status = result.invite.status === "created" ? "open" : result.invite.status;
    return {
      status: status as ClaimStatus["status"],
      expiresAt: Date.parse(result.invite.expiresAt),
      onChain: false,
    };
  },
  claim: async (secret: string, _localId?: string, amount = "0") => {
    await http(`/invites/${encodeURIComponent(secret)}/claim`, { method: "POST", body: "{}" });
    return { amount, onChain: false };
  },
  cashOut: async (amount: string, prover: ProverKind = "local") => unshieldClientSide(amount, prover),
  addMoney: async (amount: string, prover: ProverKind = "local") => shieldClientSide(amount, prover),
  shareProof: async (_min: string, _prover: ProverKind = "local") => ({
    holds: false,
    proof: "",
    publics: [],
    onChain: false,
    prover: "local" as const,
  }),
};
