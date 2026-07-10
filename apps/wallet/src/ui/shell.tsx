/**
 * Shell chrome coordination — currently just BottomNav visibility. Send is a
 * FLOATING action, not a tab, and the nav must disappear for the whole focused
 * send flow (review → passkey → processing → success/failure). Rather than teach
 * App about each screen's internal step, screens declare their intent with
 * `useHideBottomNav(...)` and the shell reacts.
 *
 * The context defaults to a no-op so a screen rendered in isolation (unit tests,
 * Storybook) can call the hook without a provider and simply do nothing.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ShellContextValue {
  bottomNavHidden: boolean;
  setBottomNavHidden: (hidden: boolean) => void;
}

const ShellCtx = createContext<ShellContextValue>({
  bottomNavHidden: false,
  setBottomNavHidden: () => {},
});

export function ShellProvider({ children }: { children: ReactNode }) {
  const [bottomNavHidden, setBottomNavHidden] = useState(false);
  const value = useMemo<ShellContextValue>(() => ({ bottomNavHidden, setBottomNavHidden }), [bottomNavHidden]);
  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>;
}

export function useShell(): ShellContextValue {
  return useContext(ShellCtx);
}

/**
 * Hide the app's BottomNav while `hidden` is true; restores it on unmount or when
 * `hidden` flips back. Call it unconditionally (hooks rule) and gate with the arg:
 *   useHideBottomNav(step === "confirm" || inFlight)
 */
export function useHideBottomNav(hidden = true): void {
  const { setBottomNavHidden } = useShell();
  useEffect(() => {
    if (!hidden) return;
    setBottomNavHidden(true);
    return () => setBottomNavHidden(false);
  }, [hidden, setBottomNavHidden]);
}
