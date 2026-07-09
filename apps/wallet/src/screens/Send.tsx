import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, AtSign, Send as SendIcon, ShieldCheck, Smartphone, UserPlus } from "lucide-react";
import type { ProverKind } from "../lib/api";
import { proverPlan } from "../lib/proverPolicy";
import { useSendStream } from "../lib/useSendStream";
import { shouldLockOnSend, requireUnlock } from "../lib/lock";
import { mergeContacts } from "../lib/contacts";
import { needsStepUp, stepUpMessage, sendCapUsd } from "../lib/tiers";
import { useWallet } from "../lib/store";
import { fmtUsd, USDC_BASE_UNITS, usdcToBaseUnits } from "../lib/format";
import { isValidEvmAddress, shortAddress } from "../lib/address";
import { isRegisteredOnEerc } from "../lib/handleRegistry";
import { classifyRecipientInput, looksLikeEvmAddressInput, type RecipientKind } from "../lib/recipient";
import { Screen, motion } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { AmountField, Avatar, Button, Input } from "../ui/primitives";
import { PrivateChip } from "../ui/privacy";
import { SendCeremony, type SendReceipt } from "../ui/send/SendCeremony";
import { INSUFFICIENT_PRIVATE_USDC_ERROR } from "../lib/errors";

type Step = "form" | "confirm";
type Kind = RecipientKind;

const INVALID_AMOUNT = "Enter an amount above $0.";

function parsePositiveAmount(amount: string): { valid: boolean; value: bigint; baseUnits: string; error: string | null } {
  const raw = amount.trim();
  if (!raw) return { valid: false, value: 0n, baseUnits: "0", error: null };
  const clean = raw.replace(/[$,]/g, "");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(clean)) {
    return { valid: false, value: 0n, baseUnits: "0", error: INVALID_AMOUNT };
  }
  try {
    const value = usdcToBaseUnits(raw);
    if (value <= 0n) return { valid: false, value: 0n, baseUnits: "0", error: INVALID_AMOUNT };
    return { valid: true, value, baseUnits: value.toString(), error: null };
  } catch (e) {
    return { valid: false, value: 0n, baseUnits: "0", error: (e as Error).message || INVALID_AMOUNT };
  }
}

