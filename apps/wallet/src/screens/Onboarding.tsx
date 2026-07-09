import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Eye, Fingerprint, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { LogoMark } from "../ui/Logo";
import { Button, Input, useToast } from "../ui/primitives";
import { fadeUp, stagger, EASE } from "../ui/motion";
import { useWallet } from "../lib/store";
import { isWebAuthnAvailable } from "../lib/passkey";
import { activatePrivateBalance, createWalletWithPasskey, importWallet } from "../lib/localWallet";

type Step = "welcome" | "import" | "activating";

const POINTS = [
  { icon: <ShieldCheck size={18} />, title: "Local custody", body: "Secrets are kept on your device, locked by passkey or passcode." },
  { icon: <KeyRound size={18} />, title: "No hosted accounts", body: "No usernames, no Google logins. Pure self-custody." },
  { icon: <Eye size={18} />, title: "Private by default", body: "Zero-knowledge proofs keep your balances and payouts hidden." },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [passphrase, setPassphrase] = useState("");
  const [importedText, setImportedText] = useState("");
  const [lockMethod, setLockMethod] = useState<"passkey" | "passphrase">("passkey");
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const { refresh } = useWallet();

  const isPasskeyCapable = isWebAuthnAvailable();

  useEffect(() => {
    if (!isPasskeyCapable) {
      setLockMethod("passphrase");
    }
  }, [isPasskeyCapable]);

  // Activation seals the shielded balance on-chain (register-on-first-use). It is
  // the ONLY thing between "wallet created" and Home — there is no backup gate.
  async function runActivation() {
    setBusy(true);
    setErr(null);
    try {
      const activation = await activatePrivateBalance();
      if (!activation) throw new Error("Wallet is locked. Unlock it and try again.");
      await refresh();
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // One tap: silently generate the seed + passkey (or a device-local secret when
  // there's no authenticator) and go straight to activation → Home. Backup is a
  // later, non-blocking step in Profile — never a gate here.
  async function handleCreate() {
    setBusy(true);
    setErr(null);
    try {
      await createWalletWithPasskey("benzo-local-user");
    } catch (e) {
      setErr((e as Error).message.includes("cancel") ? "Passkey cancelled." : "Could not create wallet. Please try again.");
      setBusy(false);
      return;
    }
    setStep("activating");
    await runActivation();
  }

  async function handleImport() {
    if (!importedText.trim()) {
      setErr("Please paste your Avalanche Benzo backup JSON or EVM private key.");
      return;
    }
    if (lockMethod === "passphrase" && passphrase.length < 4) {
      setErr("Passcode must be at least 4 characters.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (lockMethod === "passphrase") {
        await importWallet(importedText, passphrase);
      } else {
        await importWallet(importedText);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      return;
    }
    // They already hold their backup — never show the backup screen on import.
    toast({ title: "Wallet imported successfully!", tone: "success" });
    setStep("activating");
    await runActivation();
  }

  return (
    <motion.div
      className="absolute inset-0 z-[70] flex flex-col bg-canvas"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid="onboarding"
    >
      <AnimatePresence mode="wait">
        {step === "welcome" && (
          <Pane key="welcome">
            <div className="my-auto flex flex-col items-center text-center w-full">
              <div className="text-accent">
                <LogoMark size={64} />
              </div>
              <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="font-display mt-6 text-[28px] leading-tight sm:text-[32px]">
                Money you control.
                <br />
                Local & Private.
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-3 max-w-[280px] text-[15px] text-muted">
                A secure, local-first web wallet. Secrets stay on your device.
              </motion.p>
              <motion.div variants={stagger} initial="hidden" animate="show" className="mt-8 w-full space-y-3">
                {POINTS.map((p) => (
                  <motion.div key={p.title} variants={fadeUp} className="flex items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-[var(--shadow-card)]">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent/10 text-accent">{p.icon}</div>
                    <div>
                      <div className="text-[15px] font-semibold">{p.title}</div>
                      <div className="text-[13px] text-muted">{p.body}</div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
            {err ? <p className="mt-4 text-center text-[13px] text-danger" data-testid="onboarding-error">{err}</p> : null}
            <div className="mt-6 space-y-3">
              <Button full size="lg" loading={busy} onClick={handleCreate} data-testid="onboarding-create">
                <Fingerprint size={18} /> Create new wallet
              </Button>
              <Button full variant="secondary" size="lg" disabled={busy} onClick={() => { setStep("import"); setErr(null); }} data-testid="onboarding-import">
                Import existing wallet
              </Button>
            </div>
          </Pane>
        )}

        {step === "import" && (
          <Pane key="import" onBack={() => { setStep("welcome"); setErr(null); }}>
            <div className="my-auto flex flex-col w-full pb-6">
              <h1 className="font-display text-[26px] leading-tight">Import wallet</h1>
              <p className="mt-2 text-[14px] text-muted">Paste your backup JSON or EVM private key.</p>

              <div className="mt-4">
                <textarea
                  value={importedText}
                  onChange={(e) => setImportedText(e.target.value)}
                  placeholder='Paste {"evmPrivateKey": "0x...", "eercDecryptionKey": "...", "orgSpendId": "...", "mvkSeedHex": "..."} or a 0x private key'
                  rows={4}
                  data-testid="import-textarea"
                  className="w-full rounded-2xl border border-hair bg-canvas/60 px-4 py-3 text-[14px] text-ink placeholder:text-muted outline-none transition focus:border-accent focus:bg-card focus:ring-4 focus:ring-accent/15"
                />
              </div>

              {err ? <p className="mt-2 text-[13px] text-danger" data-testid="import-error">{err}</p> : null}

              {isPasskeyCapable && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setLockMethod("passkey")}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition ${lockMethod === "passkey" ? "border-accent bg-accent/10 text-accent" : "border-hair text-muted"}`}
                  >
                    Lock with Passkey
                  </button>
                  <button
                    onClick={() => setLockMethod("passphrase")}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition ${lockMethod === "passphrase" ? "border-accent bg-accent/10 text-accent" : "border-hair text-muted"}`}
                  >
                    Lock with Passcode
                  </button>
                </div>
              )}

              {lockMethod === "passphrase" && (
                <div className="mt-4">
                  <Input
                    type="password"
                    label="Choose a passcode for this wallet"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="At least 4 characters"
                    data-testid="import-passcode-input"
                  />
                </div>
              )}
            </div>

            <Button full size="lg" onClick={handleImport} loading={busy} data-testid="import-submit">
              Import Wallet
            </Button>
          </Pane>
        )}

        {step === "activating" && (
          <Pane key="activating">
            <div className="my-auto flex w-full flex-col items-center pb-6 text-center">
              <ActivationSeal failed={!!err} />
              <h1 className="font-display mt-6 text-[24px] leading-tight">Activating your private balance</h1>
              <p className="mt-2 max-w-[290px] text-[14px] text-muted">
                Sealing your shielded balance on Avalanche so private sends can settle.
              </p>

              {err ? (
                <p className="mt-4 text-[13px] text-danger" data-testid="activation-error">{err}</p>
              ) : (
                <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent" aria-live="polite">
                  <ShieldCheck size={13} /> Sealing now
                </div>
              )}
            </div>

            {err ? (
              <Button full size="lg" loading={busy} onClick={runActivation} data-testid="activation-retry">
                Try again
              </Button>
            ) : null}
          </Pane>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActivationSeal({ failed }: { failed: boolean }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
      {!reduce && !failed ? (
        <>
          <motion.div
            className="absolute h-28 w-28 rounded-full border border-accent/20"
            animate={{ opacity: [0.3, 0.75, 0.3], scale: [0.92, 1.12, 0.92] }}
            transition={{ duration: 2.2, ease: EASE, repeat: Infinity }}
          />
          <motion.div
            className="absolute h-20 w-20 rounded-full border-2 border-accent/25"
            animate={{ opacity: [0.55, 1, 0.55], scale: [1.08, 0.88, 1.08] }}
            transition={{ duration: 2.2, ease: EASE, repeat: Infinity }}
          />
        </>
      ) : (
        <div className={`absolute h-24 w-24 rounded-full border-2 ${failed ? "border-danger/25" : "border-accent/25"}`} />
      )}
      <motion.div
        className={`relative flex h-20 w-20 items-center justify-center rounded-full shadow-[var(--shadow-card)] ${failed ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"}`}
        animate={reduce || failed ? {} : { scale: [1, 1.04, 1] }}
        transition={{ duration: 2.2, ease: EASE, repeat: Infinity }}
      >
        {failed ? <ShieldAlert size={34} /> : <ShieldCheck size={34} />}
      </motion.div>
    </div>
  );
}

function Pane({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <motion.div
      className="relative flex flex-1 flex-col px-7 pb-10 pt-16 min-h-0 overflow-y-auto no-scrollbar"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.32, ease: EASE }}
    >
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Back"
          data-testid="onboarding-back"
          className="absolute left-5 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-ink/[0.06] text-ink transition outline-none hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ArrowLeft size={18} />
        </button>
      ) : null}
      {children}
    </motion.div>
  );
}
