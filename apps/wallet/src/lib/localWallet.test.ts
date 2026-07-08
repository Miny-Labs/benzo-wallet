import { accountFromSignedMessage } from "@benzo/core";
import { MemoryKVStore } from "@benzo/wallet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  kv: undefined as MemoryKVStore | undefined,
  open: vi.fn(),
}));

vi.mock("@benzo/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@benzo/wallet")>();
  return {
    ...actual,
    IndexedDbKVStore: {
      open: storeMocks.open,
    },
  };
});

const passkeyMocks = vi.hoisted(() => {
  const secret = new Uint8Array(32).fill(7);
  return {
    createDeviceAuthProof: vi.fn(),
    derivePasskeySecret: vi.fn(async () => secret),
    hasPasskey: vi.fn(() => true),
    registerPasskey: vi.fn(async () => undefined),
    secret,
  };
});

vi.mock("./passkey", () => ({
  createDeviceAuthProof: passkeyMocks.createDeviceAuthProof,
  derivePasskeySecret: passkeyMocks.derivePasskeySecret,
  hasPasskey: passkeyMocks.hasPasskey,
  registerPasskey: passkeyMocks.registerPasskey,
}));

import {
  createWalletWithPasskey,
  exportWallet,
  getLocalRecoveryStatus,
  lockWallet,
  markWalletBackupConfirmed,
} from "./localWallet";

describe("local wallet recovery", () => {
  beforeEach(() => {
    storeMocks.kv = new MemoryKVStore();
    storeMocks.open.mockImplementation(async () => storeMocks.kv);
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    lockWallet();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates a recoverable passkey wallet and exports with the backend unplugged", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("backend unplugged");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const account = await createWalletWithPasskey("alex");
    const expectedAccount = accountFromSignedMessage(passkeyMocks.secret);

    expect(account.address).toBe(expectedAccount.address);
    expect(account.spendSk).toBe(expectedAccount.spendSk);
    expect(passkeyMocks.registerPasskey).toHaveBeenCalledWith({ userName: "alex", displayName: "alex" });
    expect(fetchMock).toHaveBeenCalled();

    const backup = JSON.parse(await exportWallet()) as {
      evmPrivateKey: string;
      eercDecryptionKey: string;
      orgSpendId: string;
      mvkSeedHex: string;
    };

    expect(backup).toEqual({
      evmPrivateKey: expectedAccount.evmPrivateKey,
      eercDecryptionKey: expectedAccount.eercDecryptionKey,
      orgSpendId: expectedAccount.spendSk.toString(),
      mvkSeedHex: Array.from(passkeyMocks.secret, (x) => x.toString(16).padStart(2, "0")).join(""),
    });
    expect(getLocalRecoveryStatus()).toMatchObject({
      bound: true,
      recoverable: true,
      label: "Synced passkey",
      status: "healthy",
    });
  });

  it("records explicit backup confirmation in local recovery state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    await exportWallet();
    markWalletBackupConfirmed();

    expect(getLocalRecoveryStatus()).toMatchObject({
      backupConfirmedAt: expect.any(Number),
      label: "Synced passkey",
      recoverable: true,
    });
  });

  it("lets a legacy wallet with no recovery metadata reveal a backup later", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    localStorage.removeItem("benzo.recovery.v1");

    await expect(exportWallet()).resolves.toContain("evmPrivateKey");

    expect(getLocalRecoveryStatus()).toMatchObject({
      bound: false,
      label: "Backup revealed",
      recoverable: true,
      status: "healthy",
    });
  });
});
