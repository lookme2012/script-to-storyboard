/**
 * screenplayService · 八步工作流主服务 (Phase 3 · 服务端 builder)
 *
 * 🎬 Phase 3 架构:
 *   - prompt 拼装全部搬到服务端 routes/llmContextual + services/screenplayBuilder
 *   - 本文件保留: project 状态管理 / store 操作 / generateStep/selfcheckStep/generateCheckpoint 业务编排 / JSON parse / finalize 桥接
 *   - LLM 调用走 requestLocalBuilderStream（本地 Prompt Builder + 直连 LLM API）
 *   - 客户端只构造 projectSnapshot + 发 contextParams
 */

import { BrowserWindow } from "../electron-stub.mjs";
import {
  getActiveVersion,
  appendVersion,
  approveStep as storeApproveStep,
  rollbackTo as storeRollbackTo,
  setStepSelection as storeSetStepSelection,
  setLinkedScriptTaskId,
  saveSelfcheck as storeSaveSelfcheck,
  getSelfcheck as storeGetSelfcheck,
  getCheckpoint as storeGetCheckpoint,
  saveCheckpoint as storeSaveCheckpoint,
  loadProject,
  createProject as storeCreateProject,
  deleteProject as storeDeleteProject,
  listRecentProjects as storeListRecentProjects,
  updateActiveStepStructured as storeUpdateActiveStepStructured,
  renameProject as storeRenameProject,
  setProjectDuration as storeSetProjectDuration,
  setSurgeryDecisions as storeSetSurgeryDecisions,
  getSurgeryDecisions as storeGetSurgeryDecisions,
  setDbProjectId as storeSetDbProjectId,
} from "./screenplayStore.mjs";
import { getAppSettingsFull, finalizeScreenplay } from "../database/index.mjs";
import { resolveRuntimeConfig } from "../runtime/runtimeConfig.mjs";
import { requestLocalBuilderStream } from "../runtime/serverLlmProxy.mjs";
import { parseStepOutput, parseSelfcheck } from "../utils/screenplayStepParser.mjs";

/**
 * 获取 SKILL 状态 (给 IPC 用, ScriptWorkbench.detectLiveMode 要核验全字段)
 * 📡 Phase 3: SKILL + V5 已搬到服务端, 客户端无 cache. 字段结构保留用于 UI 兼容, 全部 true.
 */
export function skillStatus() {
  return {
    cached: true,
    cacheDir: "(server-managed)",
    main: true,
    core: true,
    formatUltrashort: true,
    formatShort: true,
    chinese: true,
    craft: true,
    aiPitfalls: true,
    checkpointTemplate: true,
    genreHookLibrary: true,
  };
}

/**
 * 获取 SKILL 状态 (对外暴露的接口)
 */
export function getSkillStatus() {
  return skillStatus();
}

/**
 * 把 ScreenplayProjectRecord 打包成 ProjectSnapshot 发给服务端
 * 📦 包含每步的 structured 数据 + 用户选择 + 检查点
 */
function buildProjectSnapshot(project) {
  const steps = {};
  for (let n = 1; n <= 8; n++) {
    const v = getActiveVersion(project.projectId, n);
    if (v?.structured !== undefined && v.structured !== null) {
      steps[String(n)] = { structured: v.structured };
    }
  }
  const checkpoints = {};
  const ckpt = getCheckpoint(project.projectId, "after-step-6");
  if (ckpt && ckpt.trim()) checkpoints["after-step-6"] = ckpt;
  return {
    steps,
    selections: project.selections ?? {},
    checkpoints,
  };
}

/**
 * 创建新项目
 * 🎬 委托给 screenplayStore.createProject
 */
export function createProject(init) {
  return storeCreateProject(init);
}

/**
 * 获取项目记录
 * 📖 委托给 screenplayStore.loadProject
 */
export function getProject(projectId) {
  return loadProject(projectId);
}

