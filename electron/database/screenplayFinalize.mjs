/**
 * screenplayFinalize.js — 八步工作流到老 script_tasks 表的桥接
 *
 * 🌉 当八步工作流的 Step 7（写作）通过后，需要把产出数据
 * 写入 projects + script_tasks + script_outputs + review_records
 * 这四张表，让 ProjectDashboard 顶部管线（资产/提示词/画布）自动解锁。
 *
 * 支持两种场景:
 *   · 第一次 finalize（无 linkedScriptTaskId）: 新建全套
 *   · 第二次+ finalize（有 linkedScriptTaskId）: 更新 script_body + 新增一条 review 记录
 *
 * 强制 review.status = "passed"，score 取自 DoctorReport.totalScore。
 * Step 7 未经医生时用骨架 review（score=80, summary="Step 7 写作完成"）。
 */

import { randomUUID } from "node:crypto";

/**
 * 把场景数组拼接成完整的剧本正文文本
 * 每个场景 = 标题（含时长）+ 节奏信息 + 正文
 *
 * @param {Array<object>} scenes - 场景列表，每项含 header/body/duration/plotRhythm/emotionRhythm
 * @returns {string} 拼接后的完整剧本文本
 */
function buildBodyText(scenes) {
  return scenes
    .map((s) => {
      const rhythm = `  情节节奏：${s.plotRhythm} | 情感节奏：${s.emotionRhythm}`;
      const headerHasDuration = /[（(][^)）]*?\d+[^)）]*?秒[)）]\s*$/.test(s.header);
      const headerWithDuration = headerHasDuration ? s.header : `${s.header}（${s.duration}）`;
      return `${headerWithDuration}\n${rhythm}\n\n${s.body}`;
    })
    .join("\n\n\n");
}

/**
 * 把 "约 45 秒" / "约 1 分 30 秒" / "约 2 分钟" 解析为秒数
 * 解析失败则返回默认 15 秒
 *
 * @param {string} duration - 时长描述字符串
 * @returns {number} 秒数
 */
function parseDurationToSec(duration) {
  if (!duration) return 15;
  const minMatch = duration.match(/(\d+)\s*分/);
  const secMatch = duration.match(/(\d+)\s*秒/);
  const min = minMatch ? parseInt(minMatch[1], 10) : 0;
  const sec = secMatch ? parseInt(secMatch[1], 10) : 0;
  const total = min * 60 + sec;
  return total > 0 ? total : 15;
}

/**
 * 构造一条骨架审核记录
 * 如果有 DoctorReport 就用它的分数和诊断，否则给个默认的 80 分
 *
 * @param {object|undefined} doctor - Step 8 医生诊断结果（可选）
 * @returns {object} 审核记录数据
 */
function buildSkeletonReview(doctor) {
  const score = typeof doctor?.totalScore === "number" ? doctor.totalScore : 80;
  const summary = doctor?.verdict ?? "Step 7 写作完成";
  const dimensions = doctor?.dimensions ?? [
    { name: "人物", score: 80, comment: "screenplay 八步产出" },
    { name: "结构", score: 80, comment: "screenplay 八步产出" },
    { name: "对白", score: 80, comment: "screenplay 八步产出" },
    { name: "情绪曲线", score: 80, comment: "screenplay 八步产出" },
    { name: "潜台词", score: 80, comment: "screenplay 八步产出" },
    { name: "结尾钩子", score: 80, comment: "screenplay 八步产出" },
  ];
  const issues = doctor?.issues ?? [];
  const rewriteExample = doctor?.surgery?.length
    ? doctor.surgery.map((s) => `原文: ${s.original}\n诊断: ${s.diagnosis}\n改写: ${s.rewrite}`).join("\n\n")
    : "";
  const surgeryTable = doctor?.surgery ?? [];
  const revisionPath = doctor?.revisionPath ?? [];

  return {
    score,
    status: "passed",
    summary,
    issues,
    suggestions: [],
    dimensions,
    priority: [],
    rewriteExample,
    surgeryTable,
    revisionPath,
    reviewModel: "screenplay-8steps",
  };
}

/**
 * 插入一条审核记录到 review_records 表
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} taskId - 关联的任务 ID
 * @param {object} r - 审核数据对象
 * @param {string} now - 当前时间 ISO 字符串
 */
