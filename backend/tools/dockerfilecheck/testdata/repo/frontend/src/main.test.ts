import { boot } from "./main.ts";

// 夹具：被 tsconfig.app.json 的 exclude 排除的测试文件，不应进入必需集合。
export const bootName = boot;