/**
 * 列出最近项目
 * 📋 委托给 screenplayStore.listRecentProjects
 */
export function listRecentProjects(limit = 20) {
  return storeListRecentProjects(limit);
}

/**
 * 删除项目
 * 🗑️ 委托给 screenplayStore.deleteProject
 */
export function deleteProject(projectId) {
  return storeDeleteProject(projectId);
}

/**
 * 更新某一步的 structured 数据
 * ✏️ 委托给 screenplayStore.updateActiveStepStructured
 */
export function updateStepStructured(projectId, stepNumber, structured) {
  return storeUpdateActiveStepStructured(projectId, stepNumber, structured);
}

/**
 * 重命名项目
 * ✏️ 委托给 screenplayStore.renameProject
 */
export function renameProject(projectId, newName) {
  return storeRenameProject(projectId, newName);
}

/**
 * 更新项目目标时长
 * ⏱ 在工作流中调整时长，会影响后续步骤的生成规划
 */
export function updateProjectDuration(projectId, newDuration) {
  return storeSetProjectDuration(projectId, newDuration);
}

/**
 * Step 7 写作通过后调用 → 把 screenplay 八步产出桥接到老 script_tasks 表
 * 🌉 ProjectDashboard 检测到该 task 的 review 非空就解锁资产/提示词/画布
 *
 * 幂等: 重复调用不会重复建 project, 会 update 现有 task 的 body 和 review.
 */
export function finalizeToScriptTask(projectId) {
  const rec = loadProject(projectId);
  if (!rec) throw new Error(`Project not found: ${projectId}`);

  let scenes;
  const isImportPath = rec.init.path === "import";
  const importedScript = rec.init.importedScript;

  if (isImportPath && importedScript?.trim()) {
    const sceneHeaderRe =
      /【\s*(场景|场)\s*[一二三四五六七八九十百零\d]+\s*[:：][^】]+】\s*[（(][^)）]*[)）]/g;
    const importedBody = importedScript.trim();
    const headerMatches = [...importedBody.matchAll(sceneHeaderRe)];
    if (headerMatches.length >= 2) {
      scenes = headerMatches.map((m, i) => {
        const start = m.index ?? 0;
        const end =
          i + 1 < headerMatches.length
            ? headerMatches[i + 1].index ?? importedBody.length
            : importedBody.length;
        const block = importedBody.slice(start, end).trim();
        const headerLine = block.split(/\r?\n/)[0] ?? "";
        const body = block.slice(headerLine.length).trim();
        const durMatch = headerLine.match(/[（(][^)）]*?(\d+)[^)）]*?[)）]/);
        return {
          index: i + 1,
          header: headerLine,
          duration: durMatch ? `约 ${durMatch[1]} 秒` : "约 30 秒",
          plotRhythm: "中",
          emotionRhythm: "中",
          body,
        };
      });
    } else {
      const fileName = rec.init.importedFileName;
      scenes = [
        {
          index: 1,
          header: fileName ? `【导入剧本：${fileName}】` : "【导入剧本】",
          duration: rec.init.duration ?? "未知",
          plotRhythm: "中",
          emotionRhythm: "中",
          body: importedBody,
        },
      ];
    }
  } else {
    const step7 = getActiveVersion(projectId, 7);
    if (!step7?.structured) {
      throw new Error("Step 7 写作产出不存在, 无法桥接");
    }
    const step7Data = step7.structured;
    if (!step7Data.scenes?.length) {
      throw new Error("Step 7 scenes 为空");
    }
    scenes = step7Data.scenes;
  }

  const step8 = getActiveVersion(projectId, 8);
  const doctor = step8?.structured;

  const result = finalizeScreenplay({
    projectName:
      rec.init.name?.trim() || rec.init.concept?.slice(0, 30) || "未命名剧本",
    duration: rec.init.duration ?? "2分钟",
    concept: rec.init.concept,
    scenes,
    doctor,
    linkedScriptTaskId: rec.linkedScriptTaskId,
    dbProjectId: rec.dbProjectId,
  });

  setLinkedScriptTaskId(projectId, result.taskId);
  if (result.projectId && result.wasCreate) {
    storeSetDbProjectId(projectId, result.projectId);
  }
  return {
    projectId: result.projectId,
    scriptTaskId: result.taskId,
    wasCreate: result.wasCreate,
  };
}

