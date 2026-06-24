/**
 * promptTemplates.mjs — 提示词模板 CRUD
 *
 * 📝 这个模块管的是"提示词模板"（prompt template），
 * 也就是用户在设置页面里可以查看、编辑、新增的那些提示词。
 *
 * 和 promptCrud.mjs 不一样！那个管的是"提示词产出记录"（生成结果），
 * 这个管的是"提示词模板"（生成规则）。
 *
 * 逻辑：
 * - 内置模板（built-in）来自 prompts/index.mjs 的硬编码
 * - 用户修改/新增的模板存在 prompt_templates 表
 * - 调用 buildPrompt 时，优先用数据库里的自定义版本，没有才用内置版本
 */

/**
 * 获取所有内置模板的元信息
 * 📋 把9个 builder 的 contextType 和描述列出来，给前端展示用
 *
 * @returns {Array<{contextType: string, label: string, description: string, category: string}>}
 */
export function getBuiltinTemplates() {
  return [
    {
      contextType: "screenplay_step",
      label: "八步工作流 · 步骤生成",
      description: "Eye-Blink-Life 睁眼闭眼一生短片工作流，8个步骤从概念到诊断",
      category: "剧本创作",
    },
    {
      contextType: "screenplay_selfcheck",
      label: "八步工作流 · 自检",
      description: "对八步工作流每步产出进行自检，pass/warn/fail 判定",
      category: "剧本创作",
    },
    {
      contextType: "screenplay_checkpoint",
      label: "八步工作流 · 检查点",
      description: "Step 6 通过后自动生成结构化项目快照摘要",
      category: "剧本创作",
    },
    {
      contextType: "seedance_phase_ad",
      label: "V5分镜 · Phase A-D 分析",
      description: "将剧本文本分析为 V5 分镜结构，段号索引+结构+情绪地图+单元分配",
      category: "分镜创作",
    },
    {
      contextType: "seedance_quick",
      label: "V5分镜 · 🚀 快速模式",
      description: "跳过八步工作流，从主题+描述直接生成完整分镜方案（含FloobyNooby 15步思维链）",
      category: "分镜创作",
    },
    {
      contextType: "seedance_refine",
      label: "V5分镜 · 🎯 FloobyNooby 精炼 (Steps 5-9)",
      description: "粗缩略图→Animatic审查→结构修订→镜头语言精炼→二轮缩略图",
      category: "分镜创作",
    },
    {
      contextType: "seedance_key_panels",
      label: "V5分镜 · 🔑 关键面板+逐镜板 (Steps 10-12)",
      description: "锁定关键面板→粗动画计划→关键场次逐镜板，做到可拍摄状态",
      category: "分镜创作",
    },
    {
      contextType: "seedance_final",
      label: "V5分镜 · 📬 最终交付 (Steps 13-15)",
      description: "全片粗板包组装→清洁规则→最终交付总稿",
      category: "分镜创作",
    },
    {
      contextType: "seedance_unit_efg",
      label: "V5分镜 · Phase E-F-G 单元生成",
      description: "为拍摄单元生成8字段专业分镜（FloobyNooby方法论）",
      category: "分镜创作",
    },
    {
      contextType: "asset_extract",
      label: "全资产大师 V3.0",
      description: "场景七层递进+角色概念表4区域+道具8类，万能题材版",
      category: "资产管理",
    },
    {
      contextType: "video_prompt",
      label: "抓耳挠腮 Prompt v1.22",
      description: "故事板+视频prompt规范，敏感词4区过滤",
      category: "视频生成",
    },
    {
      contextType: "script_generation",
      label: "剧本生成（传统）",
      description: "非八步工作流的传统剧本生成，支持概念/题材/时长/风格",
      category: "剧本创作",
    },
    {
      contextType: "script_review",
      label: "剧本审核/医生（传统）",
      description: "6维度诊断+评分，结构/角色/对话/节奏/冲突/时长",
      category: "剧本创作",
    },
  ];
}

/**
 * 获取所有模板列表（内置 + 自定义）
 * 📦 合并内置模板和数据库中的自定义模板，返回完整列表
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<object>} 模板列表
 */
export function listAllTemplates(db) {
  const builtins = getBuiltinTemplates();

  const customRows = db.prepare(
    `SELECT context_type, label, description, category, is_override FROM prompt_templates ORDER BY created_at ASC`
  ).all();

  const customMap = new Map();
  for (const row of customRows) {
    customMap.set(row.context_type, row);
  }

  const result = [];

  for (const builtin of builtins) {
    const custom = customMap.get(builtin.contextType);
    if (custom) {
      result.push({
        ...builtin,
        label: custom.label || builtin.label,
        description: custom.description || builtin.description,
        category: custom.category || builtin.category,
        isCustom: true,
        isOverride: custom.is_override === 1,
      });
      customMap.delete(builtin.contextType);
    } else {
      result.push({
        ...builtin,
        isCustom: false,
        isOverride: false,
      });
    }
  }

  for (const [contextType, custom] of customMap) {
    result.push({
      contextType,
      label: custom.label,
      description: custom.description || "",
      category: custom.category || "自定义",
      isCustom: true,
      isOverride: custom.is_override === 1,
    });
  }

  return result;
}

