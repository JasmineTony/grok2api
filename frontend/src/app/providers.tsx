import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ApiClientProvider } from "@/shared/api/api-client-provider";
import { AuthProvider } from "@/shared/auth/auth-context";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ApiClientProvider>
        <AuthProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </AuthProvider>
      </ApiClientProvider>
    </ThemeProvider>
  );
}