// ═══════════════════════════════════════════════════════════════
//  JSON 鲁棒解析 (4层尝试)
// ═══════════════════════════════════════════════════════════════

/**
 * 剥掉 markdown 代码围栏 (```json ... ```)
 * 🔧 让 JSON.parse 能正常工作
 */
function stripMarkdownFences(text) {
  return text
    .replace(/^\s*```(?:json|JSON)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
}

/**
 * 修复 LLM 常见的 JSON 瑕疵, 不改变语义:
 * 🛠️ 四层修复:
 *   1. BOM / NBSP 清洗
 *   2. 单行/块注释删除
 *   3. 全角引号/括号 → ASCII
 *   4. 逐字符扫描: 字符串内裸换行转义, 字符串外中文标点 ASCII 化
 *   5. 尾逗号去除
 */
function repairJsonQuirks(s) {
  s = s.replace(/^\uFEFF/, "").replace(/\u00A0/g, " ");
  s = s.replace(/^\s*\/\/[^\n]*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/[\uFF3B\u3010]/g, "[").replace(/[\uFF3D\u3011]/g, "]");
  s = s.replace(/\uFF5B/g, "{").replace(/\uFF5D/g, "}");
  s = sanitizeCharByChar(s);
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}

/**
 * 逐字符扫描 JSON 文本, 修复字符串内/外的问题:
 * 🔍 字符串内 (inString=true):
 *     - 裸 \n / \r / \t 转义
 *     - 裸 ASCII " 如果 lookahead 下一非空白字符不是 , : } ] EOF, 判定为内部引号, 转义为 \"
 * 🔍 字符串外 (inString=false):
 *     - 全角逗号 ，→ ,
 *     - 中文顿号 、→ ,
 *     - 全角冒号 ：→ :
 *     - 全角分号 ；→ ;
 */
function sanitizeCharByChar(s) {
  const out = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      out.push(ch);
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        out.push(ch);
        escape = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const nextCh = j < s.length ? s[j] : "";
        if (
          nextCh === "" ||
          nextCh === "," ||
          nextCh === ":" ||
          nextCh === "}" ||
          nextCh === "]"
        ) {
          out.push('"');
          inString = false;
        } else {
          out.push('\\"');
        }
        continue;
      }
      if (ch === "\n") {
        out.push("\\n");
        continue;
      }
      if (ch === "\r") {
        out.push("\\r");
        continue;
      }
      if (ch === "\t") {
        out.push("\\t");
        continue;
      }
      out.push(ch);
    } else {
      if (ch === "\uFF0C") {
        out.push(",");
        continue;
      }
      if (ch === "\u3001") {
        out.push(",");
        continue;
      }
      if (ch === "\uFF1A") {
        out.push(":");
        continue;
      }
      if (ch === "\uFF1B") {
        out.push(";");
        continue;
      }
      if (ch === '"') inString = true;
      out.push(ch);
    }
  }
  return out.join("");
}

/**
 * 按括号平衡截取最大可 parse 的 JSON 前缀 (最后手段)
 * ✂️ 用于 LLM 在 JSON 之后又加了一段"解释" / 或内部未闭合
 */
function tryTruncateToBalanced(s) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 从 JSON.parse 错误 message 里抽 position, 返回位置周围 ±40 字的上下文
 * 🐛 帮助用户/开发者快速定位到具体字符
 */
function extractParseErrorContext(text, err) {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/position (\d+)/);
  if (!m) return msg;
  const pos = parseInt(m[1], 10);
  const start = Math.max(0, pos - 40);
  const end = Math.min(text.length, pos + 40);
  const before = text.slice(start, pos);
  const charAtPos = text.slice(pos, pos + 1);
  const after = text.slice(pos + 1, end);
  const charCode = charAtPos
    ? `U+${charAtPos.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
    : "EOF";
  return `${msg}\n位置 ${pos} 处字符: "${charAtPos}" (${charCode})\n上下文: ...${before}【${charAtPos}】${after}...`;
}

/**
 * 4层尝试解析 JSON (核心鲁棒解析器)
 * 🏗️ 尝试顺序:
 *   1. 直接 parse
 *   2. 全局 repair (中文全角标点 / 尾逗号 / 字符串内换行) 后 parse
 *   3. 抓 outermost { ... } 再 parse
 *   4. 括号平衡截取 (处理 LLM 尾部附带裸文字)
 *
 * @param {string} text - 原始文本 (可能含 ```json 围栏)
 * @returns {{ value: any, error?: string }} 解析结果
 */
function tryParseJson(text) {
  const cleaned = stripMarkdownFences(text);
  let lastError = null;

  try {
    return { value: JSON.parse(cleaned) };
  } catch (e) {
    lastError = e;
  }

  const repairedAll = repairJsonQuirks(cleaned);
  try {
    return { value: JSON.parse(repairedAll) };
  } catch (e) {
    lastError = e;
  }

  const firstBrace = repairedAll.indexOf("{");
  const lastBrace = repairedAll.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = repairedAll.slice(firstBrace, lastBrace + 1);
    try {
      return { value: JSON.parse(slice) };
    } catch (e) {
      lastError = e;
    }
    try {
      return { value: JSON.parse(repairJsonQuirks(slice)) };
    } catch (e) {
      lastError = e;
    }
  }

  const balanced = tryTruncateToBalanced(repairedAll);
  if (balanced) {
    try {
      return { value: JSON.parse(balanced) };
    } catch (e) {
      lastError = e;
    }
    try {
      return { value: JSON.parse(repairJsonQuirks(balanced)) };
    } catch (e) {
      lastError = e;
    }
  }

  return { value: null, error: extractParseErrorContext(repairedAll, lastError) };
}

// ═══════════════════════════════════════════════════════════════
//  Streaming helper
// ═══════════════════════════════════════════════════════════════

/**
 * 向渲染进程发送流式 chunk
 * 📡 通过 IPC channel "screenplay:stream-chunk" 推送到前端
 */
function broadcastChunk(projectId, stepNumber, chunk) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.send("screenplay:stream-chunk", {
    projectId,
    stepNumber,
    chunk,
  });
}

