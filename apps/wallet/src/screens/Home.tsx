/**
 * Home - the single focal screen. One big balance (Helvetica Now, counts up), the
 * ambient Private chip, a 3-pill action row (Send is the purple+glow focal
 * action), and a plain-English activity preview. No tx hashes, gas, or "connect
 * wallet". A blocking banner appears only when the BFF isn't live.
 */
import { ArrowDownLeft, ArrowUpRight, Clock, Smartphone } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useWallet } from "../lib/store";
import { Screen, Stagger } from "../ui/motion";
import { TopBar } from "../ui/chrome";
import { BalanceHero } from "../ui/money";
import { PrivateChip } from "../ui/privacy";
import { Card } from "../ui/primitives";
import { ActivityItem } from "../ui/ActivityItem";

function ActionPill({
  label,
  icon,
  primary,
  onClick,
  testid,
}: {
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  onClick: () => void;
  testid: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -3 }}
      onClick={onClick}
      data-testid={testid}
      className={`flex flex-1 flex-col items-center gap-2 rounded-[22px] py-4 text-[13px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
        primary ? "bg-accent text-white shadow-[var(--shadow-glow)]" : "bg-card text-ink shadow-[0_6px_18px_rgba(25,40,55,0.05)]"
      }`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${primary ? "bg-white/20" : "bg-canvas"}`}>{icon}</span>
      {label}
    </motion.button>
  );
}

export function Home() {
  const nav = useNavigate();
  const location = useLocation();
  const justSent = Boolean((location.state as { justSent?: boolean } | null)?.justSent);
  const { balance, history, loading, hidden, toggleHidden, session, deviceVerified } = useWallet();

  return (
    <Screen>
      <TopBar hidden={hidden} onToggleHide={toggleHidden} />

      {session && !session.live ? (
        <div className="mx-5 mb-1 rounded-xl bg-amber/12 px-3 py-2 text-[12px] font-medium text-[#9a6b12]" data-testid="chain-unavailable-banner">
          Live chain connection unavailable. Balance and money actions are blocked until the app reconnects.
        </div>
      ) : null}

      <Stagger className="px-5">
        {/* Balance hero - the focal card. */}
        <Stagger.Item index={0}>
          <Card className="relative overflow-hidden p-6">
            <div className="text-[13px] font-medium text-muted">Balance</div>
            <BalanceHero baseUnits={balance?.baseUnits ?? "0"} hidden={hidden} loading={loading} arrived={justSent} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrivateChip label="Only you can see this" />
              {deviceVerified ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-pos/10 px-2.5 py-1 text-[11.5px] font-semibold text-pos"
                  data-testid="device-verified"
                  title="Your balance was read and computed on this device, straight from the chain - no server."
                >
                  <Smartphone size={12} /> Read on your device
                </span>
              ) : null}
              {balance?.syncing ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber/12 px-2.5 py-1 text-[11.5px] font-semibold text-[#9a6b12]"
                  data-testid="balance-syncing"
                  title="Showing the encrypted wallet ledger while the chain index catches up."
                >
                  Syncing chain
                </span>
              ) : null}
            </div>
          </Card>
        </Stagger.Item>

        {/* Action row */}
        <Stagger.Item index={1}>
          <div className="mt-4 flex gap-2.5">
            <ActionPill label="Send" testid="action-send" primary icon={<ArrowUpRight size={18} />} onClick={() => nav("/send")} />
            <ActionPill label="Receive" testid="action-receive" icon={<ArrowDownLeft size={18} />} onClick={() => nav("/deposit")} />
            <ActionPill label="Activity" testid="action-activity" icon={<Clock size={18} />} onClick={() => nav("/activity")} />
          </div>
        </Stagger.Item>

        {/* Activity preview */}
        <Stagger.Item index={2}>
          <Card className="mt-4 px-4 pb-2 pt-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Recent</div>
              <button onClick={() => nav("/activity")} className="rounded text-[12px] font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40">
                See all
              </button>
            </div>
            {loading ? (
              <div className="space-y-3 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton h-[42px] w-[42px] rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-3.5 w-28 rounded" />
                      <div className="skeleton h-3 w-20 rounded" />
                    </div>
                    <div className="skeleton h-4 w-14 rounded" />
                  </div>
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-7 text-center">
                <div className="text-sm font-semibold text-ink">Receive money to get going</div>
                <div className="max-w-[240px] text-[13px] text-muted">
                  Once there's money in your wallet, your payments show up here - private to you.
                </div>
                <button
                  onClick={() => nav("/deposit")}
                  data-testid="empty-receive"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-glow)] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <ArrowDownLeft size={14} /> Receive
                </button>
              </div>
            ) : (
              history.slice(0, 4).map((row, i, a) => <ActivityItem key={row.id} row={row} hidden={hidden} last={i === a.length - 1} />)
            )}
          </Card>
        </Stagger.Item>
        <div className="h-6" />
      </Stagger>
    </Screen>
  );
}
