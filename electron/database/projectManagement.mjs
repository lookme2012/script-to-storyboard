/**
 * projectManagement.js — 项目管理
 *
 * 📁 负责项目的获取、重命名、删除三大操作。
 * 删除项目时会级联删除所有关联的任务和产出数据，
 * 相当于"连根拔起"，非常彻底！
 */

/**
 * 获取所有项目及其下属任务列表
 * 每个项目会关联三种任务（剧本/图片/视频），按更新时间倒序排列
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @returns {Array<object>} 项目列表，每个项目包含 tasks 子数组
 */
export function getProjects(db) {
  const projectRows = db.prepare(`
    SELECT id, name, module_type AS moduleType, status, created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    ORDER BY updated_at DESC
  `).all();

  const scriptTaskQuery = db.prepare(`
    SELECT
      st.id AS taskId,
      'script' AS moduleType,
      st.mode AS mode,
      st.stage AS stage,
      st.updated_at AS updatedAt,
      rr.score AS reviewScore,
      rr.status AS reviewStatus
    FROM script_tasks st
    LEFT JOIN review_records rr ON rr.id = (
      SELECT inner_rr.id FROM review_records inner_rr
      WHERE inner_rr.task_id = st.id
      ORDER BY inner_rr.created_at DESC LIMIT 1
    )
    WHERE st.project_id = ?
    ORDER BY st.updated_at DESC
  `);

  const imageTaskQuery = db.prepare(`
    SELECT id AS taskId, 'image' AS moduleType, mode, stage, updated_at AS updatedAt
    FROM image_tasks WHERE project_id = ? ORDER BY updated_at DESC
  `);

  const videoTaskQuery = db.prepare(`
    SELECT id AS taskId, 'video' AS moduleType, mode, stage, updated_at AS updatedAt
    FROM video_tasks WHERE project_id = ? ORDER BY updated_at DESC
  `);

  return projectRows.map((p) => {
    const rawTasks = [
      ...scriptTaskQuery.all(p.id),
      ...imageTaskQuery.all(p.id),
      ...videoTaskQuery.all(p.id),
    ];
    rawTasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const tasks = rawTasks.map((t) => ({
      taskId: t.taskId,
      moduleType: t.moduleType,
      mode: t.mode,
      stage: t.stage,
      updatedAt: t.updatedAt,
      reviewScore: t.reviewScore ?? undefined,
      reviewStatus: t.reviewStatus ?? undefined,
    }));

    return {
      projectId: p.id,
      projectName: p.name,
      moduleType: p.moduleType,
      status: p.status,
      taskCount: tasks.length,
      latestDate: tasks.length > 0 ? tasks[0].updatedAt : p.updatedAt,
      tasks,
    };
  });
}

/**
 * 重命名项目
 * 简单粗暴，改个名字而已 🏷️
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} projectId - 项目 ID
 * @param {string} newName - 新名称
 * @returns {object} { success, projectId, newName }
 */
export function renameProject(db, projectId, newName) {
  const stmt = db.prepare(`
    UPDATE projects SET name = @name, updated_at = @updatedAt WHERE id = @id
  `);
  stmt.run({ id: projectId, name: newName.trim(), updatedAt: new Date().toISOString() });
  return { success: true, projectId, newName: newName.trim() };
}

/**
 * 删除项目（级联删除所有关联数据）
 * 🗑️ 这是最危险的操作！会依次删除:
 *   - 剧本任务 → 审核记录 + 产出 + 资产 + 提示词产出
 *   - 图片任务 → 产出 + 审核记录
 *   - 视频任务 → 产出 + 审核记录
 *   - 最后删除项目本身
 *
 * 为了防止老数据的脏外键阻塞删除，会临时关闭 FK 约束
 *
 * @param {import('better-sqlite3').Database} db - 数据库实例
 * @param {string} projectId - 要删除的项目 ID
 * @returns {object} { success, projectId }
 */
export function deleteProject(db, projectId) {
  const findScriptTasks = db.prepare("SELECT id FROM script_tasks WHERE project_id = ?");
  const findImageTasks = db.prepare("SELECT id FROM image_tasks WHERE project_id = ?");
  const findVideoTasks = db.prepare("SELECT id FROM video_tasks WHERE project_id = ?");

  const deleteReviewRecords = db.prepare("DELETE FROM review_records WHERE task_id = ?");
  const deleteScriptOutputs = db.prepare("DELETE FROM script_outputs WHERE task_id = ?");
  const deleteAssetRecords = db.prepare("DELETE FROM asset_records WHERE task_id = ?");
  const deletePromptOutputRecords = db.prepare("DELETE FROM prompt_output_records WHERE task_id = ?");
  const deleteScriptTask = db.prepare("DELETE FROM script_tasks WHERE id = ?");

  const deleteImageOutputs = db.prepare("DELETE FROM image_outputs WHERE task_id = ?");
  const deleteImageReviewRecords = db.prepare("DELETE FROM image_review_records WHERE task_id = ?");
  const deleteImageTask = db.prepare("DELETE FROM image_tasks WHERE id = ?");

  const deleteVideoOutputs = db.prepare("DELETE FROM video_outputs WHERE task_id = ?");
  const deleteVideoReviewRecords = db.prepare("DELETE FROM video_review_records WHERE task_id = ?");
  const deleteVideoTask = db.prepare("DELETE FROM video_tasks WHERE id = ?");

  const deleteProjectRow = db.prepare("DELETE FROM projects WHERE id = ?");

  const transaction = db.transaction((pid) => {
    const scriptTasks = findScriptTasks.all(pid);
    for (const task of scriptTasks) {
      deleteReviewRecords.run(task.id);
      deleteScriptOutputs.run(task.id);
      deleteAssetRecords.run(task.id);
      deletePromptOutputRecords.run(task.id);
      deleteScriptTask.run(task.id);
    }

    const imageTasks = findImageTasks.all(pid);
    for (const task of imageTasks) {
      deleteImageOutputs.run(task.id);
      deleteImageReviewRecords.run(task.id);
      deleteImageTask.run(task.id);
    }

    const videoTasks = findVideoTasks.all(pid);
    for (const task of videoTasks) {
      deleteVideoOutputs.run(task.id);
      deleteVideoReviewRecords.run(task.id);
      deleteVideoTask.run(task.id);
    }

    deleteProjectRow.run(pid);
  });

  const fkWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  if (fkWasOn) db.pragma("foreign_keys = OFF");
  try {
    transaction(projectId);
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }

  return { success: true, projectId };
}