// ═══════════════════════════════════════════════════════════════
//  核心业务: 生成 / 自检 / 审批 / 检查点
// ═══════════════════════════════════════════════════════════════

/**
 * 生成某一步的产出 (调用 LLM 流式生成)
 * 🤖 contextType="screenplay_step", 服务端负责 prompt 拼装
 *
 * @param {Object} params - { projectId, stepNumber, userFeedback? }
 * @returns {Promise<{ versionId: string, text: string, structured: any, parseError?: string }>}
 */
export async function generateStep(params) {
  const project = loadProject(params.projectId);
  if (!project) throw new Error(`Project not found: ${params.projectId}`);

  const runtimeConfig = resolveRuntimeConfig(await getAppSettingsFull());
  if (runtimeConfig.mode === "local-mock") {
    throw new Error("API 未配置, 请先到设置页填写文字模型 API 地址和密钥.");
  }

  const projectSnapshot = buildProjectSnapshot(project);
  const currentSelection = project.init?.selectedPremise || Object.values(project.selections || {}).join(", ");
  let fullText = "";
  const externalOnChunk = params.onChunk;

  await requestLocalBuilderStream({
    runtimeConfig,
    contextType: "screenplay_step",
    contextParams: {
      stepNumber: params.stepNumber,
      init: project.init,
      projectSnapshot,
      userFeedback: params.userFeedback,
      currentSelection: currentSelection || undefined,
    },
    onChunk: (chunk) => {
      fullText += chunk;
      broadcastChunk(params.projectId, params.stepNumber, chunk);
      if (externalOnChunk) externalOnChunk(chunk);
    },
  });

  const parsedResult = parseStepOutput(params.stepNumber, fullText);
  const structured = parsedResult.value;
  const parseError = parsedResult.error;

  const version = appendVersion(params.projectId, params.stepNumber, {
    label: params.userFeedback
      ? `修改: ${params.userFeedback.slice(0, 20)}`
      : "初版",
    output: fullText,
    structured,
    userFeedback: params.userFeedback,
  });

  return { versionId: version.id, text: fullText, structured, parseError };
}

