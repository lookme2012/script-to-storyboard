export function generatePrompt(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  db.prepare(
    `INSERT INTO prompt_output_records (id, task_id, grid_groups_json, seedance_groups_json, generation_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.task_id,
    typeof payload.grid_groups_json === 'string'
      ? payload.grid_groups_json
      : JSON.stringify(payload.grid_groups_json || {}),
    typeof payload.seedance_groups_json === 'string'
      ? payload.seedance_groups_json
      : JSON.stringify(payload.seedance_groups_json || {}),
    payload.generation_model || null,
    now
  );
  return { id, task_id: payload.task_id, created_at: now };
}

export function generatePromptGroup(db, payload) {
  const now = new Date().toISOString();
  const items = payload.items || [];
  const results = [];
  const doInsert = db.transaction(() => {
    for (const item of items) {
      const id = item.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      db.prepare(
        `INSERT INTO prompt_output_records (id, task_id, grid_groups_json, seedance_groups_json, generation_model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        item.task_id || payload.task_id,
        typeof item.grid_groups_json === 'string'
          ? item.grid_groups_json
          : JSON.stringify(item.grid_groups_json || {}),
        typeof item.seedance_groups_json === 'string'
          ? item.seedance_groups_json
          : JSON.stringify(item.seedance_groups_json || {}),
        item.generation_model || payload.generation_model || null,
        now
      );
      results.push({ id, task_id: item.task_id || payload.task_id, created_at: now });
    }
  });
  doInsert();
  return results;
}

export function updatePrompt(db, payload) {
  const sets = [];
  const values = [];
  if (payload.grid_groups_json !== undefined) {
    sets.push('grid_groups_json = ?');
    values.push(
      typeof payload.grid_groups_json === 'string'
        ? payload.grid_groups_json
        : JSON.stringify(payload.grid_groups_json)
    );
  }
  if (payload.seedance_groups_json !== undefined) {
    sets.push('seedance_groups_json = ?');
    values.push(
      typeof payload.seedance_groups_json === 'string'
        ? payload.seedance_groups_json
        : JSON.stringify(payload.seedance_groups_json)
    );
  }
  if (payload.generation_model !== undefined) {
    sets.push('generation_model = ?');
    values.push(payload.generation_model);
  }
  if (sets.length === 0) return { success: true };
  values.push(payload.id);
  db.prepare(`UPDATE prompt_output_records SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return { success: true };
}

export function getPromptsByTask(db, taskId) {
  return db.prepare(
    `SELECT * FROM prompt_output_records WHERE task_id = ? ORDER BY created_at ASC`
  ).all(taskId);
}

export function getPromptSceneCount(db, taskId) {
  const rows = db.prepare(
    `SELECT grid_groups_json FROM prompt_output_records WHERE task_id = ?`
  ).all(taskId);
  let count = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.grid_groups_json);
      if (Array.isArray(parsed)) {
        count += parsed.length;
      } else if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed);
        for (const key of keys) {
          if (Array.isArray(parsed[key])) {
            count += parsed[key].length;
          }
        }
        if (keys.length === 0) {
          count += 1;
        }
      } else {
        count += 1;
      }
    } catch {
      count += 1;
    }
  }
  return count;
}

export function getPromptSegmentTitles(db, taskId) {
  const rows = db.prepare(
    `SELECT grid_groups_json FROM prompt_output_records WHERE task_id = ?`
  ).all(taskId);
  const titles = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.grid_groups_json);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.title) titles.push(item.title);
          else if (item && item.segment_title) titles.push(item.segment_title);
        }
      } else if (parsed && typeof parsed === 'object') {
        if (parsed.title) titles.push(parsed.title);
        else if (parsed.segment_title) titles.push(parsed.segment_title);
      }
    } catch {
      // skip
    }
  }
  return titles;
}

export function runPromptQualityCheck(db, payload) {
  return { score: 0, status: 'pending' };
}

export function generateOutline(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const gridGroups = {
    type: 'outline',
    status: 'draft',
    ...((typeof payload.grid_groups_json === 'string'
      ? JSON.parse(payload.grid_groups_json)
      : payload.grid_groups_json) || {}),
  };
  db.prepare(
    `INSERT INTO prompt_output_records (id, task_id, grid_groups_json, seedance_groups_json, generation_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.task_id,
    JSON.stringify(gridGroups),
    typeof payload.seedance_groups_json === 'string'
      ? payload.seedance_groups_json
      : JSON.stringify(payload.seedance_groups_json || {}),
    payload.generation_model || null,
    now
  );
  return { id, task_id: payload.task_id, type: 'outline', created_at: now };
}

export function confirmOutline(db, payload) {
  const row = db.prepare(
    `SELECT grid_groups_json FROM prompt_output_records WHERE id = ?`
  ).get(payload.id);
  if (!row) return { success: false };
  let gridGroups;
  try {
    gridGroups = JSON.parse(row.grid_groups_json);
  } catch {
    gridGroups = {};
  }
  gridGroups.status = 'confirmed';
  db.prepare(
    `UPDATE prompt_output_records SET grid_groups_json = ? WHERE id = ?`
  ).run(JSON.stringify(gridGroups), payload.id);
  return { success: true, id: payload.id, status: 'confirmed' };
}

export function getOutline(db, taskId) {
  const rows = db.prepare(
    `SELECT * FROM prompt_output_records WHERE task_id = ? ORDER BY created_at DESC`
  ).all(taskId);
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.grid_groups_json);
      if (parsed && parsed.type === 'outline') {
        return { ...row, grid_groups_json: parsed };
      }
    } catch {
      // skip
    }
  }
  return null;
}
