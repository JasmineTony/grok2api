import { buildInputHash } from "./build-inputs.ts";

// 夹具：测试文件不参与闭包扩展，因此被 .dockerignore 排除是合法的。
export const check = buildInputHash;
