import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profile } from "./Profile";

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
  balance: { stroops: "0", live: true },
  publicBalance: {
    stroops: "0",
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

vi.mock("../lib/api", () => ({
  api: {
    deleteAccount: vi.fn(async () => ({ deleted: true })),
  },
  notifyAuthRequired: vi.fn(),
}));

vi.mock("../lib/chain", () => ({
  getChainStatus: vi.fn(async () => ({ sequence: 12345 })),
}));

vi.mock("../lib/lock", () => lockMocks);

vi.mock("../lib/localWallet", () => ({
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
