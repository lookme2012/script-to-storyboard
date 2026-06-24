/**
 * index.js — 数据库初始化 + 统一导出所有数据库操作函数
 *
 * 🏠 这是整个数据库层的"总管家"，负责:
 *   1. 初始化 SQLite 数据库连接（路径: userData/zens-data/zens.sqlite）
 *   2. 执行建表语句和迁移语句
 *   3. 把所有子模块的函数统一包装后导出，供 IPC 层调用
 *
 * ⚠️ 因为 sql.js 需要异步加载 WASM，所有 Full 函数都是 async 的
 * 调用方式：const result = await getAppSettingsFull();
 */

import fs from "node:fs";
import path from "node:path";
import { createDatabase } from "./sqliteAdapter.mjs";
import { app } from "../electron-stub.mjs";

import { schemaStatements, migrationStatements } from "./schema.mjs";
import { getAppSettings, saveAppSettings } from "./appSettings.mjs";
import { getProjects, renameProject, deleteProject } from "./projectManagement.mjs";
import { finalizeScreenplayToScriptTask } from "./screenplayFinalize.mjs";
import {
  saveAnalysis,
  loadAnalysis,
  deleteAnalysis,
  upsertUnit,
  listUnits,
  getUnit,
  deleteUnits,
  deleteUnit,
} from "./seedanceStore.mjs";
import {
  getRecentScriptTasks,
  loadScriptTask,
  deleteScriptTask,
  saveScriptDraft,
  updateScriptBody,
  importExistingScript,
} from "./scriptCrud.mjs";
import {
  getRecentImageTasks,
  saveImageDraft,
  runImageGeneration,
  runImageReview,
  deleteImageTask,
} from "./imageCrud.mjs";
import {
  getRecentVideoTasks,
  saveVideoDraft,
  runVideoGeneration,
  runVideoReview,
  deleteVideoTask,
} from "./videoCrud.mjs";
import {
  getAssetsByTask,
  getAssetScan,
  updateAsset,
} from "./assetCrud.mjs";
import {
  generatePrompt,
  generatePromptGroup,
  updatePrompt,
  getPromptsByTask,
  getPromptSceneCount,
  getPromptSegmentTitles,
  runPromptQualityCheck,
  generateOutline,
  confirmOutline,
  getOutline,
} from "./promptCrud.mjs";
import {
  getBuiltinTemplates,
  listAllTemplates,
  getTemplateDetail,
  saveTemplate,
  deleteTemplate,
  resetTemplate,
  buildPromptWithDB,
} from "./promptTemplates.mjs";

let database = null;
let databaseMeta = null;

/**
 * 确保数据目录存在
 * @returns {string} 数据目录的绝对路径
 */
function ensureDataDirectory() {
  const dataDir = path.join(app.getPath("userData"), "zens-data");
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

/**
 * 检查表中是否存在某列，不存在则添加
 * @param {object} db - 数据库实例
 * @param {string} tableName - 表名
 * @param {string} columnName - 列名
 * @param {string} definition - 列定义
 */
function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

/**
 * 执行建表和迁移
 * @param {object} db - 数据库实例
 */
function applySchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  for (const statement of schemaStatements) {
    db.exec(statement);
  }

  ensureColumn(db, "review_records", "dimensions_json", "TEXT");
  ensureColumn(db, "review_records", "priority_json", "TEXT");
  ensureColumn(db, "review_records", "rewrite_example", "TEXT");
  ensureColumn(db, "review_records", "surgery_table_json", "TEXT");
  ensureColumn(db, "review_records", "revision_path_json", "TEXT");
  ensureColumn(db, "script_outputs", "asset_scan_json", "TEXT");
}

/**
 * 初始化数据库（异步）
 * 🚀 首次调用时创建连接、建表、迁移；后续调用直接返回缓存
 * @returns {Promise<{ db: object, meta: { dbPath: string, dataDir: string } }>}
 */
export async function initDatabase() {
  if (database && databaseMeta) {
    return { db: database, meta: databaseMeta };
  }

  const dataDir = ensureDataDirectory();
  const dbPath = path.join(dataDir, "zens.sqlite");
  const db = await createDatabase(dbPath);
  applySchema(db);

  database = db;
  databaseMeta = { dbPath, dataDir };

  return { db, meta: databaseMeta };
}

/**
 * 清理同名重复项目（每次服务器启动时调用）
 * 🧹 合并同名 project，保留最早创建的，把其他同名项目的任务迁移过去
 */
