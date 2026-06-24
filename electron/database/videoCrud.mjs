export function getRecentVideoTasks(db, limit = 20) {
  const tasks = db.prepare(
    `SELECT vt.*, vo.sections_json, vo.raw_response,
            vo.created_at AS output_created_at
     FROM video_tasks vt
     LEFT JOIN video_outputs vo ON vo.task_id = vt.id
     ORDER BY vt.created_at DESC
     LIMIT ?`
  ).all(limit);
  return tasks;
}

export function saveVideoDraft(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const existing = db.prepare(`SELECT id FROM video_tasks WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(
      `UPDATE video_tasks
       SET project_id = COALESCE(?, project_id),
           mode = COALESCE(?, mode),
           script_beats = COALESCE(?, script_beats),
           video_style = COALESCE(?, video_style),
           motion_focus = COALESCE(?, motion_focus),
           stage = 'draft',
           updated_at = ?
       WHERE id = ?`
    ).run(
      payload.project_id ?? null,
      payload.mode ?? null,
      payload.script_beats ?? null,
      payload.video_style ?? null,
      payload.motion_focus ?? null,
      now,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO video_tasks (id, project_id, mode, script_beats, video_style, motion_focus, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(
      id,
      payload.project_id || '',
      payload.mode || 'free',
      payload.script_beats || null,
      payload.video_style || null,
      payload.motion_focus || null,
      now,
      now
    );
  }
  return { id, stage: 'draft' };
}

export function runVideoGeneration(db, payload) {
  const now = new Date().toISOString();
  const taskId = payload.task_id;
  db.prepare(
    `UPDATE video_tasks SET stage = 'generating', updated_at = ? WHERE id = ?`
  ).run(now, taskId);
  const outputId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO video_outputs (id, task_id, sections_json, raw_response, created_at)
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

export function runVideoReview(db, payload) {
  const now = new Date().toISOString();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO video_review_records (id, task_id, score, status, summary, issues_json, suggestions_json, review_model, created_at)
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

export const deleteVideoTask = (function () {
  return function (db, taskId) {
    const doDelete = db.transaction(() => {
      db.prepare(`DELETE FROM video_review_records WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM video_outputs WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM video_tasks WHERE id = ?`).run(taskId);
    });
    doDelete();
    return { success: true, taskId };
  };
})();
