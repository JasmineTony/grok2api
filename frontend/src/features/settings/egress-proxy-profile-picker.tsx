import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  getEgressProxyProfile,
  listEgressProxyProfiles,
  type EgressProxyProfileDTO,
  type EgressProxyProfileListDTO,
} from "@/features/settings/settings-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { cn } from "@/shared/lib/cn";

const pickerPageSize = 20;

function selectionLabel(t: TFunction, value: string, selected: UseQueryResult<EgressProxyProfileDTO>): string {
  if (value === "manual") return t("egressProxyProfiles.independent");
  if (selected.data) return `${selected.data.name} · ${selected.data.proxyDisplay || "—"}`;
  if (selected.isError) return t("egressProxyProfiles.selectionUnavailable", { id: value });
  return t("egressProxyProfiles.loadingSelection");
}

/** 节点表单里的代理配置选择器：可选独立代理或复用代理配置库中的条目。 */
export function ProxyProfilePicker({
  value,
  onChange,
  onCreate,
}: {
  value: string;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);
  const profiles = useQuery({
    queryKey: ["egress-proxy-profiles", "picker", page, debouncedSearch],
    queryFn: () => listEgressProxyProfiles({ page, pageSize: pickerPageSize, search: debouncedSearch }),
    enabled: open,
    staleTime: 30_000,
  });
  const selected = useQuery({
    queryKey: ["egress-proxy-profiles", "selected", value],
    queryFn: () => getEgressProxyProfile(value),
    enabled: value !== "manual",
    staleTime: 30_000,
  });

  return (
    <ProxyProfilePickerPopover
      open={open}
      label={selectionLabel(t, value, selected)}
      onOpenChange={setOpen}
      onResetPage={() => setPage(1)}
    >
      <ProxyProfilePickerContent
        profiles={profiles}
        value={value}
        page={page}
        search={search}
        onChangeSearch={setSearch}
        onChangePage={setPage}
        onChoose={onChange}
        onClose={() => setOpen(false)}
        onCreate={onCreate}
      />
    </ProxyProfilePickerPopover>
  );
}

function ProxyProfilePickerPopover({
  open,
  label,
  onOpenChange,
  onResetPage,
  children,
}: {
  open: boolean;
  label: string;
  onOpenChange: (open: boolean) => void;
  onResetPage: () => void;
  children: ReactNode;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) onResetPage();
      }}
    >
      <ProxyProfilePickerTrigger label={label} open={open} />
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ProxyProfilePickerTrigger({ label, open }: { label: string; open: boolean }) {
  return (
    <PopoverTrigger asChild>
      <Button
        id="egress-proxy-profile"
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between px-3 font-normal"
        data-testid="egress-proxy-profile-picker"
      >
        <span className="truncate text-left">{label}</span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
  );
}

type ProxyProfilePickerContentProps = {
  profiles: UseQueryResult<EgressProxyProfileListDTO>;
  value: string;
  page: number;
  search: string;
  onChangeSearch: (value: string) => void;
  onChangePage: (page: number) => void;
  onChoose: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

function ProxyProfilePickerContent(props: ProxyProfilePickerContentProps) {
  const pages = Math.max(1, Math.ceil((props.profiles.data?.total ?? 0) / pickerPageSize));

  function changeSearch(next: string) {
    props.onChangeSearch(next);
    props.onChangePage(1);
  }

  function choose(next: string) {
    props.onChoose(next);
    props.onClose();
  }

  function create() {
    props.onClose();
    props.onCreate();
  }

  return (
    <>
      <ProxyProfilePickerSearch value={props.search} onChange={changeSearch} />
      <ProxyProfilePickerList value={props.value} profiles={props.profiles} onChoose={choose} />
      <ProxyProfilePickerPager
        page={props.page}
        pages={pages}
        total={props.profiles.data?.total ?? 0}
        onPageChange={props.onChangePage}
      />
      <ProxyProfilePickerCreate onCreate={create} />
    </>
  );
}

function ProxyProfilePickerSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
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
        data-testid="egress-proxy-profile-picker-search"
      />
    </div>
  );
}

function ProxyProfilePickerList({
  value,
  profiles,
  onChoose,
}: Pick<ProxyProfilePickerContentProps, "value" | "profiles" | "onChoose">) {
  const { t } = useTranslation();
  const empty = !profiles.isPending && !profiles.isError && profiles.data?.items.length === 0;
  return (
    <div
      className="mt-2 max-h-56 space-y-0.5 overflow-y-auto overscroll-contain"
      role="listbox"
      aria-label={t("egressProxyProfiles.assignment")}
    >
      <ManualProfileOption selected={value === "manual"} onChoose={() => onChoose("manual")} />
      {profiles.isPending ? (
        <div className="flex min-h-16 items-center justify-center">
          <Spinner />
        </div>
      ) : null}
      {profiles.isError ? <p className="p-3 text-center text-xs text-destructive">{profiles.error.message}</p> : null}
      {empty ? (
        <p className="p-3 text-center text-xs text-muted-foreground">{t("egressProxyProfiles.noMatches")}</p>
      ) : null}
      {profiles.data?.items.map((profile) => (
        <ProfileOption
          key={profile.id}
          profile={profile}
          selected={value === profile.id}
          onChoose={() => onChoose(profile.id)}
        />
      ))}
    </div>
  );
}

function ManualProfileOption({ selected, onChoose }: { selected: boolean; onChoose: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent",
        selected && "bg-accent/60",
      )}
      onClick={onChoose}
      data-testid="egress-proxy-profile-option-manual"
    >
      <Check className={cn("size-3.5 shrink-0", !selected && "invisible")} />
      <span className="truncate">{t("egressProxyProfiles.independent")}</span>
    </button>
  );
}

function ProfileOption({
  profile,
  selected,
  onChoose,
}: {
  profile: EgressProxyProfileDTO;
  selected: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent",
        selected && "bg-accent/60",
      )}
      onClick={onChoose}
      data-testid={`egress-proxy-profile-option-${profile.id}`}
    >
      <Check className={cn("size-3.5 shrink-0", !selected && "invisible")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{profile.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {profile.proxyDisplay || "—"} · {t("egressProxyProfiles.nodeCount", { count: profile.boundNodeCount })}
        </span>
      </span>
    </button>
  );
}

function ProxyProfilePickerPager({
  page,
  pages,
  total,
  onPageChange,
}: {
  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (total <= pickerPageSize) return null;
  return (
    <div className="mt-2 flex h-8 items-center justify-between border-t px-1 pt-2">
      <span className="text-[11px] text-muted-foreground">{t("common.pageOf", { page, pages })}</span>
      <div className="flex gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("common.previousPage")}
          data-testid="egress-proxy-profile-picker-prev"
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("common.nextPage")}
          data-testid="egress-proxy-profile-picker-next"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function ProxyProfilePickerCreate({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 border-t pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={onCreate}
        data-testid="egress-proxy-profile-picker-create"
      >
        <Plus />
        {t("egressProxyProfiles.createFromPicker")}
      </Button>
    </div>
  );
}
