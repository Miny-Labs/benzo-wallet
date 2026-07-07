import { usdcToStroops } from "./format";

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

export function validateFundedInviteAmount(amount: string, privateBalanceStroops?: string | null): {
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
  const insufficient = BigInt(amountStroops) > parseStroops(privateBalanceStroops);
  return {
    amountOk,
    amountStroops,
    insufficient,
    message: insufficient ? "Not enough private USDC. Add money or use a smaller amount." : null,
  };
}
