/**
 * The in-memory demo store — the single source of truth for the seeded balance
 * and activity feed while DEMO MODE is on. It is a tiny reactive singleton (a
 * subscribe/notify emitter) so a scripted send can decrement the balance and
 * prepend a row, and the wallet UI re-renders. Lazily initialized on first read
 * so importing this module has no side effects in a normal build.
 */
import type { ActivityRow, Balance, Session } from "../lib/api";
import type { PublicBalance } from "../lib/store";
import { getDemoAccountSummary } from "./account";
import {
  buildSeedHistory,
  DEMO_PRIVATE_BASE_UNITS,
  DEMO_PUBLIC_BASE_UNITS,
  DEMO_SESSION,
  seedContactsIntoLocalStorage,
} from "./seed";

export interface DemoSnapshot {
  session: Session;
  balance: Balance;
  publicBalance: PublicBalance;
  history: ActivityRow[];
}

let snapshot: DemoSnapshot | null = null;
const listeners = new Set<() => void>();

function ensure(): DemoSnapshot {
  if (!snapshot) {
    seedContactsIntoLocalStorage();
    snapshot = {
      session: DEMO_SESSION,
      balance: { baseUnits: DEMO_PRIVATE_BASE_UNITS, live: true, source: "chain" },
      publicBalance: {
        baseUnits: DEMO_PUBLIC_BASE_UNITS,
        address: getDemoAccountSummary().address,
        asset: "USDC",
        issuer: "",
        live: true,
      },
      history: buildSeedHistory(),
    };
  }
  return snapshot;
}

export function getDemoSnapshot(): DemoSnapshot {
  return ensure();
}

export function subscribeDemo(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Settle a scripted send: decrement the private balance, prepend an activity row. */
export function applyDemoSend(opts: {
  to: string;
  name: string;
  amountBaseUnits: string;
  memo?: string;
  txHash: string;
}): void {
  const s = ensure();
  const current = BigInt(s.balance.baseUnits || "0");
  const amount = BigInt(opts.amountBaseUnits || "0");
  const next = current > amount ? current - amount : 0n;
  s.balance = { ...s.balance, baseUnits: next.toString() };
  const row: ActivityRow = {
    id: opts.txHash,
    type: "send",
    name: opts.name,
    note: opts.memo || "",
    amount: opts.amountBaseUnits,
    direction: "out",
    status: "settled",
    timestamp: Math.floor(Date.now() / 1000),
    txHash: opts.txHash,
    tone: "accent",
  };
  s.history = [row, ...s.history.filter((r) => r.id !== row.id)];
  notify();
}
