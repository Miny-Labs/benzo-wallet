import type { EERC } from "@avalabs/eerc-sdk";
import type { BenzoAccount } from "@benzo/core";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ActivityHint, ActivityRow } from "./api";
import { createEerc, getPublicClient } from "./eerc";
import {
  CHAIN_ID,
  EERC_ACTIVITY_LOG_WINDOW_BLOCKS,
  EERC_ACTIVITY_START_BLOCK,
  EERC_USDC_TOKEN_ID,
  ENCRYPTED_ERC_ADDRESS,
  USDC_TOKEN_ADDRESS,
} from "./network";

type EercDecryptor = Pick<EERC, "decryptPCT" | "getHistoricalBalance">;

type EercLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
  eventName?: string;
  logIndex?: number | null;
  transactionHash?: Hex | null;
};

type DecodedCall = ReturnType<typeof decodeFunctionData<typeof encryptedErcActivityAbi>>;
type EercEventName = "PrivateTransfer" | "PrivateMint" | "PrivateBurn" | "Deposit" | "Withdraw";

const ZERO_PCT = [0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
const CACHE_PREFIX = "benzo.eercActivity.v1";
const RESCAN_OVERLAP_BLOCKS = 20n;
const MAX_CACHED_ROWS = 200;

export const encryptedErcActivityAbi = [
  {
    type: "event",
    name: "PrivateTransfer",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "PrivateMint",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "PrivateBurn",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "Deposit",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "dust", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "function",
    name: "tokenIds",
    stateMutability: "view",
    inputs: [{ internalType: "address", name: "tokenAddress", type: "address" }],
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { components: proofComponents("uint256[32]"), internalType: "struct TransferProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { components: proofComponents("uint256[32]"), internalType: "struct TransferProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateMint",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[24]"), internalType: "struct MintProof", name: "proof", type: "tuple" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateMint",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[24]"), internalType: "struct MintProof", name: "proof", type: "tuple" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateBurn",
    stateMutability: "nonpayable",
    inputs: [
      { components: proofComponents("uint256[19]"), internalType: "struct BurnProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateBurn",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[19]"), internalType: "struct BurnProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function proofComponents(publicSignalsType: "uint256[19]" | "uint256[24]" | "uint256[32]") {
  return [
    {
      components: [
        { internalType: "uint256[2]", name: "a", type: "uint256[2]" },
        { internalType: "uint256[2][2]", name: "b", type: "uint256[2][2]" },
        { internalType: "uint256[2]", name: "c", type: "uint256[2]" },
      ],
      internalType: "struct ProofPoints",
      name: "proofPoints",
      type: "tuple",
    },
    { internalType: publicSignalsType, name: "publicSignals", type: publicSignalsType },
  ] as const;
}

const EVENT_BY_NAME = new Map(
  encryptedErcActivityAbi
    .filter((item) => item.type === "event")
    .map((item) => [item.name, item]),
);

export interface ReadEercActivityOptions {
  client?: PublicClient;
  eerc?: EercDecryptor;
  hints?: ActivityHint[];
}

export async function readEercActivityClientSide(
  account: BenzoAccount,
  options: ReadEercActivityOptions = {},
): Promise<ActivityRow[]> {
  if (!ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return [];
  const eerc = options.eerc ?? (await createEerc(account));
  if (!eerc) return [];

  const client = options.client ?? getPublicClient();
  const [latestBlock, usdcTokenId] = await Promise.all([
    client.getBlockNumber(),
    readUsdcTokenId(client),
  ]);
  const cache = loadActivityCache(account.address);
  const fromBlock = scanStartBlock(latestBlock, options.hints ?? [], cache?.scannedTo);
  if (fromBlock > latestBlock) return [];

  const logs = await collectActivityLogs(client, account.address, fromBlock, latestBlock);
  const hintsByTx = hintsByHash(options.hints ?? []);
  const blockTimes = new Map<bigint, number>();
  const rows: ActivityRow[] = [];

  for (const log of uniqueLogs(logs)) {
    const row = await rowFromLog({
      account: account.address,
      blockTimes,
      client,
      eerc,
      hint: log.transactionHash ? hintsByTx.get(log.transactionHash.toLowerCase()) : undefined,
      log,
      usdcTokenId,
    });
    if (row) rows.push(row);
  }

  const merged = mergeActivityRows(cache?.rows ?? [], applyActivityHints(rows, options.hints ?? []));
  saveActivityCache(account.address, latestBlock, merged);
  return merged;
}

export function mergeActivityRows(...groups: ActivityRow[][]): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>();
  for (const group of groups) {
    for (const row of group) {
      const key = activityKey(row);
      const existing = byKey.get(key);
      byKey.set(key, mergeActivityRow(existing, row));
    }
  }
  return [...byKey.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export function applyActivityHints(rows: ActivityRow[], hints: ActivityHint[]): ActivityRow[] {
  if (hints.length === 0) return rows;
  const byTx = hintsByHash(hints);
  return rows.map((row) => {
    const hint = row.txHash ? byTx.get(row.txHash.toLowerCase()) : undefined;
    if (!hint) return row;
    const label = hint.links.find((link) => link.label)?.label;
    return {
      ...row,
      name: label ?? row.name,
      timestamp: hint.timestamp ?? row.timestamp,
    };
  });
}

async function collectActivityLogs(
  client: PublicClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EercLog[]> {
  const address = getAddress(account);
  const all: EercLog[] = [];
  for (const [from, to] of blockWindows(fromBlock, toBlock, EERC_ACTIVITY_LOG_WINDOW_BLOCKS)) {
    const [transferIn, transferOut, deposits, withdraws, mints, burns] = await Promise.all([
      getEventLogs(client, "PrivateTransfer", { to: address }, from, to),
      getEventLogs(client, "PrivateTransfer", { from: address }, from, to),
      getEventLogs(client, "Deposit", { user: address }, from, to),
      getEventLogs(client, "Withdraw", { user: address }, from, to),
      getEventLogs(client, "PrivateMint", { user: address }, from, to),
      getEventLogs(client, "PrivateBurn", { user: address }, from, to),
    ]);
    all.push(...transferIn, ...transferOut, ...deposits, ...withdraws, ...mints, ...burns);
  }
  return all;
}

async function getEventLogs(
  client: PublicClient,
  eventName: EercEventName,
  args: Record<string, Address>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EercLog[]> {
  const event = EVENT_BY_NAME.get(eventName);
  if (!event || !ENCRYPTED_ERC_ADDRESS) return [];
  return client.getLogs({
    address: ENCRYPTED_ERC_ADDRESS,
    args,
    event,
    fromBlock,
    toBlock,
  } as never) as Promise<EercLog[]>;
}

async function rowFromLog(input: {
  account: Address;
  blockTimes: Map<bigint, number>;
  client: PublicClient;
  eerc: EercDecryptor;
  hint?: ActivityHint;
  log: EercLog;
  usdcTokenId: bigint;
}): Promise<ActivityRow | null> {
  const txHash = input.log.transactionHash ?? input.hint?.txHash;
  const blockNumber = input.log.blockNumber ?? input.hint?.blockNumber;
  if (!txHash || blockNumber == null) return null;

  const eventName = input.log.eventName ?? input.hint?.eventName;
  const timestamp =
    input.hint?.timestamp ?? (await blockTimestamp(input.client, input.blockTimes, blockNumber));

  switch (eventName) {
    case "PrivateTransfer":
      return privateTransferRow({
        account: input.account,
        blockNumber,
        client: input.client,
        eerc: input.eerc,
        log: input.log,
        timestamp,
        txHash,
        usdcTokenId: input.usdcTokenId,
      });
    case "Deposit":
      return depositRow(input.log, txHash, timestamp, input.usdcTokenId);
    case "Withdraw":
      return withdrawRow(input.log, txHash, timestamp, input.usdcTokenId);
    case "PrivateMint":
      return privateMintRow({
        account: input.account,
        client: input.client,
        eerc: input.eerc,
        log: input.log,
        timestamp,
        txHash,
      });
    case "PrivateBurn":
      return privateBurnRow({
        account: input.account,
        blockNumber,
        client: input.client,
        eerc: input.eerc,
        log: input.log,
        timestamp,
        txHash,
      });
    default:
      return null;
  }
}

async function privateTransferRow(input: {
  account: Address;
  blockNumber: bigint;
  client: PublicClient;
  eerc: EercDecryptor;
  log: EercLog;
  timestamp: number;
  txHash: Hex;
  usdcTokenId: bigint;
}): Promise<ActivityRow | null> {
  const from = addressArg(input.log.args?.from);
  const to = addressArg(input.log.args?.to);
  if (!from || !to) return null;

  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "transfer") return null;

  const args = decoded.args as readonly unknown[];
  const tokenId = bigintArg(args[1]);
  if (tokenId !== input.usdcTokenId) return null;

  const proof = proofArg(args[2]);
  const balancePCT = pctArg(args[3]);
  const account = input.account.toLowerCase();

  if (to.toLowerCase() === account) {
    const amount = input.eerc.decryptPCT(proof.publicSignals.slice(16, 23));
    return {
      id: input.txHash,
      type: "receive",
      name: shortAddress(from),
      note: "Private eERC transfer decrypted on this device.",
      amount: amount.toString(),
      direction: "in",
      status: "settled",
      timestamp: input.timestamp,
      txHash: input.txHash,
    };
  }

  if (from.toLowerCase() === account) {
    const previous = await input.eerc.getHistoricalBalance(
      input.account,
      input.blockNumber > 0n ? input.blockNumber - 1n : 0n,
      USDC_TOKEN_ADDRESS,
    );
    const remaining = input.eerc.decryptPCT(balancePCT);
    const amount = previous >= remaining ? previous - remaining : 0n;
    return {
      id: input.txHash,
      type: "send",
      name: shortAddress(to),
      note: "Private eERC transfer proved locally.",
      amount: amount.toString(),
      direction: "out",
      status: "settled",
      timestamp: input.timestamp,
      txHash: input.txHash,
    };
  }

  return null;
}

function depositRow(log: EercLog, txHash: Hex, timestamp: number, usdcTokenId: bigint): ActivityRow | null {
  const tokenId = bigintArg(log.args?.tokenId);
  if (tokenId !== usdcTokenId) return null;
  const amount = bigintArg(log.args?.amount) - bigintArg(log.args?.dust);
  return {
    id: txHash,
    type: "shield",
    name: "Made private",
    note: "Public deposit amount is visible; resulting eERC balance is encrypted.",
    amount: amount.toString(),
    direction: "in",
    status: "settled",
    timestamp,
    txHash,
  };
}

function withdrawRow(log: EercLog, txHash: Hex, timestamp: number, usdcTokenId: bigint): ActivityRow | null {
  const tokenId = bigintArg(log.args?.tokenId);
  if (tokenId !== usdcTokenId) return null;
  return {
    id: txHash,
    type: "unshield",
    name: "Made public",
    note: "Moved to Public balance",
    amount: bigintArg(log.args?.amount).toString(),
    direction: "out",
    status: "settled",
    timestamp,
    txHash,
  };
}

async function privateMintRow(input: {
  account: Address;
  client: PublicClient;
  eerc: EercDecryptor;
  log: EercLog;
  timestamp: number;
  txHash: Hex;
}): Promise<ActivityRow | null> {
  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "privateMint") return null;
  const proof = proofArg((decoded.args as readonly unknown[])[1]);
  const amount = input.eerc.decryptPCT(proof.publicSignals.slice(8, 15));
  return {
    id: input.txHash,
    type: "receive",
    name: "Private mint",
    note: "Private mint decrypted on this device.",
    amount: amount.toString(),
    direction: "in",
    status: "settled",
    timestamp: input.timestamp,
    txHash: input.txHash,
  };
}

async function privateBurnRow(input: {
  account: Address;
  blockNumber: bigint;
  client: PublicClient;
  eerc: EercDecryptor;
  log: EercLog;
  timestamp: number;
  txHash: Hex;
}): Promise<ActivityRow | null> {
  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "privateBurn") return null;
  const args = decoded.args as readonly unknown[];
  const balancePCT = pctArg(args.length === 2 ? args[1] : args[2]);
  const previous = await input.eerc.getHistoricalBalance(
    input.account,
    input.blockNumber > 0n ? input.blockNumber - 1n : 0n,
    undefined,
  );
  const remaining = input.eerc.decryptPCT(balancePCT);
  const amount = previous >= remaining ? previous - remaining : 0n;
  return {
    id: input.txHash,
    type: "send",
    name: "Private burn",
    note: "Private burn proved locally.",
    amount: amount.toString(),
    direction: "out",
    status: "settled",
    timestamp: input.timestamp,
    txHash: input.txHash,
  };
}

async function decodeTx(client: PublicClient, txHash: Hex): Promise<DecodedCall | null> {
  try {
    const tx = await client.getTransaction({ hash: txHash });
    return decodeFunctionData({ abi: encryptedErcActivityAbi, data: tx.input }) as DecodedCall;
  } catch {
    return null;
  }
}

async function readUsdcTokenId(client: PublicClient): Promise<bigint> {
  if (!ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return EERC_USDC_TOKEN_ID;
  try {
    const tokenId = await client.readContract({
      address: ENCRYPTED_ERC_ADDRESS,
      abi: encryptedErcActivityAbi,
      functionName: "tokenIds",
      args: [USDC_TOKEN_ADDRESS],
    });
    return tokenId && tokenId !== 0n ? tokenId : EERC_USDC_TOKEN_ID;
  } catch {
    return EERC_USDC_TOKEN_ID;
  }
}

async function blockTimestamp(
  client: PublicClient,
  cache: Map<bigint, number>,
  blockNumber: bigint,
): Promise<number> {
  const cached = cache.get(blockNumber);
  if (cached) return cached;
  try {
    const block = await client.getBlock({ blockNumber });
    const timestamp = Number(block.timestamp);
    cache.set(blockNumber, timestamp);
    return timestamp;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

function scanStartBlock(latestBlock: bigint, hints: ActivityHint[], cachedScannedTo?: bigint): bigint {
  const hintedBlocks = hints.flatMap((hint) => (hint.blockNumber == null ? [] : [hint.blockNumber]));
  const hintedStart = hintedBlocks.reduce((min, value) => (value < min ? value : min), latestBlock);
  const incrementalStart = cachedScannedTo == null
    ? EERC_ACTIVITY_START_BLOCK
    : maxBigint(EERC_ACTIVITY_START_BLOCK, cachedScannedTo > RESCAN_OVERLAP_BLOCKS ? cachedScannedTo - RESCAN_OVERLAP_BLOCKS : EERC_ACTIVITY_START_BLOCK);
  return minBigint(incrementalStart, hintedStart);
}

function blockWindows(fromBlock: bigint, toBlock: bigint, windowSize: bigint): Array<[bigint, bigint]> {
  const windows: Array<[bigint, bigint]> = [];
  const size = windowSize > 0n ? windowSize : 10000n;
  for (let from = fromBlock; from <= toBlock; from += size) {
    const to = from + size - 1n > toBlock ? toBlock : from + size - 1n;
    windows.push([from, to]);
  }
  return windows;
}

function uniqueLogs(logs: EercLog[]): EercLog[] {
  const seen = new Set<string>();
  return logs.filter((log) => {
    const key = `${log.transactionHash ?? ""}:${log.logIndex ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activityKey(row: ActivityRow): string {
  return row.txHash?.toLowerCase() ?? row.id;
}

function mergeActivityRow(existing: ActivityRow | undefined, row: ActivityRow): ActivityRow {
  if (!existing) return row;
  return {
    ...existing,
    ...row,
    name: existing.name && existing.type === "send" ? existing.name : row.name,
    note: existing.note || row.note,
    tone: existing.tone ?? row.tone,
  };
}

function hintsByHash(hints: ActivityHint[]): Map<string, ActivityHint> {
  const byTx = new Map<string, ActivityHint>();
  for (const hint of hints) {
    if (hint.txHash) byTx.set(hint.txHash.toLowerCase(), hint);
  }
  return byTx;
}

function minBigint(first: bigint, ...rest: bigint[]): bigint {
  return rest.reduce((min, value) => (value < min ? value : min), first);
}

function maxBigint(first: bigint, ...rest: bigint[]): bigint {
  return rest.reduce((max, value) => (value > max ? value : max), first);
}

function activityCacheKey(address: Address): string | null {
  if (!ENCRYPTED_ERC_ADDRESS) return null;
  return `${CACHE_PREFIX}:${CHAIN_ID}:${ENCRYPTED_ERC_ADDRESS.toLowerCase()}:${address.toLowerCase()}`;
}

function loadActivityCache(address: Address): { rows: ActivityRow[]; scannedTo: bigint } | null {
  if (typeof localStorage === "undefined") return null;
  const key = activityCacheKey(address);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as {
      rows?: ActivityRow[];
      scannedTo?: string;
    } | null;
    if (!parsed?.scannedTo || !Array.isArray(parsed.rows)) return null;
    return { rows: parsed.rows, scannedTo: BigInt(parsed.scannedTo) };
  } catch {
    return null;
  }
}

function saveActivityCache(address: Address, scannedTo: bigint, rows: ActivityRow[]): void {
  if (typeof localStorage === "undefined") return;
  const key = activityCacheKey(address);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        rows: rows.slice(0, MAX_CACHED_ROWS),
        scannedTo: scannedTo.toString(),
      }),
    );
  } catch {
    /* ignore storage quota/private mode */
  }
}

function proofArg(value: unknown): { publicSignals: bigint[] } {
  const signals = (value as { publicSignals?: unknown }).publicSignals;
  return { publicSignals: pctArray(signals, 32) };
}

function pctArg(value: unknown): bigint[] {
  return pctArray(value, 7);
}

function pctArray(value: unknown, minLength: number): bigint[] {
  const items = Array.isArray(value) ? value : ZERO_PCT;
  const out = items.map((item) => bigintArg(item));
  while (out.length < minLength) out.push(0n);
  return out;
}

function bigintArg(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

function addressArg(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