/**
 * 获取单个模板的完整内容（systemPrompt + userPrompt）
 * 🔍 优先从数据库取自定义版本，没有就用内置 builder 生成
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextType - 上下文类型标识
 * @returns {Promise<{contextType: string, label: string, systemPrompt: string, userPrompt: string, isCustom: boolean}>}
 */
export async function getTemplateDetail(db, contextType) {
  const customRow = db.prepare(
    `SELECT * FROM prompt_templates WHERE context_type = ?`
  ).get(contextType);

  if (customRow) {
    return {
      contextType,
      label: customRow.label,
      systemPrompt: customRow.system_prompt || "",
      userPrompt: customRow.user_prompt || "",
      isCustom: true,
      isOverride: customRow.is_override === 1,
    };
  }

  const builtins = getBuiltinTemplates();
  const builtin = builtins.find((t) => t.contextType === contextType);

  try {
    const { buildPrompt } = await import("../prompts/index.mjs");
    const built = await buildPrompt(contextType, {});
    return {
      contextType,
      label: builtin?.label || contextType,
      systemPrompt: built.systemPrompt || "",
      userPrompt: built.userPrompt || "",
      isCustom: false,
      isOverride: false,
    };
  } catch {
    return {
      contextType,
      label: builtin?.label || contextType,
      systemPrompt: "",
      userPrompt: "",
      isCustom: false,
      isOverride: false,
    };
  }
}

/**
 * 保存/更新模板
 * 💾 如果是覆盖内置模板，标记 is_override=1；如果是新增自定义模板，is_override=0
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data - { contextType, label, description, category, systemPrompt, userPrompt }
 * @returns {object} 保存结果
 */
export function saveTemplate(db, data) {
  const now = new Date().toISOString();
  const { contextType, label, description, category, systemPrompt, userPrompt } = data;

  const existing = db.prepare(
    `SELECT context_type FROM prompt_templates WHERE context_type = ?`
  ).get(contextType);

  const builtins = getBuiltinTemplates();
  const isBuiltin = builtins.some((t) => t.contextType === contextType);
  const isOverride = isBuiltin ? 1 : 0;

  if (existing) {
    db.prepare(
      `UPDATE prompt_templates
       SET label = ?, description = ?, category = ?, system_prompt = ?, user_prompt = ?, is_override = ?, updated_at = ?
       WHERE context_type = ?`
    ).run(label, description || "", category || "自定义", systemPrompt, userPrompt, isOverride, now, contextType);
  } else {
    db.prepare(
      `INSERT INTO prompt_templates (context_type, label, description, category, system_prompt, user_prompt, is_override, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(contextType, label, description || "", category || "自定义", systemPrompt, userPrompt, isOverride, now, now);
  }

  return { success: true, contextType, isOverride: !!isOverride };
}

/**
 * 删除自定义模板
 * 🗑️ 只能删数据库里的自定义版本，内置模板删不了（也不需要删，重置就行）
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextType
 * @returns {object}
 */
export function deleteTemplate(db, contextType) {
  const row = db.prepare(
    `DELETE FROM prompt_templates WHERE context_type = ?`
  ).run(contextType);

  if (row.changes === 0) {
    return { success: false, message: "模板不存在或为内置模板" };
  }
  return { success: true, contextType };
}

/**
 * 重置模板到内置版本
 * 🔄 删除数据库中的自定义版本，恢复使用内置 builder
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextType
 * @returns {object}
 */
export function resetTemplate(db, contextType) {
  const builtins = getBuiltinTemplates();
  const isBuiltin = builtins.some((t) => t.contextType === contextType);

  if (!isBuiltin) {
    return { success: false, message: "非内置模板无法重置，请直接删除" };
  }

  db.prepare(
    `DELETE FROM prompt_templates WHERE context_type = ?`
  ).run(contextType);

  return { success: true, contextType };
}

/**
 * 增强版 buildPrompt：优先从数据库加载自定义模板
 * 🚀 这是给 serverLlmProxy 用的，替代原来的 buildPrompt
 *
 * 逻辑：
 * 1. 先查数据库有没有自定义版本
 * 2. 有 → 用数据库的 systemPrompt + userPrompt（支持模板变量替换）
 * 3. 没有 → 走原来的内置 builder
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextType
 * @param {object} contextParams
 * @returns {Promise<{systemPrompt: string, userPrompt: string}>}
 */
export async function buildPromptWithDB(db, contextType, contextParams = {}) {
  const customRow = db.prepare(
    `SELECT system_prompt, user_prompt FROM prompt_templates WHERE context_type = ?`
  ).get(contextType);

  if (customRow && customRow.system_prompt) {
    let systemPrompt = customRow.system_prompt;
    let userPrompt = customRow.user_prompt || "";

    for (const [key, value] of Object.entries(contextParams)) {
      const placeholder = `{{${key}}}`;
      const strValue = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "");
      systemPrompt = systemPrompt.replaceAll(placeholder, strValue);
      userPrompt = userPrompt.replaceAll(placeholder, strValue);
    }

    return { systemPrompt, userPrompt };
  }

  const { buildPrompt } = await import("../prompts/index.mjs");
  return buildPrompt(contextType, contextParams);
}
