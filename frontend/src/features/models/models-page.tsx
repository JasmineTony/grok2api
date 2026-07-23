import { ModelsView } from "@/features/models/models-view";
import { useModelsPageController } from "@/features/models/use-models-page-controller";

export function ModelsPage() {
  return <ModelsView controller={useModelsPageController()} />;
}
