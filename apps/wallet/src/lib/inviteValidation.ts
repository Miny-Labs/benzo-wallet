import { usdcToStroops } from "./format";
import { INSUFFICIENT_PUBLIC_USDC_ERROR } from "./errors";

export function inviteAmountToStroops(amount: string): string {
  try {
    const value = usdcToStroops(amount);
    return value > 0n ? value.toString() : "0";
  } catch {
    return "0";
  }
}

function parseStroops(value?: string | null): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

// A gift/invite escrows PUBLIC USDC on-chain, so this validates against the
// public balance and points an under-funded user at the public top-up flow.
export function validateFundedInviteAmount(amount: string, publicBalanceStroops?: string | null): {
  amountOk: boolean;
  amountStroops: string;
  insufficient: boolean;
  message: string | null;
} {
  const raw = amount.trim();
  const n = Number(raw);
  const amountOk = raw.length > 0 && Number.isFinite(n) && n > 0;
  const amountStroops = inviteAmountToStroops(raw);
  if (!amountOk) {
    return {
      amountOk: false,
      amountStroops,
      insufficient: false,
      message: raw.length > 0 ? "Enter an amount above $0." : null,
    };
  }
  const insufficient = BigInt(amountStroops) > parseStroops(publicBalanceStroops);
  return {
    amountOk,
    amountStroops,
    insufficient,
    message: insufficient ? INSUFFICIENT_PUBLIC_USDC_ERROR : null,
  };
}
