import { createPublicClient, http } from "viem";
import { ACTIVE_CHAIN, ENCRYPTED_ERC_ADDRESS, RPC_URL } from "./network";

export { ENCRYPTED_ERC_ADDRESS, RPC_URL };

export interface ChainStatus {
  sequence: number;
  protocolVersion: number;
  closedAt?: number;
}

export const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN,
  transport: http(RPC_URL),
});

export async function getChainStatus(_signal?: AbortSignal): Promise<ChainStatus> {
  const block = await publicClient.getBlock();
  return {
    sequence: Number(block.number),
    protocolVersion: ACTIVE_CHAIN.id,
    closedAt: block.timestamp ? Number(block.timestamp) : undefined,
  };
}

export async function verifyBalanceProofOnChain(_proof: unknown, _publics: string[]): Promise<boolean> {
  return false;
}

export function explorerTx(hash: string): string {
  return `${ACTIVE_CHAIN.blockExplorers?.default.url ?? ""}/tx/${hash}`;
}

export function eercConfigured(): boolean {
  return Boolean(ENCRYPTED_ERC_ADDRESS);
}
