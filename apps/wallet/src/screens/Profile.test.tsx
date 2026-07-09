import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profile } from "./Profile";
import { NetworkProvider } from "../lib/networkContext";
import * as net from "../lib/network";

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
    baseUnits: "0",
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
  deviceVerified: true,
  refresh: vi.fn(async () => true),
  refreshBalance: vi.fn(async () => undefined),
}));

const localMocks = vi.hoisted(() => {
  const deviceOnly = {
    bound: false,
    recoverable: false,
    status: "action-needed" as const,
    custody: "non-custodial" as const,
    label: "Device only",
    nextSteps: ["Reveal and save a backup JSON."],
  };
  const backupRevealed = {
    ...deviceOnly,
    recoverable: true,
    status: "healthy" as const,
    label: "Backup revealed",
    nextSteps: ["Restore on another device with your backup JSON. Benzo cannot recover it for you."],
    lastExportedAt: 1_725_000_000_000,
  };
  const backupSaved = {
    ...backupRevealed,
    label: "Backup saved",
    backupConfirmedAt: 1_725_000_100_000,
  };
  return {
    currentRecovery: deviceOnly,
    deviceOnly,
    backupRevealed,
    backupSaved,
    exportWallet: vi.fn(),
    getLocalAccountSummary: vi.fn(() => ({
      address: "0x2222222222222222222222222222222222222222",
      spendPub: "1",
      mvkPub: "aa",
    })),
    getLocalRecoveryStatus: vi.fn(() => deviceOnly),
    markWalletBackupConfirmed: vi.fn(),
  };
});

const lockMocks = vi.hoisted(() => ({
  getLockSettings: vi.fn(() => ({ onOpen: false, onSend: false })),
  lockCapable: vi.fn(() => true),
  requireUnlock: vi.fn(async () => true),
  setLockSettings: vi.fn(),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/chain", () => ({
  getChainStatus: vi.fn(async () => ({ sequence: 12345 })),
}));

vi.mock("../lib/lock", () => lockMocks);

vi.mock("../lib/localWallet", () => ({
  deleteWallet: vi.fn(async () => undefined),
  exportWallet: localMocks.exportWallet,
  getLocalAccountSummary: localMocks.getLocalAccountSummary,
  getLocalRecoveryStatus: localMocks.getLocalRecoveryStatus,
  markWalletBackupConfirmed: localMocks.markWalletBackupConfirmed,
}));

describe("Profile recovery export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localMocks.currentRecovery = localMocks.deviceOnly;
    localMocks.getLocalRecoveryStatus.mockImplementation(() => localMocks.currentRecovery);
    localMocks.exportWallet.mockImplementation(async () => {
      localMocks.currentRecovery = localMocks.backupRevealed;
      return JSON.stringify({
        evmPrivateKey: `0x${"1".repeat(64)}`,
        eercDecryptionKey: "2".repeat(64),
        orgSpendId: "3",
        mvkSeedHex: "4".repeat(64),
      }, null, 2);
    });
    localMocks.markWalletBackupConfirmed.mockImplementation(() => {
      localMocks.currentRecovery = localMocks.backupSaved;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals exportable recovery material after device unlock with the backend unplugged", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("backend unplugged");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Device only");

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    await waitFor(() => expect(lockMocks.requireUnlock).toHaveBeenCalledOnce());
    expect(localMocks.exportWallet).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("recovery-backup-json")).toHaveTextContent("evmPrivateKey");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("eercDecryptionKey");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("orgSpendId");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("mvkSeedHex");
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup revealed");
  });

  it("confirms a revealed settings backup as saved", async () => {
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    expect(await screen.findByTestId("recovery-backup-panel")).toBeInTheDocument();
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup revealed");

    fireEvent.click(screen.getByTestId("recovery-confirm-saved"));

    expect(localMocks.markWalletBackupConfirmed).toHaveBeenCalledOnce();
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup saved");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Backup saved");
  });

  it("does not export recovery material when unlock is cancelled", async () => {
    lockMocks.requireUnlock.mockResolvedValueOnce(false);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    expect(await screen.findByTestId("recovery-error")).toHaveTextContent("Unlock cancelled.");
    expect(localMocks.exportWallet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("recovery-backup-json")).not.toBeInTheDocument();
  });
});

describe("Profile network switcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });
  afterEach(() => {
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });

  function renderProfile() {
    return render(
      <NetworkProvider>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </NetworkProvider>,
    );
  }

  it("defaults to Fuji and marks it the active environment", () => {
    renderProfile();
    expect(screen.getByTestId("network-option-fuji")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("network-option-avalanche")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("network-tagline")).toHaveTextContent("Fuji testnet");
  });

  it("switches to mainnet, persists the choice, and swaps the resolved address bundle", async () => {
    renderProfile();

    fireEvent.click(screen.getByTestId("network-option-avalanche"));

    await waitFor(() =>
      expect(screen.getByTestId("network-option-avalanche")).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByTestId("network-tagline")).toHaveTextContent("real funds");
    expect(screen.getByTestId("profile-mode")).toHaveTextContent("Avalanche C-Chain");

    // Persisted for reloads + the module bundle now targets C-Chain.
    expect(localStorage.getItem("benzo.network")).toBe("avalanche");
    expect(net.getActiveNetwork()).toBe("avalanche");
    expect(net.ENCRYPTED_ERC_ADDRESS).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");

    // Switching back to Fuji works.
    fireEvent.click(screen.getByTestId("network-option-fuji"));
    await waitFor(() =>
      expect(screen.getByTestId("network-option-fuji")).toHaveAttribute("aria-selected", "true"),
    );
    expect(net.getActiveNetwork()).toBe("fuji");
    expect(localStorage.getItem("benzo.network")).toBe("fuji");
  });
});