function insertReviewRecord(db, taskId, r, now) {
  db.prepare(`
    INSERT INTO review_records (
      id, task_id, score, status, summary,
      issues_json, suggestions_json, dimensions_json, priority_json,
      rewrite_example, surgery_table_json, revision_path_json,
      review_model, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), taskId, r.score, r.status, r.summary,
    JSON.stringify(r.issues), JSON.stringify(r.suggestions),
    JSON.stringify(r.dimensions), JSON.stringify(r.priority),
    r.rewriteExample, JSON.stringify(r.surgeryTable),
    JSON.stringify(r.revisionPath), r.reviewModel, now
  );
}

/**
 * 把八步工作流产出桥接到老 script_tasks 体系
 * 🎬 这是八步工作流和传统管线之间的"翻译官"
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {object} input - 桥接输入
 * @param {string} input.projectName - 项目名称
 * @param {string} input.duration - 总时长
 * @param {string} [input.concept] - 概念摘要
 * @param {string} [input.linkedScriptTaskId] - 已关联的任务 ID（二次 finalize 时传入）
 * @param {Array} input.scenes - 场景列表
 * @param {object} [input.doctor] - 医生诊断结果
 * @returns {object} { projectId, taskId, bodyText, wasCreate }
 */
export function finalizeScreenplayToScriptTask(db, input) {
  const now = new Date().toISOString();
  const bodyText = buildBodyText(input.scenes);
  const review = buildSkeletonReview(input.doctor);

  if (input.linkedScriptTaskId) {
    const existsRow = db.prepare(
      `SELECT id, project_id AS projectId FROM script_tasks WHERE id = ?`
    ).get(input.linkedScriptTaskId);

    if (existsRow) {
      db.transaction(() => {
        db.prepare(
          `UPDATE script_tasks SET updated_at = ?, stage = 'reviewed_passed' WHERE id = ?`
        ).run(now, existsRow.id);

        const rawResponseJson = JSON.stringify({
          sections: input.scenes.map((s) => ({
            title: s.header,
            content: s.body,
            durationSec: parseDurationToSec(s.duration),
            plotRhythm: s.plotRhythm,
            emotionRhythm: s.emotionRhythm,
          })),
        });

        const latestOutput = db.prepare(`
          SELECT id FROM script_outputs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(existsRow.id);

        if (latestOutput) {
          db.prepare(`
            UPDATE script_outputs
            SET script_body = ?, plot_outline = ?, hook_opening = ?, storyboard_base = ?, raw_response = ?
            WHERE id = ?
          `).run(bodyText, bodyText, bodyText, bodyText, rawResponseJson, latestOutput.id);
        } else {
          db.prepare(`
            INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
            VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?)
          `).run(randomUUID(), existsRow.id, bodyText, bodyText, bodyText, bodyText, rawResponseJson, now);
        }

        insertReviewRecord(db, existsRow.id, review, now);
      })();

      return {
        projectId: existsRow.projectId,
        taskId: existsRow.id,
        bodyText,
        wasCreate: false,
      };
    }
  }

  // 🛡️ 防重复：按项目名称查重，如果已存在同名项目则复用
  if (input.dbProjectId) {
    const dbProj = db.prepare(
      `SELECT id FROM projects WHERE id = ?`
    ).get(input.dbProjectId);
    if (dbProj) {
      const projectId = dbProj.id;
      const taskId = randomUUID();
      db.transaction(() => {
        db.prepare(`
          UPDATE projects SET updated_at = ? WHERE id = ?
        `).run(now, projectId);

        db.prepare(`
          INSERT INTO script_tasks (id, project_id, mode, input_summary, genre, style, duration, stage, created_at, updated_at)
          VALUES (?, ?, 'plot', ?, '', '', ?, 'reviewed_passed', ?, ?)
        `).run(taskId, projectId, summary, input.duration, now, now);

        const rawResponseJson = JSON.stringify({
          sections: input.scenes.map((s) => ({
            title: s.header,
            content: s.body,
            durationSec: parseDurationToSec(s.duration),
            plotRhythm: s.plotRhythm,
            emotionRhythm: s.emotionRhythm,
          })),
        });

        db.prepare(`
          INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
          VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), taskId, bodyText, bodyText, bodyText, bodyText, rawResponseJson, now);

        insertReviewRecord(db, taskId, review, now);
      })();

      return { projectId, taskId, bodyText, wasCreate: false };
    }
  }

  // 🛡️ 双重防重复：按项目名称查重（兜底方案）
  const existingByName = db.prepare(
    `SELECT id FROM projects WHERE name = ? AND module_type = 'script' ORDER BY created_at ASC LIMIT 1`
  ).get(input.projectName);
  if (existingByName) {
    const projectId = existingByName.id;
    const taskId = randomUUID();
    db.transaction(() => {
      db.prepare(`
        UPDATE projects SET updated_at = ? WHERE id = ?
      `).run(now, projectId);

      db.prepare(`
        INSERT INTO script_tasks (id, project_id, mode, input_summary, genre, style, duration, stage, created_at, updated_at)
        VALUES (?, ?, 'plot', ?, '', '', ?, 'reviewed_passed', ?, ?)
      `).run(taskId, projectId, summary, input.duration, now, now);

      const rawResponseJson = JSON.stringify({
        sections: input.scenes.map((s) => ({
          title: s.header,
          content: s.body,
          durationSec: parseDurationToSec(s.duration),
          plotRhythm: s.plotRhythm,
          emotionRhythm: s.emotionRhythm,
        })),
      });

      db.prepare(`
        INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
        VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), taskId, bodyText, bodyText, bodyText, bodyText, rawResponseJson, now);

      insertReviewRecord(db, taskId, review, now);
    })();

    return { projectId, taskId, bodyText, wasCreate: false };
  }

  const projectId = randomUUID();
  const taskId = randomUUID();
  const firstBody = bodyText.trim() || input.projectName;
  const summary = (
    input.concept?.trim() ||
    firstBody.split(/\r?\n/).find((l) => l.trim().length)?.trim() ||
    input.projectName
  ).slice(0, 200);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO projects (id, name, module_type, status, created_at, updated_at)
      VALUES (?, ?, 'script', 'active', ?, ?)
    `).run(projectId, input.projectName, now, now);

    db.prepare(`
      INSERT INTO script_tasks (id, project_id, mode, input_summary, genre, style, duration, stage, created_at, updated_at)
      VALUES (?, ?, 'plot', ?, '', '', ?, 'reviewed_passed', ?, ?)
    `).run(taskId, projectId, summary, input.duration, now, now);

    const rawResponseJson = JSON.stringify({
      sections: input.scenes.map((s) => ({
        title: s.header,
        content: s.body,
        durationSec: parseDurationToSec(s.duration),
        plotRhythm: s.plotRhythm,
        emotionRhythm: s.emotionRhythm,
      })),
    });

    db.prepare(`
      INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
      VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), taskId, bodyText, bodyText, bodyText, bodyText, rawResponseJson, now);

    insertReviewRecord(db, taskId, review, now);
  })();

  return { projectId, taskId, bodyText, wasCreate: true };
}
