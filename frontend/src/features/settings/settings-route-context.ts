import { createContext, useContext } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { SettingsSnapshotDTO } from "@/features/settings/settings-api";
import type { SettingsForm } from "@/features/settings/settings-model";

type SettingsRouteContextValue = {
  form: UseFormReturn<SettingsForm>;
  snapshot: SettingsSnapshotDTO;
  loading: boolean;
  updatePending: boolean;
  syncRecommendedBuild: () => void;
};

export const SettingsRouteContext = createContext<SettingsRouteContextValue | null>(null);

export function useSettingsRoute(): SettingsRouteContextValue {
  const value = useContext(SettingsRouteContext);
  if (!value) throw new Error("Settings routes must render inside SettingsRouteShell");
  return value;
}
