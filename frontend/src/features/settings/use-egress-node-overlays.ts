import { useState } from "react";

export type EgressNodeOverlays = {
  batchDeleteOpen: boolean;
  setBatchDeleteOpen: (open: boolean) => void;
  cleanupOpen: boolean;
  setCleanupOpen: (open: boolean) => void;
  profileLibraryOpen: boolean;
  profileLibraryCreate: boolean;
  setProfileLibraryOpen: (open: boolean) => void;
  setProfileLibraryCreate: (create: boolean) => void;
  openProfileLibrary: (create: boolean) => void;
};

/**
 * 出口节点分区的弹窗开关：批量删除确认、清理不可用节点与代理配置库。
 * 代理配置库既可由工具栏按管理模式打开，也可由节点弹窗按创建模式打开并回填绑定。
 */
export function useEgressNodeOverlays(): EgressNodeOverlays {
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [profileLibraryOpen, setProfileLibraryOpen] = useState(false);
  const [profileLibraryCreate, setProfileLibraryCreate] = useState(false);

  function openProfileLibrary(create: boolean): void {
    setProfileLibraryCreate(create);
    setProfileLibraryOpen(true);
  }

  return {
    batchDeleteOpen,
    setBatchDeleteOpen,
    cleanupOpen,
    setCleanupOpen,
    profileLibraryOpen,
    profileLibraryCreate,
    setProfileLibraryOpen,
    setProfileLibraryCreate,
    openProfileLibrary,
  };
}
