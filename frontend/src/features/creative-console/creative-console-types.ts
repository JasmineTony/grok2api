import type { ModelRouteDTO } from "@/entities/model/types";

export type CreativePanelProps = {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
};
