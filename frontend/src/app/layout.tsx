import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import Providers from "@/components/providers";
import OnboardingWizard from "@/components/onboarding-wizard";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AIPiloty — AI DevOps Assistant",
  description: "AI-powered DevOps assistant for deployments, SSH, and document generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. ClickUp) may inject classes on <body> */}
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrains.variable} font-sans antialiased bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen transition-colors duration-300`}
      >
        <Providers>
          <OnboardingWizard />
          {children}
        </Providers>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
