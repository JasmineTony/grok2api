/**
 * i18next 资源集合：语言 -> translation 命名空间。
 *
 * 这里只导出**首屏同步**的 `initial`（common / auth / api-errors）；其余 12 个非首屏领域在
 * `./deferred` 中，由 `shared/i18n/index.ts` 的 `loadDeferredResources()` 懒加载后补入，
 * 见 AGENTS.md REV-5 的首屏体积预算。
 */
export { default as resources } from "./initial";
