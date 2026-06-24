/**
 * appSettings.js — 应用设置 CRUD
 *
 * ⚙️ 管理用户的全局配置项，比如 LLM 端点、API Key、模型选择等。
 * 数据存在 app_settings 表里，key-value 形式。
 *
 * 核心逻辑:
 *   - 读取时自动做类型转换（布尔值、数字、模式校验）
 *   - 保存时把布尔值转成 "1"/"0" 存储到 SQLite
 *   - 内置 DeepSeek 模型迁移：老版本用户自动升级到 deepseek-v4-pro
 */

const DEFAULT_SETTINGS = {
  textEndpoint: "",
  textKey: "",
  textModel: "deepseek-v4-pro",
  textMode: "openai",
  imageEndpoint: "",
  imageKey: "",
  imageModel: "",
  reviewThreshold: 90,
  enableLocalSave: true,
};

const DEEPSEEK_OFFICIAL_ENDPOINT = "https://api.deepseek.com/v1";
const DEEPSEEK_LEGACY_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const DEEPSEEK_TARGET_MODEL = "deepseek-v4-pro";

const SETTING_KEYS = [
  "textEndpoint",
  "textKey",
  "textModel",
  "textMode",
  "imageEndpoint",
  "imageKey",
  "imageModel",
  "reviewThreshold",
  "enableLocalSave",
];

const VALID_MODES = new Set(["openai", "gemini", "anthropic"]);

/**
 * 把 JS 值转成 SQLite 存储用的字符串
 * 布尔值特殊处理：true → "1"，false → "0"
 *
 * @param {string} key - 设置项的 key
 * @param {*} value - 要存储的值
 * @returns {string} 转换后的字符串
 */
function toStoredValue(key, value) {
  if (key === "enableLocalSave") {
    return value ? "1" : "0";
  }
  return String(value);
}

/**
 * 把 SQLite 里的字符串还原成 JS 值
 * - reviewThreshold → 数字，夹到 0~100
 * - enableLocalSave → 布尔值
 * - textMode → 校验是否合法，不合法回退 openai
 * - 其他 → 原样返回字符串
 *
 * @param {string} key - 设置项的 key
 * @param {string|null} rawValue - 数据库里的原始值
 * @returns {*} 还原后的 JS 值
 */
function fromStoredValue(key, rawValue) {
  if (rawValue == null) {
    return DEFAULT_SETTINGS[key];
  }
  if (key === "reviewThreshold") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : DEFAULT_SETTINGS.reviewThreshold;
  }
  if (key === "enableLocalSave") {
    return rawValue === "1";
  }
  if (key === "textMode") {
    return VALID_MODES.has(rawValue) ? rawValue : "openai";
  }
  return rawValue;
}

/**
 * 读取全部应用设置
 * 从 app_settings 表批量读取，自动做类型转换 + DeepSeek 模型迁移
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @returns {object} 设置对象，结构和 DEFAULT_SETTINGS 一致
 */
export function getAppSettings(db) {
  const rows = db
    .prepare("SELECT setting_key, setting_value FROM app_settings")
    .all();
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const settings = { ...DEFAULT_SETTINGS };

  for (const key of SETTING_KEYS) {
    const raw = map.get(key);
    settings[key] = fromStoredValue(key, raw);
  }

  if (
    DEEPSEEK_LEGACY_MODELS.includes(settings.textModel) &&
    settings.textEndpoint === DEEPSEEK_OFFICIAL_ENDPOINT
  ) {
    const oldModel = settings.textModel;
    settings.textModel = DEEPSEEK_TARGET_MODEL;
    const migratedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO app_settings (id, setting_key, setting_value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`
    ).run("textModel", "textModel", DEEPSEEK_TARGET_MODEL, migratedAt);
    console.log(`[settings] migrated DeepSeek model ${oldModel} → ${DEEPSEEK_TARGET_MODEL}`);
  }

  return settings;
}

/**
 * 保存应用设置
 * 把传入的设置对象逐项写入 app_settings 表，用 UPSERT 保证幂等
 *
 * ⚠️ 前端可能只传部分字段（比如只传4个），未传的字段用当前数据库的值补齐，
 * 避免把 undefined 转成字符串 "undefined" 存进去
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {object} input - 新的设置值（可以只包含部分字段）
 * @returns {object} 保存后重新读取的完整设置对象
 */
export function saveAppSettings(db, input) {
  const current = getAppSettings(db);
  const merged = { ...current, ...input };

  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO app_settings (id, setting_key, setting_value, updated_at)
     VALUES (@id, @setting_key, @setting_value, @updated_at)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_at = excluded.updated_at`
  );

  const transaction = db.transaction((s) => {
    for (const key of SETTING_KEYS) {
      statement.run({
        id: key,
        setting_key: key,
        setting_value: toStoredValue(key, s[key]),
        updated_at: now,
      });
    }
  });

  transaction(merged);
  return getAppSettings(db);
}
