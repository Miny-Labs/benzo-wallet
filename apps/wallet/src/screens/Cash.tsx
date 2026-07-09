/**
 * Cash - the plain-money surface for shield/unshield. Core conversion is
 * local-first through eERC; fiat/reserve rails are optional online features and
 * are not required for moving between Public and Private balances.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Landmark, Radio, ShieldCheck, Smartphone } from "lucide-react";
import { api, type SettleResult } from "../lib/api";
import { apiProverKind, proverPlan } from "../lib/proverPolicy";
import { useWallet } from "../lib/store";
import { mapError } from "../lib/errors";
import { fmtUsd, usdcToBaseUnits } from "../lib/format";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { AmountField, Button, Segmented } from "../ui/primitives";
import { PrivateChip } from "../ui/privacy";
import { OnChainDetails } from "../ui/OnChainDetails";

const QUICK = ["20", "50", "100", "250"];
type Tab = "in" | "out";
type Phase = "form" | "busy" | "done";

// Per-tx caps for the Cash surface. These guard the local shield/unshield leg;
// online fiat/reserve rails can enforce their own limits when they are wired.
const MIN = 5;
const MAX_IN = 950;
const MAX_OUT = 2500;

const toS = (a: string): string => {
  try {
    const value = usdcToBaseUnits(a);
    return value > 0n ? value.toString() : "0";
  } catch {
    return "0";
  }
};

export function Cash() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useWallet();
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "out" ? "out" : "in");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [err, setErr] = useState<string | null>(null);
  const [onChain, setOnChain] = useState(false);
  const [result, setResult] = useState<SettleResult | null>(null);
  const [reserve, setReserve] = useState<string | null>(null);
  const [reserveErr, setReserveErr] = useState(false);

  // Optional online reserve signal. It is never required for local shield/unshield.
  const loadReserve = () =>
    api
      .rampReserve()
      .then((r) => { if (r?.reserve != null) { setReserve(r.reserve); setReserveErr(false); } })
      .catch(() => setReserveErr((had) => (reserve == null ? true : had)));
  useEffect(() => {
    let live = true;
    const tick = () => { if (live) void loadReserve(); };
    tick();
    const iv = setInterval(() => { if (!document.hidden) tick(); }, 20_000);
    return () => { live = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Local-only proving: ramp proofs use the local Benzo runtime.
  const plan = proverPlan();
  const apiProver = apiProverKind(plan.kind);
  const rampProverReason = plan.onDevice ? plan.reason : "Proof runs on the local Benzo runtime.";

  const n = Number(amount);
  const max = tab === "in" ? MAX_IN : MAX_OUT;
  const tooLow = n > 0 && n < MIN;
  const tooHigh = n > max;
  const valid = n >= MIN && n <= max;

  async function go() {
    if (phase !== "form") return;
    setPhase("busy");
    setErr(null);
    try {
      const r = tab === "in" ? await api.addMoney(amount, apiProver) : await api.cashOut(amount, apiProver);
      setResult(r);
      setOnChain(r.onChain);
      setPhase("done");
      void refresh();
    } catch (e) {
      setErr(mapError(e));
      setPhase("form");
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Cash" />
      <div className="px-5 pt-2">
        <Segmented<Tab>
          items={[{ id: "in", label: "Shield" }, { id: "out", label: "Unshield" }]}
          active={tab}
          onChange={(t) => { setTab(t); setPhase("form"); setErr(null); }}
        />

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, x: tab === "in" ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="mt-5">
              <AmountField value={amount} onChange={setAmount} autoFocus />
              <div className="text-center text-[13px] text-muted">
                {tab === "in"
                  ? "Move Public USDC into your encrypted eERC balance"
                  : "Move Private USDC back to your public wallet balance"}
              </div>
              <div className={`mt-1 text-center text-[12px] ${tooLow || tooHigh ? "text-[#9a6b12]" : "text-muted/70"}`} data-testid="cash-limits">
                {tooLow ? `Minimum is $${MIN}` : tooHigh ? `Max ${tab === "in" ? "shield" : "unshield"} is $${max.toLocaleString()}` : `$${MIN} to $${max.toLocaleString()} per ${tab === "in" ? "shield" : "unshield"}`}
              </div>
            </div>

            <div className="mt-4 flex justify-center gap-2">
              {QUICK.map((q) => (
                <button key={q} onClick={() => setAmount(q)} className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${amount === q ? "border-accent bg-accent/10 text-accent" : "border-hair bg-card text-ink hover:bg-canvas"}`}>
                  ${q}
                </button>
              ))}
            </div>

            {n >= MIN ? (
              <div className="mt-5 space-y-2 rounded-2xl border border-hair bg-card p-4 text-[13px]" data-testid="cash-quote">
                <QRow k="Amount" v={fmtUsd(toS(amount))} />
                <QRow k="Fee" v={<span className="font-semibold text-pos">Free</span>} />
                <QRow k="Move" v={tab === "in" ? "Public USDC to Private" : "Private to Public USDC"} />
                <QRow k="eERC" v={tab === "in" ? "Converter deposit" : "Withdraw proof"} />
                <QRow k="Online rail" v="Optional fiat/reserve feature" />
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-hair bg-card px-3.5 py-2.5 text-[12.5px] text-muted" data-testid="cash-prover-plan">
              <Smartphone size={15} className="flex-none text-accent" />
              <span>{tab === "in" ? "Shield submits from this wallet over RPC. No backend required." : rampProverReason}</span>
            </div>

            <div className="mt-3 rounded-2xl border border-hair bg-card px-3.5 py-2.5 text-[12.5px] text-muted" data-testid="cash-online-note">
              Fiat add-money and cash-out are optional online features. This button only moves funds between your own Public and Private balances.
            </div>

            <div className="mt-6 flex justify-center">
              <PrivateChip label={tab === "in" ? "Edge public; balance encrypted" : "Withdraw proof hides remaining balance"} />
            </div>

            <Button full size="lg" className="mt-4" disabled={!valid || phase !== "form"} loading={phase === "busy"} onClick={go} data-testid={tab === "in" ? "add-submit" : "cashout-submit"}>
              <span className="truncate">{tab === "in" ? "Make private" : "Make public"}{valid ? ` · ${fmtUsd(toS(amount))}` : ""}</span>
            </Button>
            {tab === "in" ? (
              <button onClick={() => nav("/deposit")} className="mt-3 w-full rounded-lg py-1 text-center text-[13px] font-semibold text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="cash-deposit-link">
                Already have USDC? Deposit from another wallet →
              </button>
            ) : null}
            {err ? <div className="mt-2 text-center text-sm text-danger" data-testid="cash-error">{err}</div> : null}
          </motion.div>
        </AnimatePresence>

        {/* Optional online rail status. This never gates local shield/unshield. */}
        <ReserveBadge reserve={reserve} error={reserveErr} onRetry={() => { setReserveErr(false); void loadReserve(); }} />
      </div>

      <AnimatePresence>
        {phase === "done" ? <RampDone tab={tab} amount={toS(amount)} onChain={onChain} result={result} onDone={() => setPhase("form")} /> : null}
      </AnimatePresence>
    </Screen>
  );
}