export function cleanupDuplicateProjects(db) {
  const dupes = db.prepare(`
    SELECT name, COUNT(*) AS cnt, MIN(id) AS keeper
    FROM projects
    WHERE module_type = 'script'
    GROUP BY name
    HAVING cnt > 1
  `).all();

  let cleaned = 0;
  for (const dupe of dupes) {
    const toDelete = db.prepare(`
      SELECT id FROM projects WHERE name = ? AND module_type = 'script' AND id != ?
    `).all(dupe.name, dupe.keeper);

    for (const row of toDelete) {
      try {
        db.prepare(`UPDATE script_tasks SET project_id = ? WHERE project_id = ?`)
          .run(dupe.keeper, row.id);
        db.prepare(`DELETE FROM projects WHERE id = ?`).run(row.id);
        cleaned++;
      } catch (e) {
        // 静默跳过
      }
    }
  }
  if (cleaned > 0) console.log(`🧹 已清理 ${cleaned} 个重复项目`);
}

/**
 * 获取数据库元信息
 * @returns {{ dbPath: string, dataDir: string }}
 */
export function getDatabaseMeta() {
  if (!databaseMeta) {
    throw new Error("Database has not been initialized yet.");
  }
  return databaseMeta;
}

// ═══════════════════════════════════════════════════════════════
// 应用设置
// ═══════════════════════════════════════════════════════════════

export async function getAppSettingsFull() {
  const { db } = await initDatabase();
  return getAppSettings(db);
}

export async function saveAppSettingsFull(input) {
  const { db } = await initDatabase();
  return saveAppSettings(db, input);
}

// ═══════════════════════════════════════════════════════════════
// 项目管理
// ═══════════════════════════════════════════════════════════════

export async function getProjectsList() {
  const { db } = await initDatabase();
  return getProjects(db);
}

export async function renameProjectById(projectId, newName) {
  const { db } = await initDatabase();
  return renameProject(db, projectId, newName);
}

export async function deleteProjectById(projectId) {
  const { db } = await initDatabase();
  return deleteProject(db, projectId);
}

// ═══════════════════════════════════════════════════════════════
// 八步工作流 → 老 script_tasks 桥接
// ═══════════════════════════════════════════════════════════════

export async function finalizeScreenplay(input) {
  const { db } = await initDatabase();
  return finalizeScreenplayToScriptTask(db, input);
}

// ═══════════════════════════════════════════════════════════════
// V5 Seedance 分镜 — 分析（Phase A-D）
// ═══════════════════════════════════════════════════════════════

export async function seedanceSaveAnalysis(taskId, analysis) {
  const { db } = await initDatabase();
  return saveAnalysis(db, taskId, analysis);
}

export async function seedanceLoadAnalysis(taskId) {
  const { db } = await initDatabase();
  return loadAnalysis(db, taskId);
}

export async function seedanceDeleteAnalysis(taskId) {
  const { db } = await initDatabase();
  return deleteAnalysis(db, taskId);
}

// ═══════════════════════════════════════════════════════════════
// V5 Seedance 分镜 — 单元（Phase E-F-G）
// ═══════════════════════════════════════════════════════════════

export async function seedanceUpsertUnit(record) {
  const { db } = await initDatabase();
  return upsertUnit(db, record);
}

export async function seedanceListUnits(taskId) {
  const { db } = await initDatabase();
  return listUnits(db, taskId);
}

export async function seedanceGetUnit(taskId, unitIndex) {
  const { db } = await initDatabase();
  return getUnit(db, taskId, unitIndex);
}

export async function seedanceDeleteUnits(taskId) {
  const { db } = await initDatabase();
  return deleteUnits(db, taskId);
}

export async function seedanceDeleteUnit(taskId, unitIndex) {
  const { db } = await initDatabase();
  return deleteUnit(db, taskId, unitIndex);
}

// ═══════════════════════════════════════════════════════════════
// 剧本任务 CRUD
// ═══════════════════════════════════════════════════════════════

export async function getRecentScriptTasksFull(limit) {
  const { db } = await initDatabase();
  return getRecentScriptTasks(db, limit);
}

export async function loadScriptTaskFull(taskId) {
  const { db } = await initDatabase();
  return loadScriptTask(db, taskId);
}

export async function deleteScriptTaskFull(taskId) {
  const { db } = await initDatabase();
  return deleteScriptTask(db, taskId);
}

export async function saveScriptDraftFull(payload) {
  const { db } = await initDatabase();
  return saveScriptDraft(db, payload);
}

export async function updateScriptBodyFull(taskId, newBody) {
  const { db } = await initDatabase();
  return updateScriptBody(db, taskId, newBody);
}

