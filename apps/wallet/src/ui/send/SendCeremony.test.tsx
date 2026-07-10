import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentState } from "@benzo/ui/payment-state";
import { SendCeremony, type SendReceipt } from "./SendCeremony";

const receipt: SendReceipt = {
  amount: "2500000",
  recipient: "@mara",
  onChain: true,
  prover: "local",
  txHash: "0xabc",
  provingMs: 3200,
};

function renderCeremony(state: PaymentState) {
  return render(<SendCeremony state={state} receipt={receipt} onDone={vi.fn()} onRetry={vi.fn()} />);
}

describe("SendCeremony — full-viewport coin-flight", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("materializes the continuous coin while proving (encrypt phase)", () => {
    renderCeremony({ phase: "proving" });
    expect(screen.getByTestId("ceremony-coin")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Encrypting your payment");
    expect(screen.queryByTestId("ceremony-receipt")).not.toBeInTheDocument();
  });

  it("honors the settle floor so an instant confirm never flashes past the flight", () => {
    const { rerender } = renderCeremony({ phase: "submitting", txHash: "0xabc" });
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Settling securely");

    // The real machine races submitting -> confirmed almost instantly.
    rerender(<SendCeremony state={{ phase: "confirmed" }} receipt={receipt} onDone={vi.fn()} onRetry={vi.fn()} />);

    // Still settling: the coin is mid-flight and the receipt is withheld until the floor elapses.
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Settling securely");
    expect(screen.queryByTestId("ceremony-receipt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("receipt-details-toggle")).not.toBeInTheDocument();

    // Once the settle floor (800ms) is honored, it lands on the verified receipt.
    act(() => {
      vi.advanceTimersByTime(SETTLE_FLOOR_MS + 50);
    });
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Sent privately");
    expect(screen.getByTestId("ceremony-receipt")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-done")).toBeInTheDocument();
  });

  it("drops to a clear retry state on failure without the coin", () => {
    renderCeremony({ phase: "failed", error: "ledger rejected" });
    expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("ledger rejected");
    expect(screen.getByTestId("ceremony-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("ceremony-coin")).not.toBeInTheDocument();
  });
});

const SETTLE_FLOOR_MS = 800;
