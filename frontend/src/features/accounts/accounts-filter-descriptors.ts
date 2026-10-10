import type { DataTableFilter, DataTableFilterOptionGroup } from "@/shared/components/data-table-filters";

import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { resolveEgressFilterLabel } from "@/features/accounts/accounts-egress-filter";
import type { Translate } from "@/features/accounts/accounts-view-model";

export type AccountFilterValues = {
  type: string;
  status: string;
  egress: string;
  egressSelectedLabel: string;
  renewal: string;
  risk: string;
  agreement: string;
  association: string;
};

export type AccountFilterChange = (value: string) => void;

export type AccountFilterChanges = {
  type: AccountFilterChange;
  status: AccountFilterChange;
  egress: AccountFilterChange;
  renewal: AccountFilterChange;
  risk: AccountFilterChange;
  agreement: AccountFilterChange;
  association: AccountFilterChange;
};

export type AccountFilterInput = {
  t: Translate;
  provider: AccountProvider;
  values: AccountFilterValues;
  onChange: AccountFilterChanges;
  egressGroups: DataTableFilterOptionGroup[];
  egressGroupSearch: { value: string; onChange: (value: string) => void };
  onEgressGroupsOpenChange: (open: boolean) => void;
  onEgressLabelChange: (label: string) => void;
};

export function buildAccountFilterDescriptors(input: AccountFilterInput): DataTableFilter[] {
  return [
    ...buildAccountTypeFilter(input),
    buildAccountStatusFilter(input),
    buildAccountEgressFilter(input),
    ...buildAccountRenewalFilter(input),
    ...buildAccountRiskFilter(input),
    ...buildAccountAgreementFilter(input),
    buildAccountAssociationFilter(input),
  ];
}

/** Console 池没有类型维度；Web 池的类型集合与 Build 池不同。 */
function buildAccountTypeFilter(input: AccountFilterInput): DataTableFilter[] {
  const { t, provider, values, onChange } = input;
  if (provider === "grok_console") return [];
  return [
    {
      id: "type",
      label: t("accountType.label"),
      value: values.type,
      onChange: onChange.type,
      options:
        provider === "grok_web"
          ? [
              { value: "auto", label: t("accountType.auto") },
              { value: "basic", label: t("accountType.free") },
              { value: "super", label: t("accountType.super") },
              { value: "heavy", label: t("accountType.heavy") },
            ]
          : [
              { value: "free", label: t("accountType.free") },
              { value: "paid", label: t("accountType.paid") },
              { value: "unknown", label: t("accountType.pending") },
            ],
    },
  ];
}

function buildAccountStatusFilter(input: AccountFilterInput): DataTableFilter {
  const { t, values, onChange } = input;
  return {
    id: "status",
    label: t("accounts.status"),
    value: values.status,
    onChange: onChange.status,
    options: [
      { value: "active", label: t("accounts.statusActive") },
      { value: "disabled", label: t("accounts.statusDisabled") },
      { value: "reauthRequired", label: t("accounts.statusReauthRequired") },
      { value: "cooldown", label: t("accounts.statusCooldown") },
      { value: "waitingReset", label: t("accounts.waitingReset") },
      { value: "probing", label: t("accounts.probing") },
    ],
  };
}

/** 出口筛选的“已绑定”选项带三级分组：节点与订阅源各自分页加载。 */
function buildAccountEgressFilter(input: AccountFilterInput): DataTableFilter {
  const { t, values, onChange, egressGroups, egressGroupSearch, onEgressGroupsOpenChange } = input;
  return {
    id: "egress",
    label: t("accounts.egressFilter"),
    value: values.egress,
    selectedLabel: values.egressSelectedLabel || undefined,
    onChange: (value) => {
      onChange.egress(value);
      input.onEgressLabelChange(resolveEgressFilterLabel(egressGroups, value));
    },
    options: [
      {
        value: "bound",
        label: t("accounts.egressBound"),
        groups: egressGroups,
        onGroupsOpenChange: onEgressGroupsOpenChange,
        groupSearch: { ...egressGroupSearch, placeholder: t("accounts.egressFilterOptionsSearch") },
      },
      { value: "unbound", label: t("accounts.egressUnbound") },
    ],
  };
}

function buildAccountRenewalFilter(input: AccountFilterInput): DataTableFilter[] {
  const { t, provider, values, onChange } = input;
  if (provider !== "grok_build") return [];
  return [
    {
      id: "renewal",
      label: t("accountCredential.label"),
      value: values.renewal,
      onChange: onChange.renewal,
      options: [
        { value: "refreshable", label: t("accountCredential.autoRefresh") },
        { value: "unrefreshable", label: t("accountCredential.noAutoRefresh") },
      ],
    },
  ];
}

function buildAccountRiskFilter(input: AccountFilterInput): DataTableFilter[] {
  const { t, provider, values, onChange } = input;
  if (provider !== "grok_build") return [];
  return [
    {
      id: "risk",
      label: t("accounts.riskFilter"),
      value: values.risk,
      onChange: onChange.risk,
      options: [
        { value: "flagged", label: t("accounts.botRisk") },
        { value: "normal", label: t("accounts.riskNormal") },
      ],
    },
  ];
}

function buildAccountAgreementFilter(input: AccountFilterInput): DataTableFilter[] {
  const { t, provider, values, onChange } = input;
  if (provider !== "grok_web") return [];
  return [
    {
      id: "agreement",
      label: t("accounts.agreementFilter"),
      value: values.agreement,
      onChange: onChange.agreement,
      options: [
        { value: "nsfwEnabled", label: t("accounts.agreementNsfwEnabled") },
        { value: "nsfwDisabled", label: t("accounts.agreementNsfwDisabled") },
        { value: "termsAccepted", label: t("accounts.agreementTermsAccepted") },
        { value: "termsNotAccepted", label: t("accounts.agreementTermsNotAccepted") },
        { value: "allAccepted", label: t("accounts.agreementAllAccepted") },
        { value: "allNotAccepted", label: t("accounts.agreementAllNotAccepted") },
      ],
    },
  ];
}

function buildAccountAssociationFilter(input: AccountFilterInput): DataTableFilter {
  const { t, provider, values, onChange } = input;
  return {
    id: "association",
    label: t("accounts.associationFilter"),
    value: values.association,
    onChange: onChange.association,
    options:
      provider === "grok_web"
        ? [
            { value: "buildLinked", label: t("accounts.associationBuildLinked") },
            { value: "buildUnlinked", label: t("accounts.associationBuildUnlinked") },
            { value: "consoleLinked", label: t("accounts.associationConsoleLinked") },
            { value: "consoleUnlinked", label: t("accounts.associationConsoleUnlinked") },
            { value: "allLinked", label: t("accounts.associationAllLinked") },
            { value: "allUnlinked", label: t("accounts.associationAllUnlinked") },
          ]
        : [
            { value: "webLinked", label: t("accounts.associationWebLinked") },
            { value: "webUnlinked", label: t("accounts.associationWebUnlinked") },
          ],
  };
}
