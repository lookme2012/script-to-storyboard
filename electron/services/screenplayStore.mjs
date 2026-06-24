/**
 * screenplayStore · 八步工作流数据存储 (本地 JSON 持久化, 不入 DB)
 *
 * 🗂️ 存储位置: userData/screenplay-projects/{projectId}.json
 * 每个项目一个文件, 含 init 参数 + 8 步版本列表 + 当前活跃版本指针.
 *
 * 设计原则:
 *   · 源码零第三方依赖 (不引入 electron-store)
 *   · 单机 JSON, 轻量, 易排查
 *   · 后续服务端接入后可迁移到 DB 表, 本文件直接删
 */

import { app } from "../electron-stub.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 获取项目存储目录, 不存在则自动创建
 * 📁 返回: userData/screenplay-projects/
 */
function projectsDir() {
  const dir = path.join(app.getPath("userData"), "screenplay-projects");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 根据项目 ID 拼出对应的 JSON 文件路径
 * 📄 例: userData/screenplay-projects/sp_a1b2c3d4e5f6.json
 */
function projectFile(projectId) {
  return path.join(projectsDir(), `${projectId}.json`);
}

/**
 * 生成新的项目 ID, 格式: sp_ + 12位随机hex
 * 🎲 例: sp_a1b2c3d4e5f6
 */
export function newProjectId() {
  return "sp_" + crypto.randomBytes(6).toString("hex");
}

/**
 * 生成新的版本 ID, 格式: v_ + 8位随机hex
 * 🔄 例: v_a1b2c3d4
 */
export function newVersionId() {
  return "v_" + crypto.randomBytes(4).toString("hex");
}

/**
 * 创建新项目, 写入 JSON 文件并返回项目记录
 * 🎬 init.path === "import" 时跳到 Step 8 (导入剧本路径), 否则从 Step 1 开始
 *
 * @param {Object} init - 初始化参数 (concept, name, duration, path, importedScript 等)
 * @returns {Object} 项目记录
 */
export function createProject(init) {
  const now = new Date().toISOString();
  const effectiveInit = {
    ...init,
    name: init.name?.trim() || init.concept?.trim().slice(0, 30) || "未命名剧本",
  };
  const record = {
    projectId: newProjectId(),
    init: effectiveInit,
    createdAt: now,
    updatedAt: now,
    currentStep: init.path === "import" ? 8 : 1,
    doneSteps: [0],
    steps: {},
  };
  saveProject(record);
  return record;
}

/**
 * 重命名项目
 * ✏️ 只改 init.name 字段
 */
export function renameProject(projectId, newName) {
  const rec = loadProject(projectId);
  if (!rec) return { success: false };
  rec.init = { ...rec.init, name: newName.trim() || rec.init.name };
  saveProject(rec);
  return { success: true };
}

/**
 * 更新项目目标时长
 * ⏱ 修改 init.duration 字段，用于在工作流中动态调整时长
 */
export function setProjectDuration(projectId, newDuration) {
  const rec = loadProject(projectId);
  if (!rec) return { success: false };
  rec.init = { ...rec.init, duration: newDuration };
  saveProject(rec);
  return { success: true };
}

/**
 * 从磁盘加载项目 JSON
 * 📖 找不到或解析失败返回 null
 */
export function loadProject(projectId) {
  const file = projectFile(projectId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 保存项目到磁盘 (同步写, 自动更新 updatedAt)
 * 💾 每次写入都更新 updatedAt 时间戳
 */
export function saveProject(record) {
  record.updatedAt = new Date().toISOString();
  const file = projectFile(record.projectId);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
}

/**
 * 列出最近更新的项目 (按 updatedAt 降序)
 * 📋 返回摘要信息, 不含完整 steps 数据
 *
 * @param {number} limit - 最大返回条数, 默认 20
 */
export function listRecentProjects(limit = 20) {
  const dir = projectsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const items = files
    .map((f) => {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          projectId: rec.projectId,
          updatedAt: rec.updatedAt,
          name: rec.init.name,
          concept: rec.init.concept?.slice(0, 40),
          currentStep: rec.currentStep,
          duration: rec.init.duration,
        };
      } catch {
        return null;
      }
    })
    .filter((x) => !!x)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
  return items;
}

/**
 * 为某一步追加新版本
 * 📦 旧版本全部标记 isActive=false, 新版本 isActive=true
 *
 * @param {string} projectId - 项目 ID
 * @param {number} stepNumber - 步骤号 (1-8)
 * @param {Object} opts - { label, output, structured, userFeedback }
 * @returns {Object} 新创建的 version 对象
 */
export function appendVersion(projectId, stepNumber, opts) {
  const rec = loadProject(projectId);
  if (!rec) throw new Error(`Project not found: ${projectId}`);
  const stepKey = String(stepNumber);
  if (!rec.steps[stepKey]) rec.steps[stepKey] = { versions: [] };
  const bucket = rec.steps[stepKey];
  for (const v of bucket.versions) v.isActive = false;
  const version = {
    id: newVersionId(),
    stepNumber,
    versionNumber: bucket.versions.length + 1,
    label: opts.label,
    output: opts.output,
    structured: opts.structured,
    userFeedback: opts.userFeedback,
    createdAt: new Date().toISOString(),
    isActive: true,
  };
  bucket.versions.push(version);
  saveProject(rec);
  return version;
}

/**
 * 批准某一步完成, 推进 currentStep
 * ✅ 将 stepNumber 加入 doneSteps, currentStep 前进
 *
 * @param {string} projectId - 项目 ID
 * @param {number} stepNumber - 当前步骤号
 * @param {number} [nextStep] - 下一步步骤号 (支持跳步), 不传则默认 +1
 */
export function approveStep(projectId, stepNumber, nextStep) {
  const rec = loadProject(projectId);
  if (!rec) throw new Error(`Project not found: ${projectId}`);
  if (!rec.doneSteps.includes(stepNumber)) rec.doneSteps.push(stepNumber);
  rec.currentStep =
    typeof nextStep === "number"
      ? Math.max(0, Math.min(9, nextStep))
      : Math.min(9, stepNumber + 1);
  saveProject(rec);
  return rec;
}

/**
 * 回滚到指定步骤
 * ⏪ 清除 targetStep 及之后的所有 doneSteps, currentStep 设为 targetStep
 */
export function rollbackTo(projectId, targetStep) {
  const rec = loadProject(projectId);
  if (!rec) throw new Error(`Project not found: ${projectId}`);
  rec.currentStep = targetStep;
  rec.doneSteps = rec.doneSteps.filter((n) => n < targetStep);
  saveProject(rec);
  return rec;
}

/**
 * 设置某一步的活跃版本
 * 🔀 将指定 versionId 标记为 isActive, 其余标记为 false
 */
export function setActiveVersion(projectId, stepNumber, versionId) {
  const rec = loadProject(projectId);
  if (!rec) throw new Error(`Project not found: ${projectId}`);
  const bucket = rec.steps[String(stepNumber)];
  if (!bucket) throw new Error(`Step ${stepNumber} has no versions`);
  for (const v of bucket.versions) v.isActive = v.id === versionId;
  saveProject(rec);
  return rec;
}

/**
 * 获取某一步的活跃版本
 * 🎯 优先返回 isActive=true 的版本, 兜底返回最后一个版本
 */
export function getActiveVersion(projectId, stepNumber) {
  const rec = loadProject(projectId);
  if (!rec) return null;
  const bucket = rec.steps[String(stepNumber)];
  if (!bucket) return null;
  return (
    bucket.versions.find((v) => v.isActive) ??
    bucket.versions[bucket.versions.length - 1] ??
    null
  );
}

/**
 * 列出某一步的所有版本
 * 📚 返回版本数组
 */
export function listVersions(projectId, stepNumber) {
  const rec = loadProject(projectId);
  if (!rec) return [];
  return rec.steps[String(stepNumber)]?.versions ?? [];
}

/**
 * 保存用户在某一步的选择 (如选了哪个 premise option)
 * 🎨 selections 是一个 { stepNumber: selectionId } 的映射
 */
export function setStepSelection(projectId, stepNumber, selectionId) {
  const rec = loadProject(projectId);
  if (!rec) return null;
  if (!rec.selections) rec.selections = {};
  rec.selections[String(stepNumber)] = selectionId;
  saveProject(rec);
  return rec;
}

/**
 * 保存自检结果
 * 🔍 selfchecks 是一个 { stepNumber: { items, createdAt } } 的映射
 */
export function saveSelfcheck(projectId, stepNumber, items) {
  const rec = loadProject(projectId);
  if (!rec) return;
  if (!rec.selfchecks) rec.selfchecks = {};
  rec.selfchecks[String(stepNumber)] = {
    items,
    createdAt: new Date().toISOString(),
  };
  saveProject(rec);
}

/**
 * 保存 Step 8 医生手术决策
 * 🔪 decisions: { "0": "accept"|"reject", "1": "accept"|"reject", ... }
 * 存储到项目数据中，后续分镜阶段可以看到哪些手术被采纳了
 */
export function setSurgeryDecisions(projectId, decisions) {
  const rec = loadProject(projectId);
  if (!rec) return null;
  if (!rec.surgeryDecisions) rec.surgeryDecisions = {};
  Object.assign(rec.surgeryDecisions, decisions);
  saveProject(rec);
  return rec;
}

/**
 * 获取 Step 8 手术决策
 */
export function getSurgeryDecisions(projectId) {
  const rec = loadProject(projectId);
  return rec?.surgeryDecisions ?? {};
}

/**
 * 获取某一步的自检结果
 * 🔎 返回 { items, createdAt } 或 null
 */
export function getSelfcheck(projectId, stepNumber) {
  const rec = loadProject(projectId);
  return rec?.selfchecks?.[String(stepNumber)] ?? null;
}

/**
 * 把用户编辑过的 structured 保存到 active version
 * ✏️ 同步更新 output 字段 (JSON 序列化), 保证 applyStructured 和 output 一致
 */
export function updateActiveStepStructured(projectId, stepNumber, structured) {
  const rec = loadProject(projectId);
  if (!rec) return { success: false };
  const bucket = rec.steps[String(stepNumber)];
  if (!bucket) return { success: false };
  const active =
    bucket.versions.find((v) => v.isActive) ??
    bucket.versions[bucket.versions.length - 1];
  if (!active) return { success: false };
  active.structured = structured;
  active.output = "```json\n" + JSON.stringify(structured, null, 2) + "\n```";
  saveProject(rec);
  return { success: true };
}

/**
 * 设置关联的剧本任务 ID (finalize 桥接后回写)
 * 🔗 把 screenplay 项目和 script_tasks 表的记录关联起来
 */
export function setLinkedScriptTaskId(projectId, taskId) {
  const rec = loadProject(projectId);
  if (!rec) return;
  rec.linkedScriptTaskId = taskId;
  saveProject(rec);
}

/**
 * 设置关联的数据库项目 ID (finalize 桥接后回写)
 * 🔗 防止重复创建 projects 表记录
 */
export function setDbProjectId(projectId, dbProjectId) {
  const rec = loadProject(projectId);
  if (!rec) return;
  rec.dbProjectId = dbProjectId;
  saveProject(rec);
}

/**
 * 删除项目文件
 * 🗑️ 物理删除 JSON 文件
 */
export function deleteProject(projectId) {
  const file = projectFile(projectId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return { success: true };
  }
  return { success: false };
}

/**
 * 保存结构性选择 (如 Step 1 选了哪个分支/option)
 * 🧩 structuralChoices 是一个扁平对象, 支持增量合并
 */
export function saveStructuralChoices(projectId, choices) {
  const rec = loadProject(projectId);
  if (!rec) return { success: false };
  rec.structuralChoices = { ...(rec.structuralChoices ?? {}), ...choices };
  saveProject(rec);
  return { success: true };
}

/**
 * 获取结构性选择
 * 🧩 返回 structuralChoices 对象或 null
 */
export function getStructuralChoices(projectId) {
  const rec = loadProject(projectId);
  return rec?.structuralChoices ?? null;
}

/**
 * 保存记忆检查点
 * 💾 trigger 标识触发位置 (如 "after-step-6"), content 是 LLM 产出的检查点文本
 *
 * @param {string} projectId - 项目 ID
 * @param {string} trigger - 触发位置标识
 * @param {string} content - LLM 产出的检查点文本 (~800-1200 字)
 */
export function saveCheckpoint(projectId, trigger, content) {
  const rec = loadProject(projectId);
  if (!rec) return { success: false };
  if (!rec.checkpoints) rec.checkpoints = {};
  rec.checkpoints[trigger] = content;
  saveProject(rec);
  return { success: true };
}

/**
 * 获取指定触发位置的检查点
 * 📌 返回检查点文本或 null
 */
export function getCheckpoint(projectId, trigger) {
  const rec = loadProject(projectId);
  return rec?.checkpoints?.[trigger] ?? null;
}

/**
 * 列出所有检查点
 * 📋 返回 { trigger: content } 映射
 */
export function listCheckpoints(projectId) {
  const rec = loadProject(projectId);
  return rec?.checkpoints ?? {};
}
