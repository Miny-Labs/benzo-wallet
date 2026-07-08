import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registryMocks = vi.hoisted(() => ({ handleAvailableOnChain: vi.fn() }));
vi.mock("./handleRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./handleRegistry")>()),
  handleAvailableOnChain: registryMocks.handleAvailableOnChain,
}));

const clientMocks = vi.hoisted(() => ({
  getLocalAccountSummary: vi.fn(),
  readPublicBalanceClientSide: vi.fn(),
  shieldPublicUsdcClientSide: vi.fn(),
  unshieldPrivateUsdcClientSide: vi.fn(),
}));

vi.mock("./benzoClient", () => ({
  readPublicBalanceClientSide: clientMocks.readPublicBalanceClientSide,
  shieldPublicUsdcClientSide: clientMocks.shieldPublicUsdcClientSide,
  unshieldPrivateUsdcClientSide: clientMocks.unshieldPrivateUsdcClientSide,
}));

vi.mock("./localWallet", () => ({
  getLocalAccountSummary: clientMocks.getLocalAccountSummary,
}));

import {
  api,
  apiHref,
  AUTH_REQUIRED_EVENT,
  credentialLooksWellFormed,
  prepareApiRequest,
} from "./api";

const ADDRESS = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;
const SHIELD_TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const UNSHIELD_TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function callHeaders(call: unknown[]): Headers {
  return call[1] instanceof Object && "headers" in call[1]
    ? call[1].headers as Headers
    : new Headers();
}

