"use client";

import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useMemo, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider } from "wagmi";
import { arbitrumSepoliaChain } from "@/config/chains";
import { config } from "@/config/wagmi";

const darkRainbow = darkTheme({
  accentColor: "#3ef0ff",
  accentColorForeground: "#041016",
  borderRadius: "large",
  overlayBlur: "small",
});
darkRainbow.colors.modalBackground = "#101a2e";
darkRainbow.colors.modalBackdrop = "rgba(5, 8, 18, 0.72)";
darkRainbow.colors.modalBorder = "rgba(62, 240, 255, 0.22)";
darkRainbow.colors.generalBorder = "rgba(120, 210, 240, 0.16)";
darkRainbow.colors.menuItemBackground = "rgba(62, 240, 255, 0.08)";
darkRainbow.colors.profileForeground = "#101a2e";
darkRainbow.colors.connectButtonBackground = "rgba(16, 28, 48, 0.72)";
darkRainbow.colors.connectButtonInnerBackground = "rgba(62, 240, 255, 0.1)";
darkRainbow.colors.closeButtonBackground = "rgba(62, 240, 255, 0.08)";

const lightRainbow = lightTheme({
  accentColor: "#0c7c93",
  accentColorForeground: "#f7fbff",
  borderRadius: "large",
  overlayBlur: "small",
});
lightRainbow.colors.modalBackground = "#ffffff";
lightRainbow.colors.modalBorder = "rgba(16, 40, 64, 0.12)";
lightRainbow.colors.generalBorder = "rgba(16, 40, 64, 0.1)";
lightRainbow.colors.connectButtonBackground = "#ffffff";
lightRainbow.colors.connectButtonInnerBackground = "rgba(12, 124, 147, 0.08)";

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  browserQueryClient ??= new QueryClient();
  return browserQueryClient;
}

function WalletFrame({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const theme = useMemo(() => (resolvedTheme === "light" ? lightRainbow : darkRainbow), [resolvedTheme]);
  return (
    <RainbowKitProvider initialChain={arbitrumSepoliaChain} theme={theme}>
      {children}
    </RainbowKitProvider>
  );
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
        <WalletFrame>{children}</WalletFrame>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
