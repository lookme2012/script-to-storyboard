export function getRecentScriptTasks(db, limit = 20) {
  const tasks = db.prepare(
    `SELECT st.*, so.characters_json, so.plot_outline, so.script_body,
            so.hook_opening, so.storyboard_base, so.raw_response,
            so.asset_scan_json, so.created_at AS output_created_at
     FROM script_tasks st
     LEFT JOIN script_outputs so ON so.task_id = st.id
     ORDER BY st.created_at DESC
     LIMIT ?`
  ).all(limit);
  return tasks;
}

export function loadScriptTask(db, taskId) {
  const task = db.prepare(
    `SELECT * FROM script_tasks WHERE id = ?`
  ).get(taskId);
  if (!task) return null;
  const output = db.prepare(
    `SELECT * FROM script_outputs WHERE task_id = ?`
  ).get(taskId);
  return { ...task, output: output || null };
}

export const deleteScriptTask = (function () {
  return function (db, taskId) {
    const doDelete = db.transaction(() => {
      db.prepare(`DELETE FROM review_records WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM script_outputs WHERE task_id = ?`).run(taskId);
      db.prepare(`DELETE FROM script_tasks WHERE id = ?`).run(taskId);
    });
    doDelete();
    return { success: true, taskId };
  };
})();

export function saveScriptDraft(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const existing = db.prepare(`SELECT id FROM script_tasks WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(
      `UPDATE script_tasks
       SET project_id = COALESCE(?, project_id),
           mode = COALESCE(?, mode),
           input_summary = COALESCE(?, input_summary),
           genre = COALESCE(?, genre),
           style = COALESCE(?, style),
           duration = COALESCE(?, duration),
           stage = 'draft',
           updated_at = ?
       WHERE id = ?`
    ).run(
      payload.project_id ?? null,
      payload.mode ?? null,
      payload.input_summary ?? null,
      payload.genre ?? null,
      payload.style ?? null,
      payload.duration ?? null,
      now,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO script_tasks (id, project_id, mode, input_summary, genre, style, duration, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(
      id,
      payload.project_id || '',
      payload.mode || 'free',
      payload.input_summary || null,
      payload.genre || null,
      payload.style || null,
      payload.duration || null,
      now,
      now
    );
  }
  const existingOutput = db.prepare(`SELECT id FROM script_outputs WHERE task_id = ?`).get(id);
  if (!existingOutput) {
    const outputId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    db.prepare(
      `INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      outputId,
      id,
      payload.characters_json || null,
      payload.plot_outline || null,
      payload.script_body || null,
      payload.hook_opening || null,
      payload.storyboard_base || null,
      payload.raw_response || null,
      now
    );
  }
  return { id, stage: 'draft' };
}

export function updateScriptBody(db, taskId, newBody) {
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id FROM script_outputs WHERE task_id = ?`).get(taskId);
  if (existing) {
    db.prepare(
      `UPDATE script_outputs SET script_body = ? WHERE task_id = ?`
    ).run(newBody, taskId);
  } else {
    const outputId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    db.prepare(
      `INSERT INTO script_outputs (id, task_id, script_body, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(outputId, taskId, newBody, now);
  }
  db.prepare(
    `UPDATE script_tasks SET updated_at = ? WHERE id = ?`
  ).run(now, taskId);
  return { success: true, taskId };
}

export function importExistingScript(db, payload) {
  const now = new Date().toISOString();
  const projectId = payload.project_id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const taskId = payload.task_id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const outputId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const doImport = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, name, module_type, status, created_at, updated_at)
       VALUES (?, ?, 'script', 'active', ?, ?)`
    ).run(projectId, payload.project_name || '导入剧本', now, now);

    db.prepare(
      `INSERT INTO script_tasks (id, project_id, mode, input_summary, genre, style, duration, stage, created_at, updated_at)
       VALUES (?, ?, 'import', ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(
      taskId,
      projectId,
      payload.input_summary || null,
      payload.genre || null,
      payload.style || null,
      payload.duration || null,
      now,
      now
    );

    db.prepare(
      `INSERT INTO script_outputs (id, task_id, characters_json, plot_outline, script_body, hook_opening, storyboard_base, raw_response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      outputId,
      taskId,
      payload.characters_json || null,
      payload.plot_outline || null,
      payload.script_body || '',
      payload.hook_opening || null,
      payload.storyboard_base || null,
      payload.raw_response || null,
      now
    );
  });

  doImport();
  return { projectId, taskId, outputId };
}