describe("wallet API on Avalanche services/api", () => {
  beforeEach(() => {
    clientMocks.getLocalAccountSummary.mockReturnValue({ address: ADDRESS });
    clientMocks.readPublicBalanceClientSide.mockResolvedValue("0");
    clientMocks.shieldPublicUsdcClientSide.mockResolvedValue({ txHash: SHIELD_TX, prover: "local" });
    clientMocks.unshieldPrivateUsdcClientSide.mockResolvedValue({ txHash: UNSHIELD_TX, prover: "local" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses cookie credentials and reuses idempotency keys until a write completes", () => {
    const first = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });
    const retry = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });

    const firstKey = (first.init.headers as Headers).get("idempotency-key");
    const retryKey = (retry.init.headers as Headers).get("idempotency-key");
    expect(first.url).toBe(apiHref("/handles"));
    expect(first.init.credentials).toBe("include");
    expect((first.init.headers as Headers).get("authorization")).toBeNull();
    expect(firstKey).toMatch(/^idem_/);
    expect(retryKey).toBe(firstKey);

    first.clearIdempotency?.();
    const next = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });
    expect((next.init.headers as Headers).get("idempotency-key")).not.toBe(firstKey);
  });

  it("signs in with SIWE using nonce and verify endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ nonce: "abc12345", expiresAt: "2026-07-07T00:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ user: { address: ADDRESS, id: "usr_1", roles: ["user"] } }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "0x1234" as const);

    await expect(api.signInWithSiwe(ADDRESS, signMessage)).resolves.toMatchObject({
      user: { address: ADDRESS },
    });

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref(`/auth/nonce?address=${encodeURIComponent(ADDRESS)}`));
    expect(fetchMock.mock.calls[1][0]).toBe(apiHref("/auth/verify"));
    const verifyBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      message: string;
      signature: string;
    };
    expect(verifyBody.message).toContain("Sign in to Benzo Wallet.");
    expect(verifyBody.message).toContain("abc12345");
    expect(verifyBody.signature).toBe("0x1234");
    expect(localStorage.getItem("benzo.siweAddress")).toBe(ADDRESS.toLowerCase());
  });

  it("maps /auth/me into the wallet session shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      user: { address: ADDRESS, id: "usr_1", roles: ["user"] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.session()).resolves.toMatchObject({
      handle: ADDRESS,
      live: true,
      mode: "live",
      prover: { available: ["local"], mode: "local", location: "local" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/auth/me"));
  });

  it("reads handle availability from the on-chain registry, not the BFF", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("BFF must not be called")));
    vi.stubGlobal("fetch", fetchMock);
    registryMocks.handleAvailableOnChain
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce({ available: false });

    await expect(api.handleAvailable("@alice")).resolves.toEqual({ available: true });
    await expect(api.handleAvailable("@alice")).resolves.toEqual({ available: false });
    expect(registryMocks.handleAvailableOnChain).toHaveBeenCalledWith("@alice");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates gift-link invites against /invites", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      invite: {
        expiresAt: "2026-07-08T00:00:00.000Z",
        id: "inv_1",
        kind: "gift",
        note: "coffee",
        status: "created",
      },
      token: "tok_1",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.invite("2500000", "coffee")).resolves.toMatchObject({
      amount: "2500000",
      link: "http://localhost:3000/claim?token=tok_1",
      localId: "inv_1",
      onChain: false,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/invites"));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      giftAmount: "2500000",
      kind: "gift",
      note: "coffee",
    });
  });

  it("maps /activity as optional indexer hints without fabricating display amounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      activity: [{
        blockNumber: "56879309",
        eventName: "PrivateTransfer",
        logIndex: 4,
        links: [
          [],
          { label: "Gift claim", objectType: "invite" },
          null,
        ],
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toAddr: ADDRESS,
        blockTime: "2026-07-07T00:00:00.000Z",
      }],
      nextCursor: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const hints = await api.activityHints();
    expect(hints).toEqual([expect.objectContaining({
      blockNumber: 56879309n,
      eventName: "PrivateTransfer",
      logIndex: 4,
      timestamp: 1_783_382_400,
      toAddr: ADDRESS,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })]);
    expect(hints[0]?.links).toEqual([{ label: "Gift claim", objectType: "invite" }]);
    await expect(api.history()).resolves.toEqual([]);
  });

  it("times out hanging read requests with a clean error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.session();
    const assertion = expect(pending).rejects.toThrow("This is taking too long. Please try again.");
    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("clears SIWE state when the API requires sign-in again", async () => {
    localStorage.setItem("benzo.siweAddress", ADDRESS.toLowerCase());
    localStorage.setItem("benzo.onboarded", "1");
    const onAuthRequired = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "SIWE session required" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.session()).rejects.toThrow("SIWE session required");

    expect(localStorage.getItem("benzo.siweAddress")).toBeNull();
    expect(localStorage.getItem("benzo.onboarded")).toBeNull();
    expect(onAuthRequired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  });

  it("classifies stored SIWE addresses before protected screens mount", () => {
    expect(credentialLooksWellFormed(null)).toBe(false);
    expect(credentialLooksWellFormed("benzo-test.not-json.sig")).toBe(false);
    expect(credentialLooksWellFormed("0xabc")).toBe(false);
    expect(credentialLooksWellFormed(ADDRESS.toLowerCase())).toBe(true);
  });

  it("shields public USDC through the local eERC client with the backend unplugged", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("backend unplugged"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.importDeposit("1", "local")).resolves.toMatchObject({
      amount: "1000000",
      onChain: true,
      prover: "local",
      status: "settled",
      txHash: SHIELD_TX,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientMocks.shieldPublicUsdcClientSide).toHaveBeenCalledWith(
      "1000000",
      expect.stringContaining("make-private"),
    );
    const history = JSON.parse(localStorage.getItem("benzo.history.local.v1") ?? "[]") as Array<Record<string, unknown>>;
    expect(history[0]).toMatchObject({
      amount: "1000000",
      direction: "in",
      id: SHIELD_TX,
      name: "Made private",
      status: "settled",
      txHash: SHIELD_TX,
      type: "shield",
    });
  });

  it("shields the full public balance for Deposit Make private without the backend", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("backend unplugged"));
    vi.stubGlobal("fetch", fetchMock);
    clientMocks.readPublicBalanceClientSide.mockResolvedValue("2500000");

    await expect(api.importDeposit(undefined, "local")).resolves.toMatchObject({
      amount: "2500000",
      onChain: true,
      txHash: SHIELD_TX,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientMocks.shieldPublicUsdcClientSide).toHaveBeenCalledWith(
      "2500000",
      expect.any(String),
    );
  });

  it("rejects a negative shield amount instead of shielding the full public balance", async () => {
    clientMocks.readPublicBalanceClientSide.mockResolvedValue("2500000");

    await expect(api.importDeposit("-1", "local")).rejects.toThrow("Enter a valid USDC amount.");

    expect(clientMocks.readPublicBalanceClientSide).not.toHaveBeenCalled();
    expect(clientMocks.shieldPublicUsdcClientSide).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric shield amount with the invalid amount error", async () => {
    clientMocks.readPublicBalanceClientSide.mockResolvedValue("2500000");

    await expect(api.importDeposit("NaN", "local")).rejects.toThrow("Enter a valid USDC amount.");

    expect(clientMocks.readPublicBalanceClientSide).not.toHaveBeenCalled();
    expect(clientMocks.shieldPublicUsdcClientSide).not.toHaveBeenCalled();
  });

  it("unshields private USDC through the local eERC client with the backend unplugged", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("backend unplugged"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.makePublic("2.5", "local")).resolves.toMatchObject({
      amount: "2500000",
      onChain: true,
      prover: "local",
      status: "settled",
      txHash: UNSHIELD_TX,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientMocks.unshieldPrivateUsdcClientSide).toHaveBeenCalledWith(
      "2500000",
      expect.stringContaining("make-public"),
    );
    const history = JSON.parse(localStorage.getItem("benzo.history.local.v1") ?? "[]") as Array<Record<string, unknown>>;
    expect(history[0]).toMatchObject({
      amount: "2500000",
      direction: "out",
      id: UNSHIELD_TX,
      name: "Made public",
      status: "settled",
      txHash: UNSHIELD_TX,
      type: "unshield",
    });
  });

  it("routes Cash shield and unshield through the same client-side paths", async () => {
    await expect(api.addMoney("3", "local")).resolves.toMatchObject({ amount: "3000000", txHash: SHIELD_TX });
    await expect(api.cashOut("4", "local")).resolves.toMatchObject({ amount: "4000000", txHash: UNSHIELD_TX });

    expect(clientMocks.shieldPublicUsdcClientSide).toHaveBeenCalledWith("3000000", expect.any(String));
    expect(clientMocks.unshieldPrivateUsdcClientSide).toHaveBeenCalledWith("4000000", expect.any(String));
  });

  it("returns local deposit info without requiring services/api", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("backend unplugged"));
    vi.stubGlobal("fetch", fetchMock);
    clientMocks.readPublicBalanceClientSide.mockResolvedValue("9000000");

    await expect(api.depositInfo()).resolves.toEqual({
      address: ADDRESS,
      asset: "USDC",
      issuer: "",
      liquid: "9000000",
      live: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
