import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "../lib/api";
import { TxDetail } from "./TxDetail";

const state = vi.hoisted(() => ({
  history: [] as ActivityRow[],
  hidden: false,
}));

vi.mock("../lib/store", () => ({
  useWallet: () => state,
}));

function renderDetail(row: ActivityRow) {
  state.history = [row];
  render(
    <MemoryRouter initialEntries={[`/activity/${row.id}`]}>
      <Routes>
        <Route path="/activity/:id" element={<TxDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TxDetail", () => {
  it("lets a verified private receive row open proof sharing", () => {
    renderDetail({
      id: "h_1_tx",
      type: "receive",
      name: "Paid you",
      note: "Paid you",
      amount: "1000000",
      direction: "in",
      status: "settled",
      timestamp: 1782370212,
      txHash: "2261cc8862eba610a24b293f113864a297f5008885dfdcbc1c3f01c497955417",
      tone: "accent",
    });

    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-share")).toBeInTheDocument();
  });

  it("describes outgoing private sends with proof and settlement steps", () => {
    renderDetail({
      id: "h_send",
      type: "send",
      name: "Alex",
      note: "Dinner",
      amount: "5000000",
      direction: "out",
      status: "settled",
      timestamp: 1782926977,
      txHash: "fd9117d121b3d574b0f0899d25779f0784bb0743815089771e560c93f0736fae",
      tone: "neutral",
    });

    expect(screen.getByText("Payment created")).toBeInTheDocument();
    expect(screen.getByText("Proved private")).toBeInTheDocument();
    expect(screen.getByText("Amount and recipient stayed hidden")).toBeInTheDocument();
    expect(screen.queryByText(/public avalanche|testnet reserve|made public/i)).not.toBeInTheDocument();
  });

  it("does not present a failed private send as a proved or debited transfer", () => {
    renderDetail({
      id: "h_failed_private",
      type: "send",
      name: "You sent",
      note: "Sent privately · Couldn't send right now. Your money is safe. Please try again.",
      amount: "5000000",
      direction: "out",
      status: "failed",
      timestamp: 1782926977,
      tone: "neutral",
    });

    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.queryByText("−$5.00")).not.toBeInTheDocument();
    expect(screen.getByText("attempted to")).toBeInTheDocument();
    expect(screen.getByText("Private proof did not complete")).toBeInTheDocument();
    expect(screen.getByText("No on-chain settlement was recorded")).toBeInTheDocument();
    expect(screen.getByText("No on-chain transfer recorded")).toBeInTheDocument();
    expect(screen.queryByText("Proved private")).not.toBeInTheDocument();
    expect(screen.queryByTestId("txdetail-share")).not.toBeInTheDocument();
    expect(screen.queryByTestId("txdetail-explorer")).not.toBeInTheDocument();
  });

  it("treats a legacy nonfailed row with failure copy and no tx as failed", () => {
    renderDetail({
      id: "h_legacy_failed_private",
      type: "send",
      name: "You sent",
      note: "Sent privately · Couldn't send right now. Your money is safe. Please try again.",
      amount: "5000000",
      direction: "out",
      status: "proving",
      timestamp: 1782926977,
      tone: "neutral",
    });

    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.queryByText("−$5.00")).not.toBeInTheDocument();
    expect(screen.getByText("attempted to")).toBeInTheDocument();
    expect(screen.getByText("Private proof did not complete")).toBeInTheDocument();
    expect(screen.getByText("No on-chain transfer recorded")).toBeInTheDocument();
    expect(screen.queryByText("Proved private")).not.toBeInTheDocument();
  });
});
