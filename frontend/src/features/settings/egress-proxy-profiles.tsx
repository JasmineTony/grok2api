import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EgressProxyProfileFields,
  type EgressProxyProfileFieldsProps,
  type EgressProxyProfileFormValues,
} from "@/features/settings/egress-proxy-profile-form-fields";
import { showEgressError } from "@/features/settings/egress-feedback";
import {
  createEgressProxyProfile,
  deleteEgressProxyProfile,
  getEgressProxyProfileURL,
  listEgressProxyProfiles,
  updateEgressProxyProfile,
  type EgressProxyProfileDTO,
  type EgressProxyProfileListDTO,
} from "@/features/settings/settings-api";
import { ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { Pagination } from "@/shared/components/pagination";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { cn } from "@/shared/lib/cn";

const emptyForm: EgressProxyProfileFormValues = { name: "", proxyURL: "" };

type EgressProxyProfilesProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startCreating?: boolean;
  onCreated?: (profile: EgressProxyProfileDTO) => void;
};

/** 代理配置库：列表分页与新增/编辑/删除弹窗，列表、表单与确认弹窗各自独立。 */
export function EgressProxyProfiles({
  open,
  onOpenChange,
  startCreating = false,
  onCreated,
}: EgressProxyProfilesProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EgressProxyProfileDTO | null | undefined>(startCreating ? null : undefined);
  const [deleting, setDeleting] = useState<EgressProxyProfileDTO | undefined>();
  const [form, setForm] = useState<EgressProxyProfileFormValues>(emptyForm);
  const [proxyVisible, setProxyVisible] = useState(false);
  const [revealedProxyURL, setRevealedProxyURL] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ["egress-proxy-profiles", "page", page, pageSize, debouncedSearch],
    queryFn: () => listEgressProxyProfiles({ page, pageSize, search: debouncedSearch }),
    enabled: open && editing === undefined,
  });

  const save = useMutation({
    mutationFn: () => {
      const proxyURL = form.proxyURL.trim();
      const input = {
        name: form.name.trim(),
        proxyURL: proxyURL && proxyURL !== revealedProxyURL ? proxyURL : undefined,
      };
      return editing ? updateEgressProxyProfile(editing.id, input) : createEgressProxyProfile({ ...input, proxyURL });
    },
    onSuccess: (profile) => {
      const created = editing === null;
      void queryClient.invalidateQueries({ queryKey: ["egress-proxy-profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      setEditing(undefined);
      toast.success(t("egressProxyProfiles.saved"));
      if (created) onCreated?.(profile);
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const reveal = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error(t("egressProxyProfiles.revealUnavailable"));
      return getEgressProxyProfileURL(editing.id);
    },
    onSuccess: ({ proxyURL }) => {
      setRevealedProxyURL(proxyURL);
      setProxyVisible(true);
      setForm((current) => ({ ...current, proxyURL }));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEgressProxyProfile(id),
    onSuccess: () => {
      if (page > 1 && query.data?.items.length === 1) setPage(page - 1);
      void queryClient.invalidateQueries({ queryKey: ["egress-proxy-profiles"] });
      setDeleting(undefined);
      toast.success(t("egressProxyProfiles.deleted"));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });

  function openCreate() {
    setForm(emptyForm);
    setProxyVisible(false);
    setRevealedProxyURL("");
    setEditing(null);
  }

  function openEdit(value: EgressProxyProfileDTO) {
    setForm({ name: value.name, proxyURL: "" });
    setProxyVisible(false);
    setRevealedProxyURL("");
    setEditing(value);
  }

  const title =
    editing === undefined
      ? t("egressProxyProfiles.libraryTitle")
      : editing
        ? t("egressProxyProfiles.editTitle")
        : t("egressProxyProfiles.addTitle");
  const description =
    editing === undefined ? t("egressProxyProfiles.libraryDescription") : t("egressProxyProfiles.dialogDescription");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "max-h-[calc(100svh-2rem)]",
            editing === undefined
              ? "flex min-h-0 flex-col overflow-hidden sm:max-w-[720px]"
              : "overflow-y-auto sm:max-w-[520px]",
          )}
          data-testid="egress-proxy-profiles-dialog"
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {editing === undefined ? (
            <EgressProxyProfileLibrary
              query={query}
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
              onCreate={openCreate}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ) : (
            <EgressProxyProfileForm
              editing={editing}
              form={form}
              proxyVisible={proxyVisible}
              revealPending={reveal.isPending}
              savePending={save.isPending}
              onFormChange={(changes) => setForm((current) => ({ ...current, ...changes }))}
              onToggleProxyVisible={() => {
                if (revealedProxyURL) setProxyVisible((visible) => !visible);
                else reveal.mutate();
              }}
              onBack={() => setEditing(undefined)}
              onSave={() => save.mutate()}
            />
          )}
        </DialogContent>
      </Dialog>

      <EgressProxyProfileDeleteDialog
        deleting={deleting}
        pending={remove.isPending}
        onOpenChange={(next) => {
          if (!next) setDeleting(undefined);
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </>
  );
}

type EgressProxyProfileLibraryProps = {
  query: UseQueryResult<EgressProxyProfileListDTO>;
  search: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onCreate: () => void;
  onEdit: (profile: EgressProxyProfileDTO) => void;
  onDelete: (profile: EgressProxyProfileDTO) => void;
};

function EgressProxyProfileLibrary(props: EgressProxyProfileLibraryProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <EgressProxyProfileSearch value={props.search} onChange={props.onSearchChange} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="sm:ml-auto"
          onClick={props.onCreate}
          data-testid="egress-proxy-profiles-add"
        >
          <Plus />
          {t("egressProxyProfiles.add")}
        </Button>
      </div>
      <div className="max-h-[360px] min-h-0 overflow-auto rounded-md border">
        {props.query.isError ? (
          <ErrorState message={props.query.error.message} onRetry={() => void props.query.refetch()} />
        ) : null}
        {!props.query.isError ? (
          <EgressProxyProfileTable
            query={props.query}
            search={props.search}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        ) : null}
      </div>
      {props.query.data && props.query.data.total > 0 ? (
        <div className="shrink-0">
          <Pagination
            page={props.query.data.page}
            pageSize={props.query.data.pageSize}
            total={props.query.data.total}
            onPageChange={props.onPageChange}
            onPageSizeChange={props.onPageSizeChange}
          />
        </div>
      ) : null}
    </div>
  );
}

function EgressProxyProfileSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        className="h-8 pl-8 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("egressProxyProfiles.search")}
        aria-label={t("egressProxyProfiles.search")}
        data-testid="egress-proxy-profiles-search"
      />
    </div>
  );
}

