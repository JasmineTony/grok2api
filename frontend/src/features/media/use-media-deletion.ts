import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type MediaDeletedResult = { deleted: number };

export type MediaDeletionInput = {
  /** 待删除的选中 ID。 */
  ids: readonly string[];
  deleteRequest: (ids: string[]) => Promise<MediaDeletedResult>;
  invalidateKey: readonly string[];
  /** 成功提示的 i18n key，形如 media.images.deleted。 */
  deletedMessageKey: string;
  /** 整页被删除且不在首页时为 true，成功后回退一页。 */
  trimPage: boolean;
  page: number;
  onPageChange: (page: number) => void;
  /** 页面级清理（清空选中、关闭预览），在选中集合被重置之前调用。 */
  onRemoved?: () => void;
};

export type MediaDeletion = {
  confirmOpen: boolean;
  isPending: boolean;
  requestConfirm: () => void;
  closeConfirm: () => void;
  confirm: () => void;
};

/** 媒体删除：确认弹窗开合、分页回退、缓存失效与成功/失败提示。 */
export function useMediaDeletion(input: MediaDeletionInput): MediaDeletion {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => input.deleteRequest([...input.ids]),
    onSuccess: (result) => {
      if (input.trimPage) input.onPageChange(input.page - 1);
      input.onRemoved?.();
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: input.invalidateKey });
      toast.success(t(input.deletedMessageKey, { count: result.deleted }));
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: input.invalidateKey });
      toast.error(error instanceof Error ? error.message : t("errors.generic"));
    },
  });

  return {
    confirmOpen,
    isPending: mutation.isPending,
    requestConfirm: () => setConfirmOpen(true),
    closeConfirm: () => setConfirmOpen(false),
    confirm: () => mutation.mutate(),
  };
}
