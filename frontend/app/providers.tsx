"use client";

import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider } from "wagmi";
import { arbitrumSepoliaChain } from "@/config/chains";
import { config } from "@/config/wagmi";

const rainbowTheme = darkTheme({
  accentColor: "#3ef0ff",
  accentColorForeground: "#041016",
  borderRadius: "large",
  overlayBlur: "small",
});
rainbowTheme.colors.modalBackground = "#101a2e";
rainbowTheme.colors.modalBackdrop = "rgba(5, 8, 18, 0.72)";
rainbowTheme.colors.modalBorder = "rgba(62, 240, 255, 0.22)";
rainbowTheme.colors.generalBorder = "rgba(120, 210, 240, 0.16)";
rainbowTheme.colors.menuItemBackground = "rgba(62, 240, 255, 0.08)";
rainbowTheme.colors.profileForeground = "#101a2e";
rainbowTheme.colors.connectButtonBackground = "rgba(16, 28, 48, 0.72)";
rainbowTheme.colors.connectButtonInnerBackground = "rgba(62, 240, 255, 0.1)";
rainbowTheme.colors.closeButtonBackground = "rgba(62, 240, 255, 0.08)";

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  browserQueryClient ??= new QueryClient();
  return browserQueryClient;
}

type ProvidersProps = {
  children: ReactNode;
  cookie?: string | null;
};

export function Providers({ children, cookie }: ProvidersProps) {
  const initialState = cookieToInitialState(config, cookie);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={getQueryClient()}>
        <RainbowKitProvider
          initialChain={arbitrumSepoliaChain}
          theme={rainbowTheme}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