export function Send() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { contacts: bffContacts, session, balance, refresh, refreshBalance } = useWallet();
  const contacts = useMemo(() => mergeContacts(bffContacts), [bffContacts]);
  const { state, receipt, run, reset } = useSendStream();
  const [to, setTo] = useState(() => params.get("to") ?? "");
  const [amount, setAmount] = useState(() => params.get("amount") ?? "");
  const [memo, setMemo] = useState(() => params.get("memo") ?? "");
  const requestId = params.get("requestId") ?? undefined;
  const [step, setStep] = useState<Step>("form");
  const [stepUp, setStepUp] = useState(false);
  const [unregistered, setUnregistered] = useState(false);
  const [firing, setFiring] = useState(false);
  const parsedAmount = useMemo(() => parsePositiveAmount(amount), [amount]);
  const amountBaseUnits = parsedAmount.baseUnits;
  const amountUsd = parsedAmount.valid ? Number(parsedAmount.value) / Number(USDC_BASE_UNITS) : 0;
  const overCap = needsStepUp(amountUsd, session?.kycTier);

  const plan = useMemo(() => proverPlan(), []);
  const recipient = to.trim();
  const kind = useMemo(() => (recipient ? classifyRecipientInput(recipient) : null), [recipient]);

  const badAddress = useMemo(() => looksLikeEvmAddressInput(recipient) && !isValidEvmAddress(recipient), [recipient]);
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const known = useMemo(() => contacts.find((c) => c.handle === recipient), [contacts, recipient]);
  const display = useMemo(() => {
    if (known) return known.name;
    if (recipient.startsWith("bzr_")) return `${recipient.slice(0, 10)}...${recipient.slice(-8)}`;
    if (recipient.length > 24) return `${recipient.slice(0, 8)}...${recipient.slice(-8)}`;
    return recipient;
  }, [known, recipient]);

  const privateBaseUnits = BigInt(balance?.baseUnits ?? "0");
  const wantBaseUnits = parsedAmount.value;
  const privateRecipient = kind === "private" || kind === "address";
  const checkingPrivateBalance = privateRecipient && wantBaseUnits > 0n && balance == null;
  const lowPrivate = privateRecipient && wantBaseUnits > 0n && balance != null && wantBaseUnits > privateBaseUnits;
  const recipientReady = recipient.length > 0 && parsedAmount.valid && kind !== "invite" && !badAddress;
  const canOpenStepUp = overCap && recipientReady;
  const valid = recipientReady && !checkingPrivateBalance && !lowPrivate;

  const inFlight = state.phase !== "idle";

  const view: SendReceipt = {
    amount: receipt?.amount ?? amountBaseUnits,
    recipient: display,
    memo: memo || undefined,
    prover: receipt?.prover ?? plan.kind,
    onChain: receipt?.onChain ?? false,
    txHash: receipt?.txHash,
    provingMs: receipt?.provingMs,
  };

  async function fire() {
    if (firing || inFlight) return;
    setFiring(true);
    try {
      if (shouldLockOnSend() && !(await requireUnlock())) return;
      // Recipient eERC-registration pre-check. A private send to a raw address
      // that never set up private payments would otherwise revert deep inside the
      // ceremony as an opaque failure. Catch it up front and show a clear state.
      if (kind === "address") {
        const ready = await isRegisteredOnEerc(recipient as `0x${string}`);
        if (!ready) {
          setUnregistered(true);
          return;
        }
      }
      await run(recipient, amount, memo || undefined, plan.kind, false, requestId);
      void refresh();
    } finally {
      setFiring(false);
    }
  }

  function done() {
    reset();
    // Hand the destination a flag so the balance count-up plays as an arrival —
    // the coin the ceremony flew lands in the BalanceHero.
    nav("/", { state: { justSent: true } });
  }

  return (
    <Screen>
      <ScreenHeader title="Send" />
      <div className="px-5 pt-2">
        {step === "form" ? (
          <>
            <Input
              label="To"
              placeholder="Address or Receive Code"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="send-handle"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {recipient && !badAddress ? <KindChip key={kind} kind={kind!} /> : null}
            {badAddress ? (
              <div className="mt-2 flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-[11.5px] font-semibold text-danger" data-testid="send-bad-address">
                <AlertTriangle size={12} /> This doesn't look like a valid wallet address. Double-check it.
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {contacts.map((c) => (
                <button
                  key={c.handle}
                  onClick={() => setTo(c.handle)}
                  className={`flex max-w-[10rem] items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    recipient === c.handle ? "border-accent bg-accent/10 text-accent" : "border-hair bg-card text-ink hover:bg-canvas"
                  }`}
                >
                  <Avatar name={c.name} tone={c.tone} size={26} />
                  <span className="min-w-0 truncate">
                    {c.handle.startsWith("bzr_") ? `${c.handle.slice(0, 8)}...${c.handle.slice(-6)}` : c.handle.length > 20 ? `${c.handle.slice(0, 6)}...${c.handle.slice(-6)}` : c.handle}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-6">
              <AmountField value={amount} onChange={setAmount} autoFocus />
              <div className="text-center text-[13px] text-muted">{display ? `to ${display}` : "Enter an amount"}</div>
              {overCap ? (
                <div className="mx-auto mt-2 max-w-[280px] text-center text-[12px] text-[#9a6b12]" data-testid="send-overcap-hint">
                  Sends over ${sendCapUsd(session?.kycTier).toLocaleString()} need a quick one-time ID check.
                </div>
              ) : null}
              {parsedAmount.error ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] font-medium text-danger" data-testid="send-amount-error">
                  {parsedAmount.error}
                </div>
              ) : null}
              {lowPrivate && !canOpenStepUp ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] text-[#9a6b12]" data-testid="send-low-private">
                  {INSUFFICIENT_PRIVATE_USDC_ERROR}
                </div>
              ) : null}
              {checkingPrivateBalance ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] text-muted" data-testid="send-private-balance-checking">
                  Checking private balance...
                </div>
              ) : null}
              <div className="mt-3 flex justify-center gap-2">
                {["5", "10", "20", "50", "100"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(q)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      amount === q ? "border-accent bg-accent/10 text-accent" : "border-hair bg-card text-ink hover:bg-canvas"
                    }`}
                  >
                    ${q}
                  </button>
                ))}
              </div>
            </div>

            <Input className="mt-6" label="Note (optional)" placeholder="What's it for?" value={memo} onChange={(e) => setMemo(e.target.value)} data-testid="send-memo" />

            {kind === "invite" && recipient && !badAddress ? (
              <div className="mt-6 flex items-center gap-3 rounded-2xl bg-accent/[0.06] p-4">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent/15 text-accent">
                  <UserPlus size={17} />
                </div>
                <div className="flex-1 text-[13px] text-ink">
                  <b>{recipient.length > 20 ? `${recipient.slice(0, 10)}...${recipient.slice(-8)}` : recipient}</b> isn't on Benzo yet.
                  <div className="text-muted">Send them a link they can claim.</div>
                </div>
                <Button size="sm" onClick={() => nav(`/invite?to=${encodeURIComponent(recipient)}&amount=${encodeURIComponent(amount)}`)} data-testid="send-invite">
                  Invite
                </Button>
              </div>
            ) : null}

            {kind !== "invite" ? (
              <Button full size="lg" className="mt-6" disabled={!valid && !canOpenStepUp} onClick={() => (overCap ? setStepUp(true) : setStep("confirm"))} data-testid="send-submit">
                {amount && (valid || canOpenStepUp) ? `${overCap ? "Verify" : "Review"} · ${fmtUsd(amountBaseUnits)}` : "Review"}
              </Button>
            ) : null}
          </>
        ) : (
          <ConfirmStep
            kind={kind!}
            display={display}
            address={kind === "address" ? recipient : undefined}
            amount={amountBaseUnits}
            memo={memo}
            plan={plan}
            isNewRecipient={!known && privateRecipient}
            firing={firing}
            onBack={() => setStep("form")}
            onSend={fire}
          />
        )}
      </div>

      {inFlight ? <SendCeremony state={state} receipt={view} onDone={done} onRetry={() => { reset(); setStep("confirm"); }} /> : null}
      {stepUp ? <StepUpSheet message={stepUpMessage(amountUsd, session?.kycTier)} onClose={() => setStepUp(false)} /> : null}
      {unregistered ? (
        <UnregisteredSheet
          display={display}
          onClose={() => setUnregistered(false)}
          onInvite={() => nav(`/invite?to=${encodeURIComponent(recipient)}&amount=${encodeURIComponent(amount)}`)}
        />
      ) : null}
    </Screen>
  );
}

function StepUpSheet({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex flex-col justify-end bg-ink/30 backdrop-blur-sm"
      data-testid="send-stepup"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-[28px] bg-card px-6 pb-8 pt-6"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" />
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" />
          <h2 className="font-display text-lg">Verify to send more</h2>
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted">{message}</p>
        <Button full size="lg" className="mt-5" onClick={onClose} data-testid="stepup-verify">Verify identity</Button>
        <button onClick={onClose} className="mt-3 w-full rounded-lg py-1 text-center text-[14px] font-semibold text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="stepup-later">Maybe later</button>
      </motion.div>
    </motion.div>
  );
}

function UnregisteredSheet({ display, onClose, onInvite }: { display: string; onClose: () => void; onInvite: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex flex-col justify-end bg-ink/30 backdrop-blur-sm"
      data-testid="send-unregistered"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-[28px] bg-card px-6 pb-8 pt-6"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" />
        <div className="mb-1 flex items-center gap-2">
          <AlertTriangle size={18} className="text-[#9a6b12]" />
          <h2 className="font-display text-lg">Not set up for private payments</h2>
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted">
          <b className="text-ink">{display}</b> hasn't set up private payments yet, so this address can't receive a
          private send. Nothing left your wallet. Invite them to Benzo, or double-check the address.
        </p>
        <Button full size="lg" className="mt-5" onClick={onInvite} data-testid="unregistered-invite">
          <UserPlus size={17} className="flex-none" /> Invite them
        </Button>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg py-1 text-center text-[14px] font-semibold text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          data-testid="unregistered-back"
        >
          Back
        </button>
      </motion.div>
    </motion.div>
  );
}

function KindChip({ kind }: { kind: Kind }) {
  const map = {
    private: { icon: <AtSign size={12} />, text: "Send privately. Only you two see it", cls: "bg-accent/10 text-accent" },
    address: { icon: <ShieldCheck size={12} />, text: "Private send to this wallet address", cls: "bg-accent/10 text-accent" },
    invite: { icon: <UserPlus size={12} />, text: "Not on Benzo yet. Invite them", cls: "bg-ink/[0.05] text-muted" },
  }[kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${map.cls}`}
      data-testid="send-kind"
    >
      {map.icon}
      {map.text}
    </motion.div>
  );
}

function ConfirmStep({
  kind,
  display,
  address,
  amount,
  memo,
  plan,
  isNewRecipient,
  firing,
  onBack,
  onSend,
}: {
  kind: Kind;
  display: string;
  address?: string;
  amount: string;
  memo: string;
  plan: { onDevice: boolean; kind: ProverKind; reason: string };
  isNewRecipient: boolean;
  firing: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <div>
      <div className="mt-2 rounded-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="text-center">
          <div className="font-display tnum text-4xl text-ink">{fmtUsd(amount)}</div>
          {kind === "address" && address ? (
            <div className="mx-auto mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1 font-mono text-[13px] text-ink" data-testid="confirm-address">
              <ShieldCheck size={12} className="flex-none text-accent" /> {shortAddress(address)}
            </div>
          ) : (
            <div className="mx-auto mt-1 max-w-full truncate px-4 text-sm text-muted">to {display}</div>
          )}
        </div>
        {memo ? <div className="mt-3 rounded-xl bg-canvas/70 px-3 py-2 text-center text-sm text-ink">"{memo}"</div> : null}
        <div className="mt-4 flex justify-center">
          <PrivateChip label={`Only you and ${display} can see this`} />
        </div>
      </div>

      {isNewRecipient ? (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-[#fbf1dd] px-3.5 py-2.5 text-sm text-[#9a6b12]" data-testid="send-new-recipient">
          <AlertTriangle size={15} className="mt-0.5 flex-none" />
          <span>
            <b>First time paying {display}.</b> Sends are instant and final, so double-check the recipient is right.
          </span>
        </div>
      ) : (
        <div className="mt-3 text-center text-sm text-muted">
          Sends instantly and can't be undone.
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-hair bg-card px-3.5 py-2.5 text-xs text-muted" data-testid="send-prover-plan">
        {plan.onDevice ? <Smartphone size={15} className="flex-none text-accent" /> : <ShieldCheck size={15} className="flex-none text-accent" />}
        <span>{plan.reason}</span>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" onClick={onBack} disabled={firing} data-testid="send-back">
          Back
        </Button>
        <Button full size="lg" loading={firing} disabled={firing} onClick={onSend} data-testid="send-confirm">
          <SendIcon size={17} className="flex-none" />
          <span className="truncate">Send {fmtUsd(amount)}</span>
        </Button>
      </div>
    </div>
  );
}
