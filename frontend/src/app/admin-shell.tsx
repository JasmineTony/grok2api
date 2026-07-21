import { AdminProviders } from "@/app/admin-providers";
import { AppShell } from "@/app/app-shell";

export function AdminShell() {
  return (
    <AdminProviders>
      <AppShell />
    </AdminProviders>
  );
}
