export function getAssetsByTask(db, taskId) {
  return db.prepare(
    `SELECT * FROM asset_records WHERE task_id = ? ORDER BY created_at ASC`
  ).all(taskId);
}

export function getAssetScan(db, taskId) {
  const row = db.prepare(
    `SELECT asset_scan_json FROM script_outputs WHERE task_id = ?`
  ).get(taskId);
  if (!row || !row.asset_scan_json) return null;
  try {
    return JSON.parse(row.asset_scan_json);
  } catch {
    return null;
  }
}

export function updateAsset(db, payload) {
  const now = new Date().toISOString();
  const existing = db.prepare(
    `SELECT id FROM asset_records WHERE id = ?`
  ).get(payload.id);
  if (existing) {
    db.prepare(
      `UPDATE asset_records SET asset_data_json = ?, asset_type = COALESCE(?, asset_type) WHERE id = ?`
    ).run(
      typeof payload.asset_data_json === 'string'
        ? payload.asset_data_json
        : JSON.stringify(payload.asset_data_json),
      payload.asset_type || null,
      payload.id
    );
  } else {
    const id = payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    db.prepare(
      `INSERT INTO asset_records (id, task_id, asset_type, asset_data_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.task_id,
      payload.asset_type || 'unknown',
      typeof payload.asset_data_json === 'string'
        ? payload.asset_data_json
        : JSON.stringify(payload.asset_data_json),
      now
    );
  }
  return { success: true };
}
