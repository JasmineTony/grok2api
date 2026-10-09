import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { checkForUpdates, getVersionInfo, type VersionInfoDTO } from "@/entities/system/system-api";

// 版本信息的数据获取层：与展示组件（version-update.tsx）分离，
// 便于按 AGENTS.md TEST-2 对该 hook 文件单独设置 100% 覆盖率门槛。
const versionQueryKey = ["system-version"] as const;

export function useVersionInfo(): UseQueryResult<VersionInfoDTO, Error> {
  return useQuery({
    queryKey: versionQueryKey,
    queryFn: getVersionInfo,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useCheckForUpdates(): UseMutationResult<VersionInfoDTO, Error, void, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (value) => queryClient.setQueryData(versionQueryKey, value),
  });
}
