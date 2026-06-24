/**
 * seedanceStore.js — V5 分镜产出的持久化
 *
 * 🎞️ 管理 V5 分镜系统的两张核心表:
 *   · seedance_analysis — Phase A-D 分析结果（一个 taskId 一条记录，幂等 upsert）
 *   · seedance_units    — Phase E-F-G 每单元产出（一个 taskId 多条，按 unitIndex 定位）
 *
 * 简单来说:
 *   analysis = 整体分析（段落索引、结构类型、情绪地图、单元规划）
 *   units    = 每个分镜单元的详细信息（时长、场景类型、COPY区、NOTE区等）
 */

import { randomUUID } from "node:crypto";

// ═══════════════════════════════════════════════════════════════
// Analysis（Phase A-D）— 整体分析结果的读写删
// ═══════════════════════════════════════════════════════════════

/**
 * 保存/更新分镜分析结果
 * 使用 ON CONFLICT DO UPDATE 实现幂等 upsert，同一个 taskId 重复调用会覆盖旧数据
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的剧本任务 ID
 * @param {object} analysis - 分析结果
 * @param {Array} analysis.paragraphIndex - 段落索引
 * @param {string} analysis.structureType - 结构类型
 * @param {object} analysis.emotionMap - 情绪地图
 * @param {Array} analysis.units - 单元规划
 * @param {number} analysis.totalSec - 总时长（秒）
 * @param {number} analysis.totalUnits - 总单元数
 */
export function saveAnalysis(db, taskId, analysis) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO seedance_analysis (task_id, paragraph_index_json, structure_type, emotion_map_json, units_plan_json, total_sec, total_units, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      paragraph_index_json = excluded.paragraph_index_json,
      structure_type       = excluded.structure_type,
      emotion_map_json     = excluded.emotion_map_json,
      units_plan_json      = excluded.units_plan_json,
      total_sec            = excluded.total_sec,
      total_units          = excluded.total_units,
      updated_at           = excluded.updated_at
  `).run(
    taskId,
    JSON.stringify(analysis.paragraphIndex),
    analysis.structureType,
    JSON.stringify(analysis.emotionMap),
    JSON.stringify(analysis.units),
    analysis.totalSec,
    analysis.totalUnits,
    now,
    now
  );
}

/**
 * 读取分镜分析结果
 * 从数据库读出来后把 JSON 字符串还原成对象
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的剧本任务 ID
 * @returns {object|null} 分析结果对象，找不到返回 null
 */
export function loadAnalysis(db, taskId) {
  const row = db.prepare(`
    SELECT paragraph_index_json, structure_type, emotion_map_json, units_plan_json, total_sec, total_units
    FROM seedance_analysis WHERE task_id = ?
  `).get(taskId);

  if (!row) return null;

  try {
    return {
      paragraphIndex: JSON.parse(row.paragraph_index_json),
      structureType: row.structure_type,
      emotionMap: JSON.parse(row.emotion_map_json),
      units: JSON.parse(row.units_plan_json),
      totalSec: row.total_sec,
      totalUnits: row.total_units,
    };
  } catch {
    return null;
  }
}

/**
 * 删除分镜分析结果
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的剧本任务 ID
 */
export function deleteAnalysis(db, taskId) {
  db.prepare(`DELETE FROM seedance_analysis WHERE task_id = ?`).run(taskId);
}

// ═══════════════════════════════════════════════════════════════
// Units（Phase E-F-G）— 分镜单元的增删改查
// ═══════════════════════════════════════════════════════════════

/**
 * 插入或更新一个分镜单元
 * 如果该 taskId + unitIndex 已存在则更新，否则插入新记录
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {object} record - 单元数据
 * @param {string} [record.id] - 可选的记录 ID
 * @param {string} record.taskId - 关联的任务 ID
 * @param {number} record.unitIndex - 单元序号
 * @param {number} record.durationSec - 时长（秒）
 * @param {string} record.sceneType - 场景类型
 * @param {number} record.subShotCount - 子镜头数
 * @param {string} record.copyArea - COPY 区内容
 * @param {object} record.noteArea - NOTE 区内容
 * @param {string} record.status - 状态
 * @param {number} record.retryCount - 重试次数
 * @param {string} [record.errorMessage] - 错误信息
 * @returns {object} 完整的单元记录（含 id、时间戳等）
 */
export function upsertUnit(db, record) {
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT id, created_at FROM seedance_units WHERE task_id = ? AND unit_index = ?
  `).get(record.taskId, record.unitIndex);

  const id = existing?.id ?? record.id ?? randomUUID();
  const createdAt = existing?.created_at ?? now;

  if (existing) {
    db.prepare(`
      UPDATE seedance_units SET
        duration_sec = ?, scene_type = ?, sub_shot_count = ?,
        copy_area = ?, note_area_json = ?,
        status = ?, retry_count = ?, error_message = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      record.durationSec, record.sceneType, record.subShotCount,
      record.copyArea, JSON.stringify(record.noteArea),
      record.status, record.retryCount, record.errorMessage ?? null,
      now, id
    );
  } else {
    db.prepare(`
      INSERT INTO seedance_units (
        id, task_id, unit_index, duration_sec, scene_type, sub_shot_count,
        copy_area, note_area_json, status, retry_count, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, record.taskId, record.unitIndex,
      record.durationSec, record.sceneType, record.subShotCount,
      record.copyArea, JSON.stringify(record.noteArea),
      record.status, record.retryCount, record.errorMessage ?? null,
      createdAt, now
    );
  }

  return {
    id,
    taskId: record.taskId,
    unitIndex: record.unitIndex,
    durationSec: record.durationSec,
    sceneType: record.sceneType,
    subShotCount: record.subShotCount,
    copyArea: record.copyArea,
    noteArea: record.noteArea,
    status: record.status,
    retryCount: record.retryCount,
    errorMessage: record.errorMessage,
    createdAt,
    updatedAt: now,
  };
}

