// 媒体临时输入读取契约：跨 feature 共用的上传/导入结果 DTO。只依赖 shared。
// 临时输入不会进入图库，也不会生成公开 URL；任务只持久化短 file_id。
export type MediaInputDTO = {
  fileId: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
};
