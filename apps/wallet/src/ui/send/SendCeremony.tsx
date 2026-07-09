/**
 * The send ceremony (S0) — the flagship full-viewport coin-flight. A full-screen
 * overlay driven by the shared payment state machine (@benzo/ui): one continuous
 * coin materializes and scrambles into cipher inside a closing lock ring
 * (encrypt), flies edge-to-edge across the screen (settle), then lands into a
 * verifiable receipt (verify). The coin is a SINGLE persistent element carrying a
 * shared `layoutId`, so it physically travels between phases instead of an
 * AnimatePresence swap teleporting a fresh element in each time.
 *
 * The animation is a slave to the machine — never a timer — so it tells the truth
 * about proving/settlement. The one exception is the per-phase FLOOR: a fast local
 * proof can jump submitting→confirmed in a blink, so each phase is held on screen
 * for at least SEND_PHASE_FLOOR_MS before advancing (walked one step at a time),
 * so the settle flight never flashes past. Collapses to a calm, static labeled
 * step list under prefers-reduced-motion.
 *
 * The coin is deliberately a literal coin/token, but the metaphor is swappable:
 * change only <CoinBody> (e.g. to an encrypted packet / shard of light) and the
 * flight choreography is untouched.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, ShieldCheck, X } from "lucide-react";
import { sendCeremonyView, SEND_RAIL_LABELS, SEND_PHASE_FLOOR_MS, type CeremonyPhase } from "@benzo/ui/send-sequence";
import { type PaymentPhase, type PaymentState } from "@benzo/ui/payment-state";
import { EASE } from "../motion";
import { Button, SuccessCheck } from "../primitives";
import { copyTextToClipboard } from "../../lib/clipboard";
import { fmtUsd } from "../../lib/format";
import { explorerTx } from "../OnChainDetails";

export interface SendReceipt {
  amount: string; // USDC base units
  recipient: string; // @handle or display name
  memo?: string;
  txHash?: string;
  onChain: boolean;
  provingMs?: number;
  prover: "local";
}

/** Network-aware tx explorer URL. Re-exported from the single source (OnChainDetails)
 *  so a mainnet build never deep-links the testnet explorer (was hardcoded "testnet"). */
export const explorerTxUrl = explorerTx;

// The cinematic phases in order + the 3-step rail index each maps to.
const PHASE_ORDER = ["encrypt", "settle", "verify"] as const;
const PHASE_STEP: Record<CeremonyPhase, number> = { encrypt: 0, settle: 1, verify: 2, error: -1 };
// Map a displayed cinematic phase back to a payment phase so the tested
// `sendCeremonyView` projection supplies honest title/sub copy for whatever is
// actually on screen (not what the machine has already raced ahead to).
const PHASE_TO_PAYMENT: Record<CeremonyPhase, PaymentPhase> = {
  encrypt: "proving",
  settle: "submitting",
  verify: "confirmed",
  error: "failed",
};

