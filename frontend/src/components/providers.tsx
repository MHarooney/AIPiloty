"use client";

import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/i18n";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
