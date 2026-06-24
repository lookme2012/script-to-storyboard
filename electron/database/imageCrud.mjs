export function getRecentImageTasks(db, limit = 20) {
  const tasks = db.prepare(
    `SELECT it.*, io.sections_json, io.raw_response,
            io.created_at AS output_created_at
     FROM image_tasks it
     LEFT JOIN image_outputs io ON io.task_id = it.id
     ORDER BY it.created_at DESC
     LIMIT ?`
  ).all(limit);
  return tasks;
}

export function saveImageDraft(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const existing = db.prepare(`SELECT id FROM image_tasks WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(
      `UPDATE image_tasks
       SET project_id = COALESCE(?, project_id),
           mode = COALESCE(?, mode),
           source_script = COALESCE(?, source_script),
           visual_style = COALESCE(?, visual_style),
           image_goal = COALESCE(?, image_goal),
           stage = 'draft',
           updated_at = ?
       WHERE id = ?`
    ).run(
      payload.project_id ?? null,
      payload.mode ?? null,
      payload.source_script ?? null,
      payload.visual_style ?? null,
      payload.image_goal ?? null,
      now,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO image_tasks (id, project_id, mode, source_script, visual_style, image_goal, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(
      id,
      payload.project_id || '',
      payload.mode || 'free',
      payload.source_script || null,
      payload.visual_style || null,
      payload.image_goal || null,
      now,
      now
    );
  }
  return { id, stage: 'draft' };
}

export function runImageGeneration(db, payload) {
  const now = new Date().toISOString();
  const taskId = payload.task_id;
  db.prepare(
    `UPDATE image_tasks SET stage = 'generating', updated_at = ? WHERE id = ?`
  ).run(now, taskId);
  const outputId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO image_outputs (id, task_id, sections_json, raw_response, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    outputId,
    taskId,
    payload.sections_json || null,
    payload.raw_response || null,
    now
  );
  return { taskId, outputId, stage: 'generating' };
}

export function runImageReview(db, payload) {
  const now = new Date().toISOString();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO image_review_records (id, task_id, score, status, summary, issues_json, suggestions_json, review_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.task_id,
    payload.score ?? null,
    payload.status || null,
    payload.summary || null,
    payload.issues_json || null,
    payload.suggestions_json || null,
    payload.review_model || null,
    now
  );
  return { id, taskId: payload.task_id };
}

export const deleteImageTask = (function () {
  return function (db, taskId) {
    const doDelete = db.transaction(() => {
      db.prepare(`DELETE FROM image_review_records WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM image_outputs WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM image_tasks WHERE id = ?`).run(taskId);
    });
    doDelete();
    return { success: true, taskId };
  };
})();