export function SendCeremony({
  state,
  receipt,
  onDone,
  onRetry,
}: {
  state: PaymentState;
  receipt: SendReceipt;
  onDone: () => void;
  onRetry: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const target = sendCeremonyView(state, { prover: receipt.prover, reducedMotion: reduce }).phase;
  const { phase, step } = useFlooredCeremonyPhase(target, reduce);

  // Honest copy for whatever phase is actually on screen (respects the floor hold).
  const shown = sendCeremonyView({ ...state, phase: PHASE_TO_PAYMENT[phase] }, { prover: receipt.prover, reducedMotion: reduce });

  if (state.phase === "idle") return null;

  const failed = phase === "error";
  const done = phase === "verify";

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-canvas px-8 pb-10 pt-14 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid="send-overlay"
    >
      <PhaseRail step={failed ? step : PHASE_STEP[phase]} failed={failed} reduce={reduce} />

      {/* The coin-flight stage — full-bleed so the coin can travel edge-to-edge. */}
      <div className="relative flex w-full flex-1 items-center justify-center">
        <CoinField phase={phase} reduce={reduce} />
        <AnimatePresence>
          {done ? (
            <motion.div
              key="verify"
              className="relative z-10"
              initial={reduce ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : 0.25 }}
            >
              <VerifyReveal receipt={receipt} reduce={reduce} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="relative z-10 w-full">
        <div className="mb-6">
          <div className="font-display text-2xl" data-testid="ceremony-title">
            {shown.title}
          </div>
          <div className="mt-1 text-sm text-muted" data-testid="ceremony-sub">
            {shown.sub}
          </div>
        </div>

        {done ? (
          <Button full size="lg" onClick={onDone} data-testid="ceremony-done">
            Done
          </Button>
        ) : failed ? (
          <Button full size="lg" variant="secondary" onClick={onRetry} data-testid="ceremony-retry">
            Try again
          </Button>
        ) : (
          <SlowReassurance phase={phase} onEscape={onRetry} />
        )}
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------- floor-gated phase
/**
 * Drive the on-screen cinematic phase off the machine, but never faster than the
 * per-phase floor. We walk PHASE_ORDER one step at a time and hold each step for
 * SEND_PHASE_FLOOR_MS before advancing — so even an instant submitting→confirmed
 * still plays the full settle flight. Failures interrupt immediately (no floor),
 * and reduced-motion snaps straight to the real phase (nothing cinematic to hold).
 */
function useFlooredCeremonyPhase(target: CeremonyPhase, reduce: boolean): { phase: CeremonyPhase; step: number } {
  const [phase, setPhase] = useState<CeremonyPhase>(target);
  const enteredAt = useRef(now());
  const lastStep = useRef(PHASE_STEP[target] < 0 ? 0 : PHASE_STEP[target]);

  useEffect(() => {
    if (target === "error") {
      setPhase("error");
      return;
    }
    if (reduce || phase === "error") {
      if (phase !== target) {
        setPhase(target);
        enteredAt.current = now();
      }
      return;
    }
    const di = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
    const ti = PHASE_ORDER.indexOf(target as (typeof PHASE_ORDER)[number]);
    if (di < 0 || di >= ti) return; // already caught up

    const floor = SEND_PHASE_FLOOR_MS[phase as Exclude<CeremonyPhase, "error">] ?? 0;
    const wait = Math.max(0, floor - (now() - enteredAt.current));
    const id = setTimeout(() => {
      setPhase(PHASE_ORDER[di + 1]);
      enteredAt.current = now();
    }, wait);
    return () => clearTimeout(id);
  }, [target, phase, reduce]);

  if (phase !== "error") lastStep.current = PHASE_STEP[phase];
  return { phase, step: lastStep.current };
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ----------------------------------------------------------------- rail
function PhaseRail({ step, failed, reduce }: { step: number; failed: boolean; reduce: boolean }) {
  return (
    <div className="flex w-full max-w-[280px] items-center gap-2" aria-hidden={!reduce}>
      {SEND_RAIL_LABELS.map((label, i) => {
        const active = step >= 0 && i <= step;
        const isCurrent = i === step && !failed;
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
              <motion.div
                className={`absolute inset-y-0 left-0 rounded-full ${failed && isCurrent ? "bg-danger" : "bg-accent"}`}
                initial={false}
                animate={{ width: active || (failed && i <= Math.max(step, 0)) ? "100%" : "0%" }}
                transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
              />
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${active ? "text-accent" : "text-muted/60"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------- the one continuous coin
const GLYPHS = "0123456789abcdef∎▚▞◆◈⬡".split("");

/** Coin position/scale per phase. The coin never unmounts between encrypt→settle
 *  →verify, so it travels; here we just retarget it. Flight distance is measured
 *  from the stage so it reaches edge-to-edge on any frame width. */
function coinFlight(phase: CeremonyPhase, reduce: boolean, flightX: number) {
  if (reduce) {
    return {
      animate: { x: 0, y: 0, scale: 1, opacity: phase === "verify" || phase === "error" ? 0 : 1 },
      transition: { duration: 0 },
    };
  }
  switch (phase) {
    case "encrypt":
      return {
        animate: { x: 0, y: 0, scale: [1, 1.05, 1], opacity: 1 },
        transition: { duration: 1.8, ease: "easeInOut" as const, repeat: Number.POSITIVE_INFINITY },
      };
    case "settle":
      return {
        animate: { x: [0, flightX * 0.55, flightX], y: [0, -46, 0], scale: [1, 0.96, 0.82], opacity: [1, 1, 0.9] },
        // Tie the flight to the settle floor so the coin visibly crosses the screen.
        transition: { duration: SEND_PHASE_FLOOR_MS.settle / 1000, ease: EASE },
      };
    case "verify":
      return { animate: { x: 0, y: 0, scale: 0.4, opacity: 0 }, transition: { duration: 0.45, ease: EASE } };
    default:
      return { animate: { opacity: 0, scale: 0.8 }, transition: { duration: 0.2 } };
  }
}

function CoinField({ phase, reduce }: { phase: CeremonyPhase; reduce: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [flightX, setFlightX] = useState(160);
  useEffect(() => {
    const measure = () => {
      const w = stageRef.current?.offsetWidth ?? 0;
      if (w > 0) setFlightX(Math.min(Math.max(w * 0.42, 120), 280));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const cipher = useCipherScramble(phase === "encrypt" && !reduce);
  const flight = coinFlight(phase, reduce, flightX);

  return (
    <div ref={stageRef} className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Full-bleed encrypt aura — expanding rings that fill the screen while proving. */}
      {phase === "encrypt" && !reduce ? <EncryptAura /> : null}

      {/* Failure mark replaces the coin. */}
      {phase === "error" ? (
        <motion.div
          className="flex h-20 w-20 items-center justify-center rounded-full bg-danger/12 text-danger"
          initial={reduce ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <X size={34} />
        </motion.div>
      ) : (
        <motion.div
          layoutId="send-coin"
          data-testid="ceremony-coin"
          className="relative flex h-24 w-24 items-center justify-center"
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          {...flight}
        >
          {/* Closing lock ring hugging the coin, only while encrypting. */}
          {phase === "encrypt" ? <LockRing reduce={reduce} /> : null}
          <CoinBody>
            {phase === "encrypt" && !reduce ? (
              <span className="font-display tnum text-xl tracking-tight">{cipher}</span>
            ) : (
              <ShieldCheck size={26} />
            )}
          </CoinBody>
        </motion.div>
      )}
    </div>
  );
}

/** The literal coin. Swap this alone to change the metaphor (packet / shard). */
function CoinBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-accent to-[#9a6bff] text-white shadow-[var(--shadow-glow)]">
      {children}
    </div>
  );
}

function LockRing({ reduce }: { reduce: boolean }) {
  if (reduce) return <div className="absolute -inset-3 rounded-full border-[3px] border-accent/30" />;
  return (
    <motion.svg className="absolute -inset-5" viewBox="0 0 100 100">
      <motion.circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="var(--color-accent, #7342E2)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="289"
        initial={{ strokeDashoffset: 289 }}
        animate={{ strokeDashoffset: [289, 40, 289] }}
        transition={{ duration: 1.8, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
        style={{ transformOrigin: "50% 50%", rotate: -90 }}
      />
    </motion.svg>
  );
}

function EncryptAura() {
  return (
    <>
      {[0, 0.6, 1.2].map((delay) => (
        <motion.span
          key={delay}
          className="absolute rounded-full border border-accent/30"
          style={{ width: 220, height: 220 }}
          initial={{ scale: 0.4, opacity: 0.5 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 1.8, ease: "easeOut", repeat: Number.POSITIVE_INFINITY, delay }}
        />
      ))}
    </>
  );
}

/** Cipher-glyph scramble (~8fps, capped). Active only while encrypting. */
function useCipherScramble(active: boolean): string {
  const [cipher, setCipher] = useState("$");
  useEffect(() => {
    if (!active) {
      setCipher("$");
      return;
    }
    let on = true;
    const id = setInterval(() => {
      if (!on) return;
      setCipher(
        Array.from(
          { length: 3 },
          () => GLYPHS[Math.floor(performance.now() / 73 + Math.random() * GLYPHS.length) % GLYPHS.length],
        ).join(""),
      );
    }, 125);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [active]);
  return cipher;
}

// ----------------------------------------------------------------- verify
function VerifyReveal({ receipt, reduce }: { receipt: SendReceipt; reduce: boolean }) {
  const [showDetails, setShowDetails] = useState(false);
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "To", value: receipt.recipient },
    { label: "Amount", value: fmtUsd(receipt.amount) },
  ];
  if (receipt.memo) rows.push({ label: "Note", value: receipt.memo });

  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-4" data-testid="ceremony-receipt">
      <SuccessCheck size={76} />
      <div className="w-full rounded-2xl bg-card p-4 shadow-[var(--shadow-card)]">
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            className="flex items-center justify-between border-b border-hair/60 py-2 text-sm last:border-0"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.1 + i * 0.07, ease: EASE }}
          >
            <span className="text-muted">{r.label}</span>
            <span className="font-semibold text-ink">{r.value}</span>
          </motion.div>
        ))}
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] font-medium text-pos">
          <ShieldCheck size={13} /> Private payment{receipt.onChain ? "" : " · not verified on-chain"}
        </div>
        <div className="mt-2 flex flex-col items-center">
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink"
            data-testid="receipt-details-toggle"
          >
            {showDetails ? "Hide details" : "Receipt details"}
            <ChevronDown size={13} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {showDetails ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                className="mt-2 flex flex-wrap items-center justify-center gap-2"
              >
                {typeof receipt.provingMs === "number" ? (
                  <span className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-muted">Proved in {(receipt.provingMs / 1000).toFixed(1)}s</span>
                ) : null}
                {receipt.txHash && receipt.onChain ? (
                  <a
                    href={explorerTxUrl(receipt.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-ink/10"
                    data-testid="receipt-explorer"
                  >
                    <ExternalLink size={12} /> View receipt
                  </a>
                ) : null}
                {receipt.txHash ? <CopyChip text={receipt.txHash} /> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <p className="text-[12px] text-muted">Only you and {receipt.recipient} can see this.</p>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void copyTextToClipboard(text).then(setCopied);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-ink/10"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Reference"}
    </button>
  );
}

// ----------------------------------------------------------------- slow reassurance
// Three honest stages: quiet (no message), reassurance (~6-8s), and a hard ceiling
// (~90s) that offers a safe escape WITHOUT claiming failure - the submit→poll loop
// can legitimately run long, but the user should never be stranded forever.
const STALL_CEILING_MS = 90_000;
function SlowReassurance({ phase, onEscape }: { phase: CeremonyPhase; onEscape: () => void }) {
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setSlow(false);
    setStalled(false);
    const slowId = setTimeout(() => setSlow(true), phase === "encrypt" ? 6000 : 8000);
    const stallId = setTimeout(() => setStalled(true), STALL_CEILING_MS);
    return () => {
      clearTimeout(slowId);
      clearTimeout(stallId);
    };
  }, [phase]);
  if (stalled) {
    return (
      <div className="flex flex-col items-center gap-2 px-4" data-testid="ceremony-stalled">
        <p className="text-[13px] text-muted">Taking longer than usual. The network may be busy - your money hasn't moved yet.</p>
        <button onClick={onEscape} className="text-[13px] font-semibold text-accent" data-testid="ceremony-stalled-retry">
          Start over
        </button>
      </div>
    );
  }
  if (!slow) return <div className="h-[52px]" />;
  return (
    <p className="px-4 text-[13px] text-muted">
      {phase === "encrypt" ? "Strong proofs take a few seconds. Your money hasn't moved yet." : "Waiting for the ledger to close…"}
    </p>
  );
}