function EgressProxyProfileTable({
  query,
  search,
  onEdit,
  onDelete,
}: Pick<EgressProxyProfileLibraryProps, "query" | "search" | "onEdit" | "onDelete">) {
  const { t } = useTranslation();
  if (query.isError) return null;
  return (
    <Table className="table-fixed" data-testid="egress-proxy-profiles-table">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[32%]">{t("egressProxyProfiles.name")}</TableHead>
          <TableHead>{t("egressProxyProfiles.endpoint")}</TableHead>
          <TableHead className="w-20 text-center">{t("egressProxyProfiles.nodes")}</TableHead>
          <TableActionHead />
        </TableRow>
      </TableHeader>
      {query.isPending ? (
        <TableBody>
          <TableLoadingRow colSpan={4} />
        </TableBody>
      ) : null}
      {!query.isPending && query.data.items.length === 0 ? (
        <EgressProxyProfilesEmptyRow filtered={Boolean(search)} />
      ) : null}
      {!query.isPending ? (
        <TableBody>
          {query.data.items.map((profile) => (
            <EgressProxyProfileRow key={profile.id} profile={profile} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </TableBody>
      ) : null}
    </Table>
  );
}

function EgressProxyProfilesEmptyRow({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation();
  return (
    <TableBody>
      <TableRow>
        <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">
          {t(filtered ? "egressProxyProfiles.noMatches" : "egressProxyProfiles.emptyLibrary")}
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

function EgressProxyProfileRow({
  profile,
  onEdit,
  onDelete,
}: {
  profile: EgressProxyProfileDTO;
  onEdit: (profile: EgressProxyProfileDTO) => void;
  onDelete: (profile: EgressProxyProfileDTO) => void;
}) {
  return (
    <TableRow data-testid={`egress-proxy-profile-row-${profile.id}`}>
      <TableCell>
        <span className="block truncate text-xs font-medium" title={profile.name}>
          {profile.name}
        </span>
      </TableCell>
      <TableCell>
        <div className="min-w-0" title={`${profile.proxyDisplay || ""} · ${profile.proxyFingerprint || ""}`}>
          <p className="truncate text-xs font-medium">{profile.proxyDisplay}</p>
          {profile.proxyFingerprint ? (
            <p className="font-mono text-[10px] text-muted-foreground">#{profile.proxyFingerprint}</p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-center text-xs tabular-nums" data-testid={`egress-proxy-profile-nodes-${profile.id}`}>
        {profile.boundNodeCount}
      </TableCell>
      <EgressProxyProfileActionsCell profile={profile} onEdit={onEdit} onDelete={onDelete} />
    </TableRow>
  );
}

function EgressProxyProfileActionsCell({
  profile,
  onEdit,
  onDelete,
}: {
  profile: EgressProxyProfileDTO;
  onEdit: (profile: EgressProxyProfileDTO) => void;
  onDelete: (profile: EgressProxyProfileDTO) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableActionCell>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("common.actions")}
            data-testid={`egress-proxy-profile-actions-${profile.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(profile)} data-testid={`egress-proxy-profile-edit-${profile.id}`}>
            <Pencil />
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={profile.boundNodeCount > 0}
            // Radix 的 disabled 只拦截它自己的 onSelect 语义，不会阻止原生 onClick，
            // 因此这里必须显式判空，否则「已绑定节点」的封锁只是文案、点击仍会打开删除确认。
            onClick={() => {
              if (profile.boundNodeCount > 0) return;
              onDelete(profile);
            }}
            data-testid={`egress-proxy-profile-delete-${profile.id}`}
          >
            <Trash2 />
            {profile.boundNodeCount > 0
              ? t("egressProxyProfiles.deleteBlocked", { count: profile.boundNodeCount })
              : t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableActionCell>
  );
}

type EgressProxyProfileFormProps = EgressProxyProfileFieldsProps & {
  savePending: boolean;
  onBack: () => void;
  onSave: () => void;
};

function EgressProxyProfileForm(props: EgressProxyProfileFormProps) {
  const { t } = useTranslation();
  const { editing, form, savePending, onBack, onSave } = props;
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-3 -ml-2 text-muted-foreground"
        onClick={onBack}
        data-testid="egress-proxy-profiles-back"
      >
        <ArrowLeft />
        {t("egressProxyProfiles.backToLibrary")}
      </Button>
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSave();
        }}
      >
        <EgressProxyProfileFields {...props} />
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onBack}
            data-testid="egress-proxy-profile-form-cancel"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={savePending || !form.name.trim() || (!editing && !form.proxyURL.trim())}
            data-testid="egress-proxy-profile-form-save"
          >
            {savePending ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function EgressProxyProfileDeleteDialog({
  deleting,
  pending,
  onOpenChange,
  onConfirm,
}: {
  deleting: EgressProxyProfileDTO | undefined;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={Boolean(deleting)} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="egress-proxy-profile-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("egressProxyProfiles.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("egressProxyProfiles.deleteDescription", { name: deleting?.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="egress-proxy-profile-delete-cancel">
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            data-testid="egress-proxy-profile-delete-confirm"
          >
            {pending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
