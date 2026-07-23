import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ClientKeysPageController } from "@/features/client-keys/use-client-keys-page-controller";
import { CopyButton } from "@/shared/components/copy-button";

export function ClientKeyDialogs({ controller }: { controller: ClientKeysPageController }) {
  const {
    t,
    selected,
    batchDeleteOpen,
    setBatchDeleteOpen,
    deleting,
    setDeleting,
    secretDialog,
    setSecretDialog,
    deleteMutation,
    batchDeleteMutation,
  } = controller;

  return (
    <>
      <Dialog open={secretDialog !== null} onOpenChange={(open) => !open && setSecretDialog(null)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {t(secretDialog?.source === "created" ? "keys.secretTitle" : "keys.copySecretTitle")}
            </DialogTitle>
            <DialogDescription>
              {t(
                secretDialog?.source === "created"
                  ? "keys.secretDescription"
                  : "keys.copySecretDescription",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-1.5">
            <Label>{t("keys.secretLabel")}</Label>
            <div className="flex h-8 w-full min-w-0 overflow-hidden rounded-md border border-input bg-secondary/55">
              <code className="flex min-w-0 flex-1 select-all items-center overflow-x-auto whitespace-nowrap px-3 font-mono text-xs text-muted-foreground">
                {secretDialog?.secret ?? ""}
              </code>
              <CopyButton
                value={secretDialog?.secret ?? ""}
                copyLabel={t("keys.copySecret")}
                disabled={!secretDialog?.secret}
                className="h-full w-8 shrink-0 rounded-none border-l"
                onCopied={() => toast.success(t("common.copied"))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSecretDialog(null)}
            >
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("keys.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("keys.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("keys.batchDeleteTitle", { count: selected.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("keys.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => batchDeleteMutation.mutate()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
