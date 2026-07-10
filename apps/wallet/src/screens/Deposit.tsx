/**
 * Receive - your Benzo wallet address + QR. This is intentionally just the edge
 * address users can share; shielding is an implementation detail, not a chore.
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../lib/clipboard";
import { getLocalAccountSummary } from "../lib/localWallet";
import { NETWORK_LABEL } from "../lib/network";
import { COPY } from "../lib/copy";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { PrivateChip } from "../ui/privacy";

export function Deposit() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "blocked">("idle");
  const address = getLocalAccountSummary()?.address ?? "";

  async function copy() {
    if (!address) return;
    const ok = await copyTextToClipboard(address);
    setCopyState(ok ? "copied" : "blocked");
    setTimeout(() => setCopyState("idle"), ok ? 1500 : 3000);
  }

  return (
    <Screen>
      {/* Receive is a top-level tab (BottomNav) — no back button. */}
      <ScreenHeader title="Receive" back={false} />
      <div className="px-5 pt-2">
        <p className="text-center text-[13.5px] text-muted">
          Share this address or QR code to receive USDC into your Benzo wallet.
        </p>

        <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl border border-hair bg-card p-5">
          {address ? (
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <QRCodeSVG value={address} size={168} level="M" />
            </div>
          ) : (
            <div className="flex h-[192px] w-[192px] flex-col items-center justify-center rounded-xl bg-canvas text-center" data-testid="deposit-address-missing">
              <div className="max-w-[150px] text-[12px] text-muted">Unlock your wallet to show your receive address.</div>
            </div>
          )}

          <div className="w-full">
            <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Your USDC address</div>
            <button
              onClick={copy}
              disabled={!address}
              aria-label={address ? `Copy receive address ${address}` : "Receive address unavailable"}
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl bg-canvas px-3 py-2.5 font-mono text-[12px] leading-tight text-ink transition outline-none hover:bg-canvas/70 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-accent/40"
              data-testid="deposit-address"
            >
              <span className="break-all text-left">{address || "Unavailable"}</span>
              {copyState === "copied" ? <Check size={14} className="flex-none text-pos" /> : <Copy size={14} className="flex-none text-muted" />}
            </button>
            {copyState !== "idle" ? (
              <div className={`mt-1 text-center text-[11.5px] font-semibold ${copyState === "copied" ? "text-pos" : "text-danger"}`} data-testid="deposit-copy-status">
                {copyState === "copied" ? "Address copied" : "Copy blocked. Select the address above."}
              </div>
            ) : null}
          </div>

          <div className="w-full rounded-xl bg-canvas/60 px-3 py-2 text-[11.5px] text-muted">
            <Row k="Asset" v="USDC" />
            <Row k="Network" v={NETWORK_LABEL} />
          </div>
        </div>

        <div className="mt-5 flex justify-center">
          <PrivateChip label={COPY.receivedPrivate} />
        </div>
      </div>
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}