/**
 * 自检某一步的产出 (调用 LLM 流式生成)
 * 🔍 contextType="screenplay_selfcheck", 最多重试 2 次
 *
 * @param {Object} params - { projectId, stepNumber }
 * @returns {Promise<{ items: Array }>}
 */
export async function selfcheckStep(params) {
  const project = loadProject(params.projectId);
  if (!project) throw new Error(`Project not found: ${params.projectId}`);

  const runtimeConfig = resolveRuntimeConfig(await getAppSettingsFull());
  if (runtimeConfig.mode === "local-mock") {
    throw new Error("API 未配置, 请先到设置页填写文字模型 API.");
  }

  const active = getActiveVersion(params.projectId, params.stepNumber);
  const currentOutput = active?.output ?? "(无产出)";
  const currentSelection = project.selections?.[String(params.stepNumber)];

  const MAX_ATTEMPTS = 2;
  let lastError = null;
  const externalOnChunk = params.onChunk;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let fullText = "";
    try {
      await requestLocalBuilderStream({
        runtimeConfig,
        contextType: "screenplay_selfcheck",
        contextParams: {
          stepNumber: params.stepNumber,
          init: project.init,
          currentOutput,
          currentSelection,
        },
        onChunk: (chunk) => {
          fullText += chunk;
          broadcastChunk(params.projectId, params.stepNumber, chunk);
          if (externalOnChunk) externalOnChunk(chunk);
        },
      });
    } catch (err) {
      lastError = err;
      const msg = lastError?.message ?? "";
      if (!msg.includes("未返回有效内容") && !msg.includes("AI 未返回")) {
        throw lastError;
      }
      continue;
    }

    if (fullText.trim()) {
      const { items } = parseSelfcheck(fullText);
      storeSaveSelfcheck(params.projectId, params.stepNumber, items);
      return { items };
    }
    lastError = new Error("AI 自检返回空");
  }

  console.warn(
    `[screenplay] selfcheck step ${params.stepNumber} returned empty after ${MAX_ATTEMPTS} attempts:`,
    lastError?.message
  );
  const fallbackItems = [];
  storeSaveSelfcheck(params.projectId, params.stepNumber, fallbackItems);
  return { items: fallbackItems };
}

/**
 * 获取缓存的自检结果
 * 💾 不调用 LLM, 直接从 store 读取
 */
export function getCachedSelfcheck(projectId, stepNumber) {
  return storeGetSelfcheck(projectId, stepNumber);
}

/**
 * 批准某一步完成
 * ✅ Step 6 approve 后自动触发 checkpoint 生成 (异步, 不阻塞返回)
 * 🔪 Step 8 approve 时可能携带 surgeryDecisions（采纳/拒绝手术建议）
 *
 * 触发条件:
 *   1. stepNumber === 6 (场景拆解刚通过)
 *   2. Step 6 structured.meta.triggerCheckpoint === true (LLM 判定触发)
 *      或 scenes.length > 8 或 totalDurationSec > 480 (兜底规则)
 *   3. 该 trigger 还没生成过 checkpoint
 */
