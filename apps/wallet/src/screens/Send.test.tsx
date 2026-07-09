import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Send } from "./Send";

const TX_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const walletState = vi.hoisted(() => ({
  session: {
    profile: { handle: "tester", name: "Tester" },
    handle: "tester",
    kycTier: 1,
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  },
  balance: { baseUnits: "0", live: true },
  publicBalance: {
    baseUnits: "1001000000",
    address: "0x2222222222222222222222222222222222222222",
    asset: "USDC",
    issuer: "",
    live: true,
  },
  history: [],
  contacts: [],
  loading: false,
  error: null,
  hidden: false,
  toggleHidden: vi.fn(),
  deviceVerified: false,
  refresh: vi.fn(async () => true),
  refreshBalance: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => ({
  apiSendPublic: vi.fn(),
  saveLocalHistory: vi.fn(),
  sendPublicClientSide: vi.fn(),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    currentGoogleCredential: () => null,
    api: {
      ...actual.api,
      sendPublic: mocks.apiSendPublic,
    },
  };
});

vi.mock("../lib/benzoClient", () => ({
  sendPublicClientSide: mocks.sendPublicClientSide,
}));

vi.mock("../lib/history", () => ({
  saveLocalHistory: mocks.saveLocalHistory,
}));

vi.mock("../lib/lock", () => ({
  requireUnlock: vi.fn(async () => true),
  shouldLockOnSend: vi.fn(() => false),
}));

vi.mock("../lib/useSendStream", () => ({
  useSendStream: () => ({
    state: { phase: "idle" },
    receipt: null,
    run: vi.fn(),
    reset: vi.fn(),
  }),
}));

describe("Send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletState.refresh.mockResolvedValue(true);
    walletState.refreshBalance.mockResolvedValue(undefined);
    mocks.apiSendPublic.mockRejectedValue(new Error("BFF offline"));
    mocks.sendPublicClientSide.mockResolvedValue({ txHash: TX_HASH, prover: "local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and dismisses the compliance step-up sheet before balance checks", async () => {
    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1001" } });

    expect(screen.getByTestId("send-overcap-hint")).toHaveTextContent("Sends over $1,000");
    expect(screen.queryByTestId("send-low-private")).not.toBeInTheDocument();

    const submit = screen.getByTestId("send-submit");
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent("Verify · $1,001.00");

    fireEvent.click(submit);
    expect(await screen.findByTestId("send-stepup")).toBeInTheDocument();
    expect(screen.getByText("Verify to send more")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stepup-later"));
    await waitFor(() => expect(screen.queryByTestId("send-stepup")).not.toBeInTheDocument());
  });

  it("sends a public ERC-20 transfer with the backend unplugged", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("BFF offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByTestId("send-memo"), { target: { value: "rent" } });

    fireEvent.click(screen.getByTestId("send-submit"));
    fireEvent.click(await screen.findByTestId("send-confirm"));

    expect(await screen.findByTestId("send-public-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("send-public-title")).toHaveTextContent("Sent to a wallet");
    expect(mocks.apiSendPublic).not.toHaveBeenCalled();
    expect(mocks.sendPublicClientSide).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", "2500000");
    expect(mocks.saveLocalHistory).toHaveBeenCalledWith(expect.objectContaining({
      id: TX_HASH,
      type: "publicSend",
      note: "rent",
      amount: "2500000",
      direction: "out",
      status: "settled",
      txHash: TX_HASH,
    }));
    expect(walletState.refresh).toHaveBeenCalled();
  });

  it("rejects an invalid public amount without sending or recording history", () => {
    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.0000001" } });

    expect(screen.getByTestId("send-amount-error")).toHaveTextContent("USDC has at most 6 decimals");
    expect(screen.getByTestId("send-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("send-submit"));

    expect(mocks.sendPublicClientSide).not.toHaveBeenCalled();
    expect(mocks.saveLocalHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId("send-public-overlay")).not.toBeInTheDocument();
  });

  it("records an empty note for a public send when memo is blank", async () => {
    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });

    fireEvent.click(screen.getByTestId("send-submit"));
    fireEvent.click(await screen.findByTestId("send-confirm"));

    expect(await screen.findByTestId("send-public-overlay")).toBeInTheDocument();
    expect(mocks.saveLocalHistory).toHaveBeenCalledWith(expect.objectContaining({
      id: TX_HASH,
      type: "publicSend",
      note: "",
      amount: "2500000",
      status: "settled",
    }));
  });
});
