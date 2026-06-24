/**
 * schema.js — 数据库表结构定义
 *
 * 🗂️ 这里定义了 抓耳挠腮 全部 14 张核心表的 CREATE TABLE 语句，
 * 以及后续版本迭代需要的 ALTER TABLE 迁移语句。
 *
 * 表清单:
 *   1. projects            — 项目主表
 *   2. script_tasks        — 剧本任务
 *   3. script_outputs      — 剧本产出
 *   4. image_tasks         — 图片任务
 *   5. image_outputs       — 图片产出
 *   6. video_tasks         — 视频任务
 *   7. video_outputs       — 视频产出
 *   8. video_review_records — 视频审核记录
 *   9. image_review_records — 图片审核记录
 *  10. review_records      — 剧本审核记录
 *  11. app_settings        — 应用设置
 *  12. asset_records       — 资产记录（角色/场景/道具）
 *  13. prompt_output_records — 提示词产出记录
 *  14. seedance_analysis   — V5 分镜分析结果
 *  15. seedance_units      — V5 分镜单元
 */

export const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS script_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_summary TEXT,
      genre TEXT,
      style TEXT,
      duration TEXT,
      stage TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS script_outputs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      characters_json TEXT,
      plot_outline TEXT,
      script_body TEXT,
      hook_opening TEXT,
      storyboard_base TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS image_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      source_script TEXT,
      visual_style TEXT,
      image_goal TEXT,
      stage TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS image_outputs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sections_json TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES image_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS video_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      script_beats TEXT,
      video_style TEXT,
      motion_focus TEXT,
      stage TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS video_outputs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sections_json TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES video_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS video_review_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      score INTEGER,
      status TEXT NOT NULL,
      summary TEXT,
      issues_json TEXT,
      suggestions_json TEXT,
      review_model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES video_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS image_review_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      score INTEGER,
      status TEXT NOT NULL,
      summary TEXT,
      issues_json TEXT,
      suggestions_json TEXT,
      review_model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES image_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS review_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      score INTEGER,
      status TEXT NOT NULL,
      summary TEXT,
      issues_json TEXT,
      suggestions_json TEXT,
      dimensions_json TEXT,
      priority_json TEXT,
      rewrite_example TEXT,
      review_model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS asset_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      asset_data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS prompt_output_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      grid_groups_json TEXT NOT NULL,
      seedance_groups_json TEXT NOT NULL,
      generation_model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS seedance_analysis (
      task_id TEXT PRIMARY KEY,
      paragraph_index_json TEXT NOT NULL,
      structure_type TEXT,
      emotion_map_json TEXT NOT NULL,
      units_plan_json TEXT NOT NULL,
      total_sec INTEGER,
      total_units INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS seedance_units (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      unit_index INTEGER NOT NULL,
      duration_sec INTEGER,
      scene_type TEXT,
      sub_shot_count INTEGER,
      copy_area TEXT,
      note_area_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, unit_index),
      FOREIGN KEY (task_id) REFERENCES script_tasks(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS prompt_templates (
      context_type TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT '自定义',
      system_prompt TEXT NOT NULL DEFAULT '',
      user_prompt TEXT NOT NULL DEFAULT '',
      is_override INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
];

/**
 * 迁移语句 — 用于给老版本的表追加新字段
 *
 * 🏗️ 随着版本迭代，有些表需要加列。
 * 这里用 ALTER TABLE ADD COLUMN 实现，配合 ensureColumn() 做幂等检查。
 */
export const migrationStatements = [
  `ALTER TABLE review_records ADD COLUMN surgery_table_json TEXT`,
  `ALTER TABLE review_records ADD COLUMN revision_path_json TEXT`,
];
