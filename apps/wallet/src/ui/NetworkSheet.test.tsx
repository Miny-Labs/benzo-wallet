import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkSheet } from "./NetworkSheet";
import { NetworkProvider } from "../lib/networkContext";
import * as net from "../lib/network";

function renderSheet(onClose = vi.fn()) {
  render(
    <NetworkProvider>
      <NetworkSheet open onClose={onClose} />
    </NetworkProvider>,
  );
  return onClose;
}

describe("NetworkSheet", () => {
  beforeEach(() => {
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });
  afterEach(() => {
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });

  it("lists every network with a plain-English risk label + note", () => {
    renderSheet();
    expect(screen.getByTestId("network-sheet-fuji")).toHaveTextContent("Test funds only");
    expect(screen.getByTestId("network-sheet-benzonet")).toHaveTextContent("Permissioned network");
    expect(screen.getByTestId("network-sheet-avalanche")).toHaveTextContent("Real assets");
    expect(screen.getByTestId("network-sheet-note")).toHaveTextContent("Balances and activity differ per network");
    // Fuji is active → checkmark, mainnet is not.
    expect(screen.getByTestId("network-sheet-fuji-check")).toBeInTheDocument();
  });

  it("gates a mainnet switch behind a real-assets confirmation", () => {
    const onClose = renderSheet();

    fireEvent.click(screen.getByTestId("network-sheet-avalanche"));
    // Not switched yet — the confirm step appears first.
    expect(screen.getByTestId("network-sheet-confirm")).toBeInTheDocument();
    expect(net.getActiveNetwork()).toBe("fuji");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("network-sheet-confirm-yes"));
    expect(net.getActiveNetwork()).toBe("avalanche");
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the mainnet confirmation without switching", () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("network-sheet-avalanche"));
    fireEvent.click(screen.getByTestId("network-sheet-confirm-cancel"));
    expect(net.getActiveNetwork()).toBe("fuji");
    // Back to the picker list.
    expect(screen.getByTestId("network-sheet")).toBeInTheDocument();
  });

  it("switches to a testnet immediately (no confirm)", () => {
    const onClose = renderSheet();
    fireEvent.click(screen.getByTestId("network-sheet-benzonet"));
    expect(net.getActiveNetwork()).toBe("benzonet");
    expect(onClose).toHaveBeenCalled();
  });
});
