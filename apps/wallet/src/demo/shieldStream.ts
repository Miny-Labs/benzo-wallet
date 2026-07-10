import type { Dispatch } from "react";
import type { PaymentEvent } from "@benzo/ui/payment-state";
import type { SettleResult } from "../lib/api";
import type { ShieldMode } from "../lib/useShieldStream";
import { usdcToBaseUnits } from "../lib/format";
import { applyDemoShield } from "./state";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeTxHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function demoRunShield(
  mode: ShieldMode,
  amount: string,
  memo: string | undefined,
  dispatch: Dispatch<PaymentEvent>,
  setReceipt: (receipt: SettleResult | null) => void,
): Promise<SettleResult | null> {
  const baseUnits = usdcToBaseUnits(amount).toString();

  dispatch({ type: "RESET" });
  setReceipt(null);

  dispatch({ type: "START" });
  await delay(650);

  dispatch({ type: "WITNESS_READY" });
  const provingMs = mode === "shield" ? 1600 : 1900;
  await delay(provingMs);

  dispatch({ type: "PROOF_READY", provingMs });
  const txHash = fakeTxHash();
  dispatch({ type: "SUBMITTED", txHash });
  await delay(900);

  const receipt: SettleResult = {
    status: "settled",
    txHash,
    prover: "local",
    amount: baseUnits,
    onChain: true,
    provingMs,
  };
  applyDemoShield({ mode, amountBaseUnits: baseUnits, memo, txHash });
  setReceipt(receipt);
  dispatch({ type: "CONFIRMED" });

  return receipt;
}
