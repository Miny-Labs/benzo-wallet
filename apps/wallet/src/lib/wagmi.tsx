import type { DeploymentNetwork } from "@benzo/config";
import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { resolveNetworkConfig } from "./network";

/** Build a wagmi config bound to a single network — rebuilt whenever the user switches. */
export function createWagmiConfig(network: DeploymentNetwork) {
  const { chain, rpcUrl } = resolveNetworkConfig(network);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: {
      [chain.id]: http(rpcUrl),
    },
    ssr: false,
  });
}

/** A fresh query cache per network so reads from the previous chain don't bleed through. */
export function createQueryClient(): QueryClient {
  return new QueryClient();
}
