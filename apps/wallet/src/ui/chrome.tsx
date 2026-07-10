/**
 * Shared screen chrome: the Home top bar (logo + globe + eye + bell) and the
 * sub-screen header (back chevron + title) used by Send / Request / Share.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronLeft, Check, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Logo, NetworkMark } from "./Logo";
import { IconButton } from "./primitives";
import { HideToggle } from "./privacy";
import { spring } from "./motion";
import { useWallet } from "../lib/store";
import { useNetwork } from "../lib/networkContext";
import { unreadCount } from "../lib/notifications";

/**
 * A quick network picker anchored under a globe in the top bar — switch Fuji /
 * BenzoNet / mainnet on the fly. Reuses the segmented-pill styling from Profile
 * (same `useNetwork` context); selecting one retints the whole shell (App reads
 * the active theme) and re-points every client-side read.
 */
function NetworkGlobe() {
  const { network, setNetwork, theme, options } = useNetwork();
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
      <IconButton aria-label="Switch network" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="home-network-globe">
        <Globe size={18} />
      </IconButton>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={spring}
            role="menu"
            data-testid="home-network-menu"
            className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2.5rem)] origin-top-right rounded-2xl border border-hair bg-card p-3 shadow-[var(--shadow-card)]"
          >
            <div className="mb-2 flex items-center gap-2">
              <NetworkMark network={network} size={28} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">Network</div>
                <div className="truncate text-[11px] text-muted" data-testid="home-network-current">{theme.label}</div>
              </div>
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
                        layoutId="home-network-pill"
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

export function TopBar({ hidden, onToggleHide }: { hidden: boolean; onToggleHide: () => void }) {
  const nav = useNavigate();
  const { history } = useWallet();
  const unread = unreadCount(history);
  return (
    <div className="flex items-center justify-between px-5 pb-2 pt-5">
      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
        <Logo size={30} className="text-ink" />
      </motion.div>
      <div className="flex items-center gap-2.5">
        <NetworkGlobe />
        <HideToggle hidden={hidden} onToggle={onToggleHide} />
        <IconButton badge={unread > 0} aria-label="Notifications" onClick={() => nav("/notifications")} data-testid="bell">
          <Bell size={18} />
        </IconButton>
      </div>
    </div>
  );
}

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-5">
      <IconButton onClick={() => (onBack ? onBack() : nav(-1))} aria-label="Back">
        <ChevronLeft size={20} />
      </IconButton>
      <h1 className="font-display text-xl">{title}</h1>
    </div>
  );
}
