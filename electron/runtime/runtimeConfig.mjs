/**
 * runtimeConfig.js — 运行时配置解析器 🛠️
 *
 * 这个模块的作用很简单：把 appSettings 里那一堆原始配置，
 * "翻译"成运行时好用的结构化配置对象。
 *
 * 就像你把一堆散落的乐高零件分类放进收纳盒，
 * 后续用的时候直接拿就行，不用每次都翻箱倒柜 🧱
 */

/**
 * 从 appSettings 解析出运行时配置
 *
 * 简单说就是：用户填了 API 地址和密钥 → 用远程模式；
 *              啥也没填 → 用本地模拟模式（啥也不干，纯占位）
 *
 * @param {object} settings - 数据库里的 appSettings 记录
 * @returns {object} 结构化的运行时配置
 */
export function resolveRuntimeConfig(settings) {
  const safeTrim = (v) => (v != null ? String(v).trim() : "");
  const textEndpoint = safeTrim(settings.textEndpoint);
  const textKey = safeTrim(settings.textKey);

  return {
    mode: textEndpoint && textKey ? "remote-configured" : "local-mock",
    apiBaseUrl: textEndpoint,
    apiKey: textKey,
    defaultModel: safeTrim(settings.textModel) || "deepseek-chat",
    textMode: settings.textMode || "openai",
    imageEndpoint: safeTrim(settings.imageEndpoint),
    imageKey: safeTrim(settings.imageKey),
    imageModel: safeTrim(settings.imageModel),
    reviewThreshold: Math.max(0, Math.min(100, settings.reviewThreshold || 90)),
    enableLocalSave: settings.enableLocalSave,
  };
}