/**
 * 获取某个任务下的所有分镜单元
 * 按 unit_index 升序排列，保证和创作顺序一致
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的任务 ID
 * @returns {Array<object>} 单元列表
 */
export function listUnits(db, taskId) {
  const rows = db.prepare(`
    SELECT id, task_id, unit_index, duration_sec, scene_type, sub_shot_count,
           copy_area, note_area_json, status, retry_count, error_message, created_at, updated_at
    FROM seedance_units WHERE task_id = ? ORDER BY unit_index ASC
  `).all(taskId);

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    unitIndex: r.unit_index,
    durationSec: r.duration_sec,
    sceneType: r.scene_type,
    subShotCount: r.sub_shot_count,
    copyArea: r.copy_area ?? "",
    noteArea: r.note_area_json
      ? JSON.parse(r.note_area_json)
      : { traceback: "", selfCheckReport: {} },
    status: r.status,
    retryCount: r.retry_count,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * 获取某个任务下指定序号的分镜单元
 * 就是在 listUnits 的结果里找对应 unitIndex 的那一条
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的任务 ID
 * @param {number} unitIndex - 单元序号
 * @returns {object|null} 单元记录，找不到返回 null
 */
export function getUnit(db, taskId, unitIndex) {
  const all = listUnits(db, taskId);
  return all.find((u) => u.unitIndex === unitIndex) ?? null;
}

/**
 * 删除某个任务下的所有分镜单元
 * 🧹 一把梭哈，全删！
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的任务 ID
 */
export function deleteUnits(db, taskId) {
  db.prepare(`DELETE FROM seedance_units WHERE task_id = ?`).run(taskId);
}

/**
 * 删除某个任务下指定序号的分镜单元
 * 精准打击，只删一条 🎯
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的任务 ID
 * @param {number} unitIndex - 单元序号
 */
export function deleteUnit(db, taskId, unitIndex) {
  db.prepare(`DELETE FROM seedance_units WHERE task_id = ? AND unit_index = ?`).run(taskId, unitIndex);
}
