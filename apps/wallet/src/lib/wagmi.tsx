import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ACTIVE_CHAIN, RPC_URL } from "./network";

export const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [ACTIVE_CHAIN],
  connectors: [injected()],
  transports: {
    [ACTIVE_CHAIN.id]: http(RPC_URL),
  },
  ssr: false,
});
