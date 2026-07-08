import type { BenzoAccount } from "@benzo/core";
import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptedErcActivityAbi,
  mergeActivityRows,
  readEercActivityClientSide,
} from "./eercActivity";
import type { ActivityRow } from "./api";

const ACCOUNT = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as Address;
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = ACCOUNT;
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function proof(publicSignals: bigint[]) {
  return {
    proofPoints: {
      a: [0n, 0n],
      b: [
        [0n, 0n],
        [0n, 0n],
      ],
      c: [0n, 0n],
    },
    publicSignals,
  };
}

function transferInput(amount: bigint) {
  const signals = Array.from({ length: 32 }, () => 0n);
  signals[16] = amount;
  return encodeFunctionData({
    abi: encryptedErcActivityAbi,
    functionName: "transfer",
    args: [RECIPIENT, 1n, proof(signals), [0n, 0n, 0n, 0n, 0n, 0n, 0n]],
  });
}

describe("eERC RPC activity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("decrypts an incoming PrivateTransfer from logs and calldata without the BFF", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string }; args: Record<string, string> }) => {
        if (params.event.name === "PrivateTransfer" && params.args.to === ACCOUNT) {
          return [{
            args: { from: SENDER, to: ACCOUNT },
            blockNumber: 56879309n,
            eventName: "PrivateTransfer",
            logIndex: 4,
            transactionHash: TX,
          }];
        }
        return [];
      }),
      getTransaction: vi.fn().mockResolvedValue({ input: transferInput(4_200_000n) }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = {
      decryptPCT: vi.fn((pct: bigint[]) => pct[0]),
      getHistoricalBalance: vi.fn(),
    };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        amount: "4200000",
        direction: "in",
        name: "0x1111...1111",
        status: "settled",
        txHash: TX,
        type: "receive",
      }),
    ]);
    expect(eerc.decryptPCT).toHaveBeenCalledWith(expect.arrayContaining([4_200_000n]));
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      args: { to: ACCOUNT },
      fromBlock: 56879304n,
      toBlock: 56879310n,
    }));
  });

  it("lets chain rows replace same-tx local rows so amounts are not stale", () => {
    const local: ActivityRow = {
      id: TX,
      type: "send",
      name: "@mara",
      note: "coffee",
      amount: "1",
      direction: "out",
      status: "settled",
      timestamp: 10,
      txHash: TX,
    };
    const chain: ActivityRow = {
      ...local,
      name: "0x2222...2222",
      note: "Private eERC transfer proved locally.",
      amount: "2500000",
      timestamp: 20,
    };

    expect(mergeActivityRows([local], [chain])).toEqual([
      expect.objectContaining({
        amount: "2500000",
        name: "@mara",
        note: "coffee",
        timestamp: 20,
      }),
    ]);
  });
});