export async function importExistingScriptFull(payload) {
  const { db } = await initDatabase();
  return importExistingScript(db, payload);
}

// ═══════════════════════════════════════════════════════════════
// 图片任务 CRUD
// ═══════════════════════════════════════════════════════════════

export async function getRecentImageTasksFull(limit) {
  const { db } = await initDatabase();
  return getRecentImageTasks(db, limit);
}

export async function saveImageDraftFull(payload) {
  const { db } = await initDatabase();
  return saveImageDraft(db, payload);
}

export async function runImageGenerationFull(payload) {
  const { db } = await initDatabase();
  return runImageGeneration(db, payload);
}

export async function runImageReviewFull(payload) {
  const { db } = await initDatabase();
  return runImageReview(db, payload);
}

export async function deleteImageTaskFull(taskId) {
  const { db } = await initDatabase();
  return deleteImageTask(db, taskId);
}

// ═══════════════════════════════════════════════════════════════
// 视频任务 CRUD
// ═══════════════════════════════════════════════════════════════

export async function getRecentVideoTasksFull(limit) {
  const { db } = await initDatabase();
  return getRecentVideoTasks(db, limit);
}

export async function saveVideoDraftFull(payload) {
  const { db } = await initDatabase();
  return saveVideoDraft(db, payload);
}

export async function runVideoGenerationFull(payload) {
  const { db } = await initDatabase();
  return runVideoGeneration(db, payload);
}

export async function runVideoReviewFull(payload) {
  const { db } = await initDatabase();
  return runVideoReview(db, payload);
}

export async function deleteVideoTaskFull(taskId) {
  const { db } = await initDatabase();
  return deleteVideoTask(db, taskId);
}

// ═══════════════════════════════════════════════════════════════
// 资产 CRUD
// ═══════════════════════════════════════════════════════════════

export async function getAssetsByTaskFull(taskId) {
  const { db } = await initDatabase();
  return getAssetsByTask(db, taskId);
}

export async function getAssetScanFull(taskId) {
  const { db } = await initDatabase();
  return getAssetScan(db, taskId);
}

export async function updateAssetFull(payload) {
  const { db } = await initDatabase();
  return updateAsset(db, payload);
}

// ═══════════════════════════════════════════════════════════════
// 提示词 CRUD
// ═══════════════════════════════════════════════════════════════

export async function generatePromptFull(payload) {
  const { db } = await initDatabase();
  return generatePrompt(db, payload);
}

export async function generatePromptGroupFull(payload) {
  const { db } = await initDatabase();
  return generatePromptGroup(db, payload);
}

export async function updatePromptFull(payload) {
  const { db } = await initDatabase();
  return updatePrompt(db, payload);
}

export async function getPromptsByTaskFull(taskId) {
  const { db } = await initDatabase();
  return getPromptsByTask(db, taskId);
}

export async function getPromptSceneCountFull(taskId) {
  const { db } = await initDatabase();
  return getPromptSceneCount(db, taskId);
}

export async function getPromptSegmentTitlesFull(taskId) {
  const { db } = await initDatabase();
  return getPromptSegmentTitles(db, taskId);
}

export async function runPromptQualityCheckFull(payload) {
  const { db } = await initDatabase();
  return runPromptQualityCheck(db, payload);
}

export async function generateOutlineFull(payload) {
  const { db } = await initDatabase();
  return generateOutline(db, payload);
}

export async function confirmOutlineFull(payload) {
  const { db } = await initDatabase();
  return confirmOutline(db, payload);
}

export async function getOutlineFull(taskId) {
  const { db } = await initDatabase();
  return getOutline(db, taskId);
}

// ═══════════════════════════════════════════════════════════════
// 提示词模板管理
// ═══════════════════════════════════════════════════════════════

export function getBuiltinTemplatesList() {
  return getBuiltinTemplates();
}

export async function listAllTemplatesFull() {
  const { db } = await initDatabase();
  return listAllTemplates(db);
}

export async function getTemplateDetailFull(contextType) {
  const { db } = await initDatabase();
  return getTemplateDetail(db, contextType);
}

export async function saveTemplateFull(data) {
  const { db } = await initDatabase();
  return saveTemplate(db, data);
}

export async function deleteTemplateFull(contextType) {
  const { db } = await initDatabase();
  return deleteTemplate(db, contextType);
}

export async function resetTemplateFull(contextType) {
  const { db } = await initDatabase();
  return resetTemplate(db, contextType);
}

export async function buildPromptWithDBFull(contextType, contextParams) {
  const { db } = await initDatabase();
  return buildPromptWithDB(db, contextType, contextParams);
}