/** Optional online reserve chip. It never gates local shield/unshield. */
function ReserveBadge({ reserve, error, onRetry }: { reserve: string | null; error: boolean; onRetry: () => void }) {
  if (error && reserve == null) {
    return (
      <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-hair bg-card px-4 py-2.5" data-testid="reserve-badge">
        <span className="h-2 w-2 flex-none rounded-full bg-muted/50" />
        <div className="flex-1 text-[12px] text-muted">Online fiat/reserve feature unavailable. Shield and unshield still work.</div>
        <button onClick={onRetry} className="flex-none text-[12px] font-semibold text-accent" data-testid="reserve-retry">Retry</button>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-hair bg-gradient-to-br from-accent/[0.07] to-transparent px-4 py-2.5" data-testid="reserve-badge" title="Optional online fiat/reserve leg.">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pos opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-pos" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="tnum truncate text-xs font-semibold text-ink">Optional online fiat/reserve leg {reserve != null ? `· ${fmtUsd(reserve)}` : ""}</div>
        <div className="text-[11px] text-muted">Core shield/unshield uses your device and Fuji RPC</div>
      </div>
      <Radio size={15} className="flex-none text-accent" />
    </div>
  );
}

/** The crafted done overlay - plays the REAL journey, step by step. */
function RampDone({ tab, amount, onChain, result, onDone }: { tab: Tab; amount: string; onChain: boolean; result: SettleResult | null; onDone: () => void }) {
  const steps = tab === "in"
    ? ["Public USDC approved", "Deposited into encrypted eERC balance", "Private balance updated"]
    : ["Withdraw proof created locally", "eERC withdraw submitted", "Public balance updated"];
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const timers = steps.map((_, i) => setTimeout(() => setLit(i + 1), 420 * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-canvas px-8 text-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="cash-overlay"
    >
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 16 }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-pos/12 text-pos">
        <Landmark size={30} />
      </motion.div>
      <div>
        <div className="font-display text-2xl">{tab === "in" ? "Made private" : "Made public"}</div>
        <div className="mt-1 text-[15px] text-muted">{fmtUsd(amount)}{onChain ? "" : " · not verified on-chain"}</div>
      </div>

      <div className="w-full max-w-[280px] space-y-2.5 text-left">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-3" data-testid="cash-step">
            <motion.div
              animate={{ backgroundColor: i < lit ? "var(--color-pos, #16a34a)" : "rgba(0,0,0,0.06)", scale: i < lit ? 1 : 0.9 }}
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-white"
            >
              {i < lit ? <Check size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-muted" />}
            </motion.div>
            <span className={`text-[13.5px] transition-colors ${i < lit ? "text-ink" : "text-muted"}`}>{s}</span>
          </div>
        ))}
      </div>

      {onChain ? (
        <div className="flex items-center gap-1.5 text-[12px] text-pos" data-testid="cash-proof">
          <ShieldCheck size={13} /> {tab === "in" ? "USDC moved into encrypted eERC balance" : "Withdraw proof verified on Avalanche testnet"}
        </div>
      ) : null}
      <div className="w-full max-w-[320px]">
        <OnChainDetails txHash={result?.txHash} prover={result?.prover} provingMs={result?.provingMs} onChain={onChain} kind={tab === "in" ? "shield" : "unshield"} />
      </div>
      <Button className="mt-1" onClick={onDone}>Done</Button>
    </motion.div>
  );
}

function QRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}
