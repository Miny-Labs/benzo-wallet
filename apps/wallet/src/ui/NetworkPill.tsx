/**
 * NetworkPill — the header network affordance. A globe reads as "language / web",
 * not "which chain am I on", so the top bar shows a compact PILL instead: the
 * Avalanche mark + the network's trust name ("Fuji Testnet"), toned amber for a
 * testnet and green only for mainnet (see lib/networkEnv). Tapping it opens the
 * same switcher used on Profile (Fuji / BenzoNet / mainnet) and retints the shell.
 *
 * Reusable: drop `<NetworkPill />` anywhere a header needs the network affordance.
 */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { NetworkMark } from "./Logo";
import { spring } from "./motion";
import { useNetwork } from "../lib/networkContext";
import { getNetworkEnv, NETWORK_TONE_CHIP, NETWORK_TONE_DOT } from "../lib/networkEnv";

export function NetworkPill() {
  const { network, setNetwork, theme, options } = useNetwork();
  const env = getNetworkEnv(network);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileTap={{ scale: 0.96 }}
        type="button"
        aria-label={`Network: ${env.name}. Switch network`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="home-network-pill"
        className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40 ${NETWORK_TONE_CHIP[env.tone]}`}
      >
        <NetworkMark network={network} size={18} className="flex-none" />
        <span className="max-w-[110px] truncate">{env.name}</span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={spring}
            role="menu"
            data-testid="home-network-menu"
            className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-2.5rem)] origin-top-right rounded-[var(--radius-compact)] border border-hair bg-card p-3 shadow-[var(--shadow-card)]"
          >
            <div className="mb-2.5 flex items-center gap-2">
              <NetworkMark network={network} size={28} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">Network</div>
                <div className="truncate text-[11px] text-muted" data-testid="home-network-current">
                  {theme.label}
                </div>
              </div>
              <span
                className={`inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${NETWORK_TONE_CHIP[env.tone]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${NETWORK_TONE_DOT[env.tone]}`} />
                {env.funds}
              </span>
            </div>
            <div className="relative flex rounded-full bg-ink/[0.05] p-1" role="tablist" aria-label="Active network">
              {options.map((opt) => {
                const on = opt.network === network;
                return (
                  <button
                    key={opt.network}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      setNetwork(opt.network);
                      setOpen(false);
                    }}
                    data-testid={`home-network-${opt.network}`}
                    className={`relative z-10 flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[12px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? "text-white" : "text-muted hover:text-ink"}`}
                  >
                    {on ? (
                      <motion.span
                        layoutId="home-network-pill-active"
                        className="absolute inset-0 -z-10 rounded-full bg-accent shadow-[var(--shadow-glow)]"
                        transition={spring}
                      />
                    ) : null}
                    {on ? <Check size={12} className="flex-none" /> : null}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
