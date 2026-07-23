import { ClientKeysView } from "@/features/client-keys/client-keys-view";
import { useClientKeysPageController } from "@/features/client-keys/use-client-keys-page-controller";

export function ClientKeysPage() {
  return <ClientKeysView controller={useClientKeysPageController()} />;
}