export function approveStep(projectId, stepNumber, nextStep, surgeryDecisions) {
  const rec = storeApproveStep(projectId, stepNumber, nextStep);

  if (stepNumber === 8 && surgeryDecisions && typeof surgeryDecisions === 'object') {
    storeSetSurgeryDecisions(projectId, surgeryDecisions);
  }

  if (stepNumber === 6) {
    const step6 = getActiveVersion(projectId, 6);
    const meta = step6?.structured?.meta;
    const scenes = step6?.structured?.scenes;
    const llmTrigger = meta?.triggerCheckpoint === true;
    const overrun =
      (meta?.sceneCount ?? scenes?.length ?? 0) > 8 ||
      (meta?.totalDurationSec ?? 0) > 480;
    const alreadyGenerated =
      storeGetCheckpoint(projectId, "after-step-6") != null;

    if ((llmTrigger || overrun) && !alreadyGenerated) {
      void generateCheckpoint(projectId, "after-step-6").catch((err) => {
        console.warn(
          `[screenplay] checkpoint generate failed (after-step-6):`,
          err?.message ?? err
        );
      });
    }
  }

  return rec;
}

/**
 * 生成并存储检查点
 * 💾 记忆检查点 = 跨步快照, 让 LLM 把 Step 1-6 的产出压缩为一个 9 字段快照
 *
 * 典型调用:
 *   · approveStep(step=6) 后自动触发 (异步 fire-and-forget)
 *   · IPC "screenplay:regenerate-checkpoint" 手动重跑
 *
 * Phase 3: prompt 在服务端 screenplayBuilder.buildCheckpoint 拼装.
 */
export async function generateCheckpoint(projectId, trigger) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const runtimeConfig = resolveRuntimeConfig(await getAppSettingsFull());
  if (runtimeConfig.mode === "local-mock") {
    throw new Error("API 未配置, 无法生成 checkpoint");
  }

  const projectSnapshot = buildProjectSnapshot(project);
  let fullText = "";

  await requestLocalBuilderStream({
    runtimeConfig,
    contextType: "screenplay_checkpoint",
    contextParams: {
      init: project.init,
      projectSnapshot,
    },
    onChunk: (chunk) => {
      fullText += chunk;
    },
  });

  const content = fullText.trim();
  if (!content) throw new Error("LLM 返回空, checkpoint 未生成");

  storeSaveCheckpoint(projectId, trigger, content);
  return { content, trigger };
}

/**
 * 获取检查点 (暴露给 IPC 的读接口)
 * 📌 UI 可显示当前 checkpoint
 */
export function getCheckpoint(projectId, trigger) {
  return storeGetCheckpoint(projectId, trigger);
}

/**
 * 回滚到指定步骤
 * ⏪ 委托给 store
 */
export function rollbackTo(projectId, targetStep) {
  return storeRollbackTo(projectId, targetStep);
}

/**
 * 列出某一步的所有版本
 * 📚 委托给 store
 */
export function listVersions(projectId, stepNumber) {
  const rec = loadProject(projectId);
  if (!rec) return [];
  return rec.steps[String(stepNumber)]?.versions ?? [];
}

/**
 * 恢复到指定版本 (设置活跃版本)
 * 🔀 委托给 store.setActiveVersion
 */
export function restoreVersion(projectId, stepNumber, versionId) {
  const rec = loadProject(projectId);
  if (!rec) return null;
  const bucket = rec.steps[String(stepNumber)];
  if (!bucket) return null;
  for (const v of bucket.versions) v.isActive = v.id === versionId;
  return rec;
}

/**
 * 设置某一步的用户选择
 * 🎨 委托给 store
 */
export function setStepSelection(projectId, stepNumber, selectionId) {
  return storeSetStepSelection(projectId, stepNumber, selectionId);
}
