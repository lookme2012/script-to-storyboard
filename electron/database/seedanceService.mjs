/**
 * seedanceService · V5 分镜生产
 *
 * 🎬 对齐 V5 模板 (98KB, 铁律 + Phase A-G).
 *
 * 架构:
 *   1. runPhaseAD(taskId) — 单次 LLM 调用, 输出 Phase A-D 分析结果 (段号索引 + 结构 + 情绪地图 + 单元分配表)
 *   2. runUnitGeneration(taskId, unitIndex) — 单次 LLM 调用, 输出该单元的 Phase E-F-G 结果 (双区 Markdown + 自检)
 *   3. runGenerateAll(taskId, onProgress) — 并行循环调 runUnitGeneration, worker 池模式
 *
 * Phase 3 架构: prompt 拼装在本地 prompts/index.mjs, 客户端发 contextParams 走 requestLocalBuilderStream.
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { BrowserWindow, app } from "../electron-stub.mjs";
import { getAppSettings } from "./appSettings.mjs";
import { resolveRuntimeConfig } from "../runtime/runtimeConfig.mjs";
import { requestLocalBuilderStream } from "../runtime/serverLlmProxy.mjs";
import { getAssetsByTask } from "./assetCrud.mjs";
import {
  saveAnalysis,
  loadAnalysis,
  deleteAnalysis,
  deleteUnits,
  getUnit,
  upsertUnit,
  listUnits,
} from "./seedanceStore.mjs";
import { parseV5Analysis, mergeV5Analysis } from "../utils/v5MarkdownParser.mjs";

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 目标段长度 (字), 段聚合用 */
const TARGET_PARA_LEN = 280;
/** 单段硬上限 (字) */
const MAX_PARA_LEN = 600;
/** V5 容器 12-15 秒, 取中位 */
const SECONDS_PER_UNIT = 13.5;
/** 并行默认并发数 (兼容大多数模型 RPM 限制) */
const DEFAULT_CONCURRENCY = 1;
/** 最大并发数 */
const MAX_CONCURRENCY = 12;

// ═══════════════════════════════════════════════════════════════
// 辅助 · 加载剧本正文 + 资产
// ═══════════════════════════════════════════════════════════════

/**
 * 从数据库加载剧本正文
 * 📖 取最新一条 script_outputs 记录
 */
function loadScriptBody(db, taskId) {
  const row = db
    .prepare(
      `SELECT script_body AS scriptBody FROM script_outputs
     WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(taskId);
  if (!row?.scriptBody?.trim()) {
    throw new Error(
      "当前剧本任务还没有正文内容。请先完成剧本阶段 (Step 7 写作)。"
    );
  }
  return row.scriptBody;
}

/**
 * 从数据库加载剧本时长
 * ⏱️ 默认 "8分钟"
 */
function loadDuration(db, taskId) {
  const row = db
    .prepare(`SELECT duration FROM script_tasks WHERE id = ?`)
    .get(taskId);
  return row?.duration ?? "8分钟";
}

/**
 * 从数据库加载项目概念
 * 💡 Step 1 的项目概念，用于分镜分析中的戏剧结构判断
 */
function loadConcept(db, taskId) {
  const row = db
    .prepare(`SELECT input_summary FROM script_tasks WHERE id = ?`)
    .get(taskId);
  return row?.input_summary ?? "";
}

/**
 * 把 init.duration 字符串解析成秒数
 * ⏳ 兼容: "8分钟" / "5 分钟" / "1分30秒" / "约 1 分 30 秒" / "30秒" / "约 30 秒"
 * 无法识别则 fallback 60.
 */
function parseInitDurationToSec(duration) {
  if (!duration) return 60;
  const t = duration.trim();
  const minSec = t.match(/(\d+)\s*分\s*(\d+)\s*秒/);
  if (minSec) return parseInt(minSec[1], 10) * 60 + parseInt(minSec[2], 10);
  const minOnly = t.match(/(\d+)\s*分/);
  if (minOnly) return parseInt(minOnly[1], 10) * 60;
  const secOnly = t.match(/(\d+)\s*秒/);
  if (secOnly) return parseInt(secOnly[1], 10);
  return 60;
}

/**
 * 给 LLM 的资产清单 (短代号 ref 格式)
 * 🏷️ 把 UUID 替换为短代号 ref (@C1/@S1/@P1),
 * 避免 LLM 把长 UUID 写进 COPY 区每行浪费 50+ 字.
 *
 * 输出结构 (示例):
 * {
 *   "characters": [{"ref":"@C1","name":"周慕云","appearance":"...",...}],
 *   "scenes":     [{"ref":"@S1","name":"酒店套房","atmosphere":"...",...}],
 *   "props":      [{"ref":"@P1","name":"银色家徽袖扣","form":"...",...}]
 * }
 */
function loadAssetsJson(db, taskId) {
  const assets = getAssetsByTask(db, taskId);
  if (!assets.length) return "{}";

  const compactCharacter = (a, i) => {
    const { id: _id, aiPrompt: _ai, ...rest } = a.assetData;
    return { ref: `@C${i + 1}`, ...rest };
  };
  const compactScene = (a, i) => {
    const { id: _id, aiPrompt: _ai, ...rest } = a.assetData;
    return { ref: `@S${i + 1}`, ...rest };
  };
  const compactProp = (a, i) => {
    const { id: _id, aiPrompt: _ai, ...rest } = a.assetData;
    return { ref: `@P${i + 1}`, ...rest };
  };

  const grouped = {
    characters: assets
      .filter((a) => a.assetType === "character")
      .map(compactCharacter),
    scenes: assets
      .filter((a) => a.assetType === "scene")
      .map(compactScene),
    props: assets
      .filter((a) => a.assetType === "prop")
      .map(compactProp),
  };
  return JSON.stringify(grouped);
}

// ═══════════════════════════════════════════════════════════════
// 辅助 · 加载 Step 5 故事结构 (八步工作流)
// ═══════════════════════════════════════════════════════════════

/**
 * 从八步工作流 JSON 文件中加载 Step 5（结构）的完整故事
 * 📖 Step 7（剧本写作）可能只写了场景[一]，但 Step 5 已有完整四幕结构
 * 把结构转成可读的叙事文本，作为分镜分析的主要故事源
 *
 * 查找策略：按 script_tasks.input_summary 匹配 screenplay JSON 的 init.concept/init.name
 *
 * @param {Object} db - 数据库实例
 * @param {string} taskId - 剧本任务 ID
 * @returns {string|null} 结构文本，找不到返回 null
 */
function loadStoryStructure(db, taskId) {
  try {
    // 先查这个任务的 input_summary（作为匹配关键字）
    const st = db.prepare("SELECT project_id, input_summary FROM script_tasks WHERE id = ?").get(taskId);
    if (!st?.input_summary) return null;

    const concept = st.input_summary.trim();

    // 扫描 screenplay-projects 目录，找概念匹配的项目
    const projectsDir = path.join(app.getPath("userData"), "screenplay-projects");
    if (!fs.existsSync(projectsDir)) return null;

    const files = fs.readdirSync(projectsDir).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(projectsDir, file);
      let data;
      try { data = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }

      // 按 init.concept 或 init.name 匹配
      const initConcept = data.init?.concept?.trim() || "";
      const initName = data.init?.name?.trim() || "";
      if (!initConcept.includes(concept) && !concept.includes(initConcept) &&
          !initName.includes(concept) && !concept.includes(initName)) {
        // 模糊匹配：去掉"创作一个XX"之类的模板前缀再比
        const cleanConcept = concept.replace(/^创作[一个部]?/, "").trim();
        if (!initConcept.includes(cleanConcept) && !cleanConcept.includes(initConcept) &&
            !initName.includes(cleanConcept) && !cleanConcept.includes(initName)) {
          continue;
        }
      }

      // 找到匹配项目，读取 Step 5
      const step5 = data.steps?.["5"];
      if (!step5?.versions?.length) continue;

      const latest = step5.versions[step5.versions.length - 1];
      const structure = latest.structured;
      if (!structure || typeof structure !== "object") continue;

      // 把四幕结构转成叙事文本
      // 结构格式: { act1: { hook, setup, incitingIncident, bridge }, act2: {...}, act3: {...}, act4: {...} }
      const narrative = [];
      const actLabels = { act1: "第一幕", act2: "第二幕", act3: "第三幕", act4: "第四幕" };
      const beatLabels = {
        hook: "开场钩子", setup: "建置", incitingIncident: "激励事件", bridge: "过渡",
        rise1: "上升行动一", rise2: "上升行动二", midpoint: "中点转折",
        climax: "高潮", turnaround: "转折/逆转", bridge2: "过渡",
        newNormal: "新常态", emotionalLanding: "情感落地"
      };

      for (const [actKey, beats] of Object.entries(structure)) {
        if (typeof beats !== "object" || beats === null) continue;
        const actName = actLabels[actKey] || actKey;
        narrative.push(`\n=== ${actName} ===`);
        for (const [beatKey, text] of Object.entries(beats)) {
          if (typeof text !== "string" || !text.trim()) continue;
          const beatName = beatLabels[beatKey] || beatKey;
          narrative.push(`\n【${beatName}】\n${text.trim()}`);
        }
      }

      const result = narrative.join("\n").trim();
      if (result.length > 100) {
        console.log(`[seedance] ✅ 从 screenplay JSON 加载 Step 5 结构: ${result.length} 字 (${file})`);
        return result;
      }
    }

    return null;
  } catch (e) {
    console.warn("[seedance] ⚠ 加载 Step 5 结构时出错:", e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 场景头识别 + 剧本切段
// ═══════════════════════════════════════════════════════════════

/**
 * 匹配场景标题行 - 【】格式
 * 🎬 例: `【场景1：标题】（约30秒）` / `【场一：...】(约30秒)`
 *
 * 捕获组: m[1]="场景"|"场" m[2]=场号 m[3]=标题
 */
const SCENE_HEADER_BRACKET_RE =
  /^【\s*(场景|场)\s*([一二三四五六七八九十百零\d]+)\s*[:：]\s*(.+?)\s*】/;

/**
 * 匹配场景标题行 - markdown 格式
 * 📝 例: `### 场二 标题（02:48-03:00）` / `## 场景3 标题（约 35 秒）`
 *
 * 必须有场号 (`场一` / `场景3` / `第三场`), 不允许裸 `场` 后的单字被吃掉.
 */
const SCENE_HEADER_MARKDOWN_RE =
  /^#{1,4}\s+(?:(?:场|场景)\s*([一二三四五六七八九十百零\d]+)|第\s*([一二三四五六七八九十百零\d]+)\s*场)\s*[:：]?\s*(.+?)$/;

/**
 * 匹配场景标题行 - 纯文本格式
 * 📄 例: `第三场：标题（约 40 秒）`
 */
const SCENE_HEADER_PLAIN_RE =
  /^(?:(?:场|场景)\s*([一二三四五六七八九十百零\d]+)|第\s*([一二三四五六七八九十百零\d]+)\s*场)\s*[:：]\s*(.+?)$/;

/**
 * 解析时长标注, 返回秒数
 * ⏱️ 支持多种格式:
 *   - (02:48-03:00) → 终 - 始
 *   - (约 1 分 30 秒) → 90
 *   - (约 30 秒) → 30
 *   - (约 2 分钟) → 120
 */
function parseSceneSecs(text) {
  const rangeMatch = text.match(
    /[（(]\s*(\d+):(\d+)\s*[-–—~～]\s*(\d+):(\d+)\s*[)）]/
  );
  if (rangeMatch) {
    const start =
      Number.parseInt(rangeMatch[1], 10) * 60 +
      Number.parseInt(rangeMatch[2], 10);
    const end =
      Number.parseInt(rangeMatch[3], 10) * 60 +
      Number.parseInt(rangeMatch[4], 10);
    if (end > start) return end - start;
  }

  const minSecMatch = text.match(
    /[（(]\s*约?\s*(\d+)\s*分\s*(\d+)\s*秒\s*[)）]/
  );
  if (minSecMatch)
    return (
      Number.parseInt(minSecMatch[1], 10) * 60 +
      Number.parseInt(minSecMatch[2], 10)
    );

  const minMatch = text.match(/[（(]\s*约?\s*(\d+)\s*分钟?\s*[)）]/);
  if (minMatch) return Number.parseInt(minMatch[1], 10) * 60;

  const secMatch = text.match(/[（(]\s*约?\s*(\d+)\s*秒\s*[)）]/);
  if (secMatch) return Number.parseInt(secMatch[1], 10);

  return null;
}

/**
 * 一站式: 试一段是否场景头, 返回 {场号, 标题, 秒数} 或 null
 * 🔍 依次尝试 【】格式 → markdown 格式 → 第N场 格式
 */
function tryParseSceneHeader(line) {
  let sceneNumStr = null;
  let title = null;

  const m1 = line.match(SCENE_HEADER_BRACKET_RE);
  if (m1) {
    sceneNumStr = m1[2];
    title = m1[3];
  } else {
    const m2 = line.match(SCENE_HEADER_MARKDOWN_RE);
    if (m2) {
      sceneNumStr = m2[1] ?? m2[2] ?? "";
      title = m2[3];
    } else {
      const m3 = line.match(SCENE_HEADER_PLAIN_RE);
      if (m3) {
        sceneNumStr = m3[1];
        title = m3[2];
      }
    }
  }

  if (!sceneNumStr || !title) return null;
  const secs = parseSceneSecs(line);
  if (secs == null || secs <= 0) return null;
  const sceneNum = chineseDigitToNumber(sceneNumStr);
  if (!Number.isFinite(sceneNum) || sceneNum <= 0) return null;
  return { sceneNum, title: title.trim(), secs };
}

/**
 * 把中文数字转阿拉伯 (覆盖 1-99 即够)
 * 🔢 支持一~九十九
 */
function chineseDigitToNumber(s) {
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  const map = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (s in map) return map[s];
  if (s.startsWith("十") && s.length === 2) return 10 + (map[s[1]] ?? 0);
  if (s.endsWith("十") && s.length === 2) return (map[s[0]] ?? 0) * 10;
  if (s.length === 3 && s[1] === "十")
    return (map[s[0]] ?? 0) * 10 + (map[s[2]] ?? 0);
  return Number.NaN;
}

/**
 * 将剧本正文切段 (核心切段逻辑)
 * ✂️ 三遍扫描:
 *   1. 识别场景头, 关联 paragraph → scene
 *   2. 短段合并 + 段聚合到 ~280 字 (不跨场景边界)
 *   3. 编号 + 长段按句切子段 + 回填 scene.sectionRefs
 *
 * @param {string} scriptBody - 剧本正文
 * @returns {{ paragraphs: Array, scenes: Array, totalUnitsByScenes: number }}
 */
export function splitScriptIntoParagraphs(scriptBody) {
  const rawParagraphsInitial = scriptBody
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // 第一遍预处理: 把"场景头+正文紧贴在同一段"的情况拆开
  const rawParagraphs = [];
  for (const para of rawParagraphsInitial) {
    const firstLine = para.split(/\r?\n/)[0] ?? "";
    const sceneHead = tryParseSceneHeader(firstLine);
    if (sceneHead) {
      const headerLineEnd = para.indexOf("\n");
      const headerBlock =
        headerLineEnd >= 0 ? para.slice(0, headerLineEnd) : para;
      rawParagraphs.push(headerBlock);
      const remainder =
        headerLineEnd >= 0 ? para.slice(headerLineEnd + 1).trim() : "";
      if (remainder) {
        const lines = remainder.split(/\r?\n/);
        const bodyLines = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (bodyLines.length) {
              rawParagraphs.push(bodyLines.join("\n"));
              bodyLines.length = 0;
            }
            continue;
          }
          if (/^情节节奏[:：]|^情感节奏[:：]/.test(trimmed)) {
            if (bodyLines.length) {
              rawParagraphs.push(bodyLines.join("\n"));
              bodyLines.length = 0;
            }
            rawParagraphs.push(trimmed);
            continue;
          }
          bodyLines.push(trimmed);
        }
        if (bodyLines.length) rawParagraphs.push(bodyLines.join("\n"));
      }
    } else {
      rawParagraphs.push(para);
    }
  }

  // 🔧 第1.5遍: 把场景正文按 \n 拆细
  // 场景正文往往是一段连续文字没有空行（\n\n），但 LLM 分析时会
  // 按句子/行逻辑把内容拆成多个段落。如果这里不拆细，paragraphIndex
  // 只有1-2条，LLM 引用的 §3~§N 就会在前端显示"段落数据未找到"
  const rawParagraphsSplit = [];
  for (const para of rawParagraphs) {
    const firstLine = para.split(/\r?\n/)[0] ?? "";
    const isSceneHead = tryParseSceneHeader(firstLine);
    const isMetadata = /^情节节奏[:：]|^情感节奏[:：]/.test(para);
    if (isSceneHead || isMetadata || !para.includes("\n")) {
      rawParagraphsSplit.push(para);
    } else {
      const lines = para
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const line of lines) {
        rawParagraphsSplit.push(line);
      }
    }
  }
  rawParagraphs.length = 0;
  rawParagraphs.push(...rawParagraphsSplit);

  // 第一遍: 识别场景头, 关联 paragraph → scene
  const scenes = [];
  const paragraphScenes = [];
  let currentSceneId = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const para = rawParagraphs[i];
    const sceneHead = tryParseSceneHeader(
      para.split(/\r?\n/)[0] ?? para
    );
    if (sceneHead) {
      const unitCount = Math.max(
        1,
        Math.round(sceneHead.secs / SECONDS_PER_UNIT)
      );
      currentSceneId =
        sceneHead.sceneNum > 0 ? sceneHead.sceneNum : scenes.length + 1;
      scenes.push({
        sceneId: currentSceneId,
        title: sceneHead.title,
        secs: sceneHead.secs,
        unitCount,
        sectionRange: ["§?", "§?"],
        sectionRefs: [],
      });
      paragraphScenes.push(0);
    } else {
      const isMetadata = /^情节节奏[:：]|^情感节奏[:：]/.test(para);
      if (isMetadata) {
        paragraphScenes.push(0);
        continue;
      }
      paragraphScenes.push(currentSceneId);
    }
  }

  // 第二遍: 短段合并 + 段聚合到 ~280 字, 不跨场景边界
  const aggregated = [];
  let buffer = "";
  let bufferSceneId = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const sceneId = paragraphScenes[i];
    if (sceneId === 0) continue;
    const para = rawParagraphs[i];

    if (buffer && sceneId !== bufferSceneId) {
      aggregated.push({ text: buffer, sceneId: bufferSceneId });
      buffer = "";
      bufferSceneId = 0;
    }

    if (!buffer) {
      buffer = para;
      bufferSceneId = sceneId;
    } else {
      const merged = buffer + "\n\n" + para;
      if (merged.length > MAX_PARA_LEN || buffer.length >= TARGET_PARA_LEN) {
        aggregated.push({ text: buffer, sceneId: bufferSceneId });
        buffer = para;
        bufferSceneId = sceneId;
      } else {
        buffer = merged;
      }
    }
  }
  if (buffer) aggregated.push({ text: buffer, sceneId: bufferSceneId });

  // 第三遍: 编号 + 长段按句切子段 + 回填 scene.sectionRefs
  const paragraphs = [];
  const sceneToRefs = new Map();

  aggregated.forEach((agg, idx) => {
    const pIdx = idx + 1;
    const pushPara = (id, text) => {
      paragraphs.push({ id, text, sceneId: agg.sceneId || null });
      if (agg.sceneId) {
        if (!sceneToRefs.has(agg.sceneId))
          sceneToRefs.set(agg.sceneId, []);
        sceneToRefs.get(agg.sceneId).push(id);
      }
    };

    if (agg.text.length <= MAX_PARA_LEN * 1.5) {
      pushPara(`§${pIdx}`, agg.text);
    } else {
      const sentences = agg.text
        .split(/(?<=[。！？.?!])/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (sentences.length <= 1) {
        pushPara(`§${pIdx}`, agg.text);
      } else {
        let subBuf = "";
        let subIdx = 0;
        for (const sent of sentences) {
          if (subBuf && subBuf.length + sent.length > MAX_PARA_LEN) {
            subIdx++;
            pushPara(`§${pIdx}.${subIdx}`, subBuf);
            subBuf = sent;
          } else {
            subBuf = subBuf ? subBuf + sent : sent;
          }
        }
        if (subBuf) {
          subIdx++;
          pushPara(`§${pIdx}.${subIdx}`, subBuf);
        }
      }
    }
  });

  // 回填 scene.sectionRefs 和 sectionRange
  for (const scene of scenes) {
    const refs = sceneToRefs.get(scene.sceneId) ?? [];
    scene.sectionRefs = refs;
    if (refs.length > 0) {
      scene.sectionRange = [refs[0], refs[refs.length - 1]];
    }
  }

  // 过滤掉没有任何 paragraph 的空场景
  const validScenes = scenes.filter((s) => s.sectionRefs.length > 0);
  const totalUnitsByScenes = validScenes.reduce(
    (sum, s) => sum + s.unitCount,
    0
  );

  return {
    paragraphs,
    scenes: validScenes,
    totalUnitsByScenes,
  };
}

// ═══════════════════════════════════════════════════════════════
// JSON 解析 (复用鲁棒 parser)
// ═══════════════════════════════════════════════════════════════

/**
 * 剥掉 markdown 代码围栏
 */
function stripFences(s) {
  return s
    .replace(/^\s*```(?:json|JSON)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
}

/**
 * 修复 LLM 常见的 JSON 瑕疵 (seedance 专用版)
 * 🛠️ 和 screenplayService 里的 repairJsonQuirks 逻辑相同
 */
function repairJson(s) {
  s = s.replace(/^\uFEFF/, "").replace(/\u00A0/g, " ");
  s = s.replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u2018\u2019]/g, "'");
  s = s
    .replace(/[\uFF3B\u3010]/g, "[")
    .replace(/[\uFF3D\u3011]/g, "]");
  s = s.replace(/\uFF5B/g, "{").replace(/\uFF5D/g, "}");

  const out = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      out.push(c);
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        out.push(c);
        esc = true;
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const nx = j < s.length ? s[j] : "";
        if (nx === "" || nx === "," || nx === ":" || nx === "}" || nx === "]") {
          out.push('"');
          inStr = false;
        } else {
          out.push('\\"');
        }
        continue;
      }
      if (c === "\n") { out.push("\\n"); continue; }
      if (c === "\r") { out.push("\\r"); continue; }
      if (c === "\t") { out.push("\\t"); continue; }
      out.push(c);
    } else {
      if (c === "\uFF0C") { out.push(","); continue; }
      if (c === "\u3001") { out.push(","); continue; }
      if (c === "\uFF1A") { out.push(":"); continue; }
      if (c === "\uFF1B") { out.push(";"); continue; }
      if (c === '"') inStr = true;
      out.push(c);
    }
  }
  s = out.join("");
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}

/**
 * 鲁棒 JSON 解析 (seedance 专用版)
 * 🏗️ 4层尝试: 直接 parse → repair 后 parse → 截取外层 {} → repair 后再 parse
 */
function tryParseJson(text) {
  const cleaned = stripFences(text);
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  try { return JSON.parse(repairJson(cleaned)); } catch { /* continue */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try { return JSON.parse(slice); } catch { /* continue */ }
    try { return JSON.parse(repairJson(slice)); } catch { /* continue */ }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Phase A-D · 分析阶段
// ═══════════════════════════════════════════════════════════════

/**
 * 运行 Phase A-D 分析
 * 🧠 单次 LLM 调用, 输出段号索引 + 结构 + 情绪地图 + 单元分配表
 *
 * @param {Object} db - better-sqlite3 数据库实例
 * @param {string} taskId - 剧本任务 ID
 * @returns {Promise<Object>} V5Analysis 分析结果
 */
export async function runPhaseAD(db, taskId, onChunk) {
  const runtimeConfig = resolveRuntimeConfig(getAppSettings(db));
  if (runtimeConfig.mode !== "remote-configured") {
    throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
  }

  const scriptBody = loadScriptBody(db, taskId);
  const duration = loadDuration(db, taskId);
  const concept = loadConcept(db, taskId);
  const assetsJson = loadAssetsJson(db, taskId);

  // 🔑 尝试加载 Step 5 完整故事结构（八步工作流）
  // Step 7 只写了场景[一]时，Step 5 已有完整四幕剧，用结构作为主要故事源
  const storyStructure = loadStoryStructure(db, taskId);
  let enrichedScriptBody = scriptBody;
  if (storyStructure && storyStructure.length > scriptBody.length * 1.5) {
    // 结构比剧本正文丰富得多 → 以结构为主，剧本正文作为场景细节补充
    enrichedScriptBody =
      `## 故事大纲（完整叙事）\n\n${storyStructure}\n\n---\n\n## 场景正文（已写好的场景细节）\n\n${scriptBody}`;
    console.log(
      `[seedance Phase A] 📖 Step 5 结构丰富 (${storyStructure.length}字) > Step 7 剧本 (${scriptBody.length}字)，使用结构作为主要故事源`
    );
  }

  // Fallback: 若剧本没有标准场景头标注, 合成 1 个场景头包住整个剧本
  let workingScriptBody = enrichedScriptBody;
  let splitResult = splitScriptIntoParagraphs(workingScriptBody);

  if (splitResult.scenes.length === 0) {
    const totalSec = parseInitDurationToSec(duration);
    console.warn(
      `[seedance Phase A] ⚠ 未检测到场景头, 合成单场景 (${totalSec}秒) 保底. ` +
        `原脚本 ${scriptBody.length} 字, duration=${duration}. 剧本前 200 字:\n${scriptBody.slice(0, 200)}`
    );
    workingScriptBody = `【场景1：全片】（约${totalSec}秒）\n\n${scriptBody}`;
    splitResult = splitScriptIntoParagraphs(workingScriptBody);
  }

  const {
    paragraphs: preIndex,
    scenes,
    totalUnitsByScenes,
  } = splitResult;

  console.log(
    `[seedance Phase A] script_body ${scriptBody.length} chars → ` +
      `paragraphs ${preIndex.length} 段, scenes ${scenes.length} 场, ` +
      `totalUnitsByScenes ${totalUnitsByScenes}` +
      (scenes.length > 0
        ? ` (${scenes.map((s) => `场${s.sceneId}=${s.unitCount}u/${s.secs}s/${s.sectionRefs.length}段`).join(", ")})`
        : "")
  );

  if (preIndex.length === 0) {
    console.warn(
      `[seedance Phase A] ⚠ 切段为空! script_body 前 300 字:\n${scriptBody.slice(0, 300)}\n--- 后 200 字:\n${scriptBody.slice(-200)}`
    );
  }

  const hasScenes = scenes.length > 0;

  // Phase 3: prompt 拼装搬到服务端, 客户端只发业务参数
  let fullText = "";
  const win = BrowserWindow.getAllWindows()[0];

  await requestLocalBuilderStream({
    runtimeConfig,
    contextType: "seedance_phase_ad",
    contextParams: {
      scriptBody: workingScriptBody,
      duration,
      concept,
      assetsJson,
    },
    temperature: 0.3,
    onChunk: (chunk) => {
      fullText += chunk;
      if (win)
        win.webContents.send("seedance:analysis-chunk", { taskId, chunk });
      if (onChunk) onChunk(chunk);
    },
  });

  // markdown 格式 parse (替代 tryParseJson)
  const parsed = parseV5Analysis(fullText);

  if (parsed.units.length === 0) {
    const diag =
      `[切段诊断] script_body=${scriptBody.length}字 → 切出 ${preIndex.length} 段, ${scenes.length} 场, totalUnits=${totalUnitsByScenes}\n` +
      (preIndex.length === 0
        ? `⚠ 切段为空! 检查剧本格式是否含场景头标注 (支持 \`【场景X：...】（约X秒）\` / \`### 场二 标题（02:48-03:00）\` / \`第三场: 标题（约 40 秒）\`)\n剧本前 200 字:\n${scriptBody.slice(0, 200)}`
        : "切段正常但 LLM 返回 0 UNIT blocks, 可能 LLM 不听 prompt 或输出被截断") +
      `\n解析 warnings: ${parsed.warnings.join("; ") || "(无)"}\n` +
      `\n\nLLM 原始返回前 500 字:\n${fullText.slice(0, 500) || "(空)"}`;
    throw new Error(`Phase A-D 分析失败:\n${diag}`);
  }

  if (parsed.warnings.length > 0) {
    console.warn(`[seedance Phase D] parse warnings:`, parsed.warnings);
  }

  // 合并: 服务端 preIndex 提供权威 text · markdown 里的 facts 按 id 贴回
  const analysis = mergeV5Analysis(parsed, preIndex);

  // 方案 A 兜底验证: 如果 LLM 没遵守场景 unit 分配, 打告警
  if (hasScenes) {
    const expected = totalUnitsByScenes;
    const actual = analysis.units.length;
    if (Math.abs(actual - expected) > 1) {
      console.warn(
        `[seedance Phase D] LLM 违反场景 unit 分配: 期望 ${expected} 个 unit (按场景标注), 实际产出 ${actual}. ` +
          `按场景秒数预算: ${scenes.map((s) => `场${s.sceneId}=${s.unitCount}`).join("/")}`
      );
    }

    const sceneUnitCount = new Map();
    for (const u of parsed.units) {
      const sid = u.sceneId;
      if (typeof sid === "number") {
        sceneUnitCount.set(sid, (sceneUnitCount.get(sid) ?? 0) + 1);
      }
    }
    for (const s of scenes) {
      const got = sceneUnitCount.get(s.sceneId) ?? 0;
      if (got > 0 && got !== s.unitCount) {
        console.warn(
          `[seedance Phase D] 场景 ${s.sceneId} unit 数不符: 期望 ${s.unitCount} (按 ${s.secs}s/13.5), 实际 ${got}`
        );
      }
    }
  }

  // 脏标: 记录本次分析时 scriptBody 的 hash
  analysis.scriptBodyHash = computeScriptHash(scriptBody);

  // 🛡️ 检查是否有已生成的分镜单元，避免静默删除用户的劳动成果
  const oldAnalysis = loadAnalysis(db, taskId);
  const existingUnits = listUnits(db, taskId);
  const doneUnits = existingUnits.filter((u) => u.status === "done");
  const scriptHashChanged = !oldAnalysis || oldAnalysis.scriptBodyHash !== analysis.scriptBodyHash;

  if (doneUnits.length > 0 && !scriptHashChanged) {
    console.warn(
      `[seedance Phase D] ⚠️ 剧本未变但重新分析了。` +
      `已有 ${doneUnits.length} 个生成好的分镜单元不会被删除。` +
      `如果新分析结果和旧的不同（单元数/时长变了），请手动清除旧单元再重新生成。`
    );
  }

  saveAnalysis(db, taskId, analysis);

  // 只在剧本 hash 真的变了时才删旧单元，防止误删
  if (scriptHashChanged && existingUnits.length > 0) {
    console.warn(
      `[seedance Phase D] 剧本已变更，清除 ${existingUnits.length} 个旧单元。` +
      `旧 hash: ${oldAnalysis?.scriptBodyHash ?? "无"} → 新 hash: ${analysis.scriptBodyHash}`
    );
    deleteUnits(db, taskId);
  }

  return analysis;
}

/**
 * 获取已保存的分析结果
 * 📖 从数据库读取
 */
export function getAnalysis(db, taskId) {
  return loadAnalysis(db, taskId);
}

/**
 * 删除某个任务的全部分析数据和单元数据
 * 🗑️ 一键把 Phase A-D 分析和 Phase E-F-G 单元全部清空
 * 用于用户想重新从零开始分析时使用
 */
export function deleteAnalysisFull(db, taskId) {
  deleteAnalysis(db, taskId);
  deleteUnits(db, taskId);
}

/**
 * 检测 V5 分析是否与当前剧本对应
 * 🔍 返回:
 *   - fresh: true · 剧本和上次分析一致 · 可直接重生单元
 *   - fresh: false · 用户改了剧本 · 建议重跑 Phase A-D
 */
export function checkAnalysisFreshness(db, taskId) {
  const analysis = loadAnalysis(db, taskId);
  if (!analysis)
    return { hasAnalysis: false, fresh: false, reason: "尚未跑 Phase A-D 分析" };
  if (!analysis.scriptBodyHash) {
    return {
      hasAnalysis: true,
      fresh: true,
      reason: "老版本分析数据 (无 hash) · 请手动确认剧本是否和当时一致",
    };
  }
  const currentBody = loadScriptBody(db, taskId);
  const currentHash = computeScriptHash(currentBody);
  if (currentHash !== analysis.scriptBodyHash) {
    return {
      hasAnalysis: true,
      fresh: false,
      reason: "剧本已修改 · 上次分析基于旧文 · 建议点「重新分析大纲」让段落索引和最新剧本对齐",
    };
  }
  return { hasAnalysis: true, fresh: true };
}

/**
 * 计算剧本正文的 SHA256 hash (前16位)
 * 🔒 只用于变更检测, 不用于安全
 */
function computeScriptHash(body) {
  return crypto
    .createHash("sha256")
    .update(body, "utf8")
    .digest("hex")
    .slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════
// Phase E-F-G · 单元生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Phase A 段号索引里抽出某单元对应的原文片段
 * 📎 按 sectionRefs 查找对应的 paragraph text
 */
function extractScriptFragment(analysis, unit) {
  const lookup = new Map(
    analysis.paragraphIndex.map((p) => [p.id, p.text])
  );
  return unit.sectionRefs
    .map((ref) => lookup.get(ref))
    .filter((x) => typeof x === "string" && x.length > 0)
    .join("\n\n");
}

/**
 * 解析 V5 F1 双区结构的 LLM 输出
 * 📋 COPY 区 + NOTE 区 分隔解析
 *
 * 格式:
 *   ═══ COPY 区 START ═══
 *   ... (COPY 区内容)
 *   ═══ COPY 区 END · NOTE 区 START ═══
 *   ... (NOTE 区内容)
 *   ═══ NOTE 区 END ═══
 *
 * @param {string} text - LLM 输出的完整文本
 * @returns {{ copyArea: string, noteArea: { traceback: string, selfCheckReport: Object, nextUnitHint?: string } }}
 */
export function parseDualRegion(text) {
  const copyStartRe = /(?:═{3,}.*?)?📋?\s*COPY\s*区\s*START/i;
  const copyEndRe = /(?:═{3,}.*?)?📋?\s*COPY\s*区\s*END/i;
  const noteStartRe = /(?:═{3,}.*?)?📝?\s*NOTE\s*区\s*START/i;
  const noteEndRe = /(?:═{3,}.*?)?📝?\s*NOTE\s*区\s*END/i;

  const copyStart = text.search(copyStartRe);
  const copyEnd = text.search(copyEndRe);
  const noteStart = text.search(noteStartRe);
  const noteEnd = text.search(noteEndRe);

  let copyArea = "";
  let noteRaw = "";

  if (copyStart >= 0 && copyEnd > copyStart) {
    const afterStart = text.slice(copyStart).search(/\n/);
    if (afterStart >= 0) {
      copyArea = text.slice(copyStart + afterStart + 1, copyEnd).trim();
      copyArea = copyArea.replace(/^═+\s*$/gm, "").trim();
    }
  } else {
    copyArea = text.trim();
  }

  if (noteStart >= 0 && noteEnd > noteStart) {
    const afterStart = text.slice(noteStart).search(/\n/);
    if (afterStart >= 0) {
      noteRaw = text.slice(noteStart + afterStart + 1, noteEnd).trim();
      noteRaw = noteRaw.replace(/^═+\s*$/gm, "").trim();
    }
  }

  // 解析 NOTE 区: 段号溯源 + 自检条目 + 下一单元衔接参考
  const selfCheckReport = {};
  const lines = noteRaw.split(/\r?\n/);
  let inTraceback = false;
  let inNextHint = false;
  const tracebackLines = [];
  const nextHintLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s*(段号溯源|溯源)/i.test(trimmed)) {
      inTraceback = true;
      inNextHint = false;
      continue;
    }
    if (/^##\s*(下一单元衔接参考|衔接参考|nextUnitHint|next)/i.test(trimmed)) {
      inNextHint = true;
      inTraceback = false;
      continue;
    }
    if (/^##\s*(自检报告|自检)/i.test(trimmed)) {
      inTraceback = false;
      inNextHint = false;
      continue;
    }

    // 自检条目匹配: "G0 时长对齐: ✅" / "G-1 ... : pass"
    const m = trimmed.match(/^(G-?\d+(?:\.\d+)?)[:\s：]+(.+)$/);
    if (m) {
      const key = m[1].replace(/\s/g, "");
      const val = m[2].trim();
      let status = "pass";
      if (/(❌|fail|失败|违反)/i.test(val)) status = "fail";
      else if (/(⚠|warn|警告)/i.test(val)) status = "warn";
      selfCheckReport[key] = status;
      continue;
    }

    if (inTraceback && trimmed) tracebackLines.push(trimmed);
    if (inNextHint && trimmed) nextHintLines.push(trimmed);
  }

  const traceback = tracebackLines.join(" · ");
  const nextUnitHint = nextHintLines.join(" · ");

  return {
    copyArea,
    noteArea: {
      traceback,
      selfCheckReport,
      nextUnitHint: nextUnitHint || undefined,
    },
  };
}

/**
 * 运行单个单元的 Phase E-F-G 生成
 * 🎬 单次 LLM 调用, 输出该单元的双区 Markdown + 自检
 *
 * @param {Object} db - better-sqlite3 数据库实例
 * @param {string} taskId - 剧本任务 ID
 * @param {number} unitIndex - 单元索引
 * @returns {Promise<Object>} 单元记录
 */
export async function runUnitGeneration(db, taskId, unitIndex, onChunk) {
  const runtimeConfig = resolveRuntimeConfig(getAppSettings(db));
  if (runtimeConfig.mode !== "remote-configured") {
    throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
  }

  const analysis = loadAnalysis(db, taskId);
  if (!analysis) {
    throw new Error("请先生成 Phase A-D 分析 (点击生成分镜).");
  }

  const unit = analysis.units.find((u) => u.index === unitIndex);
  if (!unit) {
    throw new Error(
      `单元 #${unitIndex} 不存在 (分析里只有 ${analysis.units.length} 个单元).`
    );
  }

  // 起幅锚点来自 Phase D 一次性预填的 plannedEntryState
  const planEntry = unit.plannedEntryState ?? "";
  const previousUnitPlan =
    unitIndex > 1
      ? analysis.units.find((u) => u.index === unitIndex - 1)
      : null;
  const previousPlanExit = previousUnitPlan?.plannedExitState ?? "";

  // 读已有 record 仅为继承 retryCount
  const existingRecord = getUnit(db, taskId, unitIndex);

  // 标记 generating 状态
  const draftRecord = upsertUnit(db, {
    taskId,
    unitIndex,
    durationSec: unit.durationSec,
    sceneType: unit.sceneType,
    subShotCount: unit.subShotCount,
    copyArea: "",
    noteArea: { traceback: "", selfCheckReport: {} },
    status: "generating",
    retryCount: existingRecord?.retryCount ?? 0,
  });

  try {
    const scriptFragment = extractScriptFragment(analysis, unit);
    const assetsJson = loadAssetsJson(db, taskId);

    // 🔑 构建完整故事上下文（所有段落文本，不只当前单元的）
    const allParagraphsText = analysis.paragraphIndex
      .filter((p) => p.text && p.text.length > 0)
      .map((p) => `${p.id}: ${p.text}`)
      .join("\n\n");

    // 🔑 收集前面已生成的单元摘要（让 LLM 知道前面拍过什么，不要重复）
    const allExistingUnits = listUnits(db, taskId);
    const previousUnitsSummary = allExistingUnits
      .filter((u) => u.status === "done" && u.unitIndex < unitIndex)
      .sort((a, b) => a.unitIndex - b.unitIndex)
      .map((u) => {
        const planUnit = analysis.units.find((au) => au.index === u.unitIndex);
        return `已生成 Unit ${u.unitIndex}（段落 ${(planUnit?.sectionRefs || []).join(", ")}，${u.durationSec}s，类型: ${u.sceneType}）：${planUnit?.summary || ""}`;
      });

    const analysisContext = {
      structureType: analysis.structureType,
      emotionMap: analysis.emotionMap,
      relevantParagraphs: analysis.paragraphIndex.filter((p) =>
        unit.sectionRefs.includes(p.id)
      ),
    };

    let fullText = "";
    const win = BrowserWindow.getAllWindows()[0];

    // 🔧 防御性修正：确保 subShotCount 在数学上可行（每镜≥5秒）
    const maxShots = Math.max(1, Math.floor(unit.durationSec / 5));
    const safeShotCount = Math.min(unit.subShotCount, maxShots);
    const safeUnit = { ...unit, subShotCount: safeShotCount };

    await requestLocalBuilderStream({
      runtimeConfig,
      contextType: "seedance_unit_efg",
      contextParams: {
        unit: safeUnit,
        scriptFragment,
        analysisContext,
        assetsJson,
        unitIndex,
        totalUnits: analysis.totalUnits,
        // 🔑 完整故事上下文 + 前面单元摘要（防止每个单元拍同一场戏）
        allParagraphsText,
        previousUnitsSummary,
        plannedEntryState: planEntry || undefined,
        previousPlanExit: previousPlanExit || undefined,
      },
      temperature: 0.3,
      onChunk: (chunk) => {
        fullText += chunk;
        if (win)
          win.webContents.send("seedance:unit-chunk", {
            taskId,
            unitIndex,
            chunk,
          });
        if (onChunk) onChunk(chunk);
      },
    });

    if (!fullText.trim()) {
      throw new Error("LLM 返回空, 请重试");
    }

    const { copyArea, noteArea } = parseDualRegion(fullText);

    if (!copyArea || copyArea.length < 300) {
      throw new Error(
        `LLM 产出异常: COPY 区字数 ${copyArea.length} < 300 (即梦单镜至少6字段). 原始前 800 字:\n${fullText.slice(0, 800)}`
      );
    }

    // 若 noteArea 为空, 至少保留 fullText 作 traceback fallback
    if (!noteArea.traceback && !noteArea.nextUnitHint) {
      noteArea.traceback = `单元 ${unitIndex} 对应 ${unit.sectionRefs.join(", ")}`;
    }

    return upsertUnit(db, {
      taskId,
      unitIndex,
      durationSec: unit.durationSec,
      sceneType: unit.sceneType,
      subShotCount: unit.subShotCount,
      copyArea,
      noteArea,
      status: "done",
      retryCount: draftRecord.retryCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    upsertUnit(db, {
      taskId,
      unitIndex,
      durationSec: unit.durationSec,
      sceneType: unit.sceneType,
      subShotCount: unit.subShotCount,
      copyArea: draftRecord.copyArea,
      noteArea: draftRecord.noteArea,
      status: "failed",
      retryCount: draftRecord.retryCount + 1,
      errorMessage: msg,
    });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// 批量生成 · 并行 worker 池模式
// ═══════════════════════════════════════════════════════════════

/**
 * 并行生成所有单元 (默认1路, 最大12路, worker池模式)
 * 🏗️ 跳过已 done 的 unit, 只跑 pending/failed
 *
 * @param {Object} db - better-sqlite3 数据库实例
 * @param {string} taskId - 剧本任务 ID
 * @param {Function} onProgress - 进度回调 ({ taskId, unitIndex, totalUnits, status })
 * @param {number} concurrency - 并发数 (1-12)
 * @returns {Promise<Array>} 所有单元记录 (按 unitIndex 排序)
 */
export async function runGenerateAll(db, taskId, onProgress, concurrency) {
  const analysis = loadAnalysis(db, taskId);
  if (!analysis) throw new Error("请先生成 Phase A-D 分析.");

  const allUnits = analysis.units;
  const total = allUnits.length;

  // 跳过已 done 的 unit
  const existing = listUnits(db, taskId);
  const doneIndexes = new Set(
    existing.filter((u) => u.status === "done").map((u) => u.unitIndex)
  );
  const units = allUnits.filter((u) => !doneIndexes.has(u.index));

  if (units.length === 0) {
    return existing.sort((a, b) => a.unitIndex - b.unitIndex);
  }

  // 把已 done 的也 emit 一次 "done" 进度
  for (const u of existing.filter((u) => u.status === "done")) {
    onProgress?.({ taskId, unitIndex: u.unitIndex, totalUnits: total, status: "done" });
  }

  // worker 池模式: 主队列 + N 个 worker 各取 next index
  let nextIndex = 0;
  const results = [...existing.filter((u) => u.status === "done")];

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= units.length) return;
      const u = units[i];
      try {
        onProgress?.({ taskId, unitIndex: u.index, totalUnits: total, status: "generating" });
        const rec = await runUnitGeneration(db, taskId, u.index);
        results.push(rec);
        onProgress?.({ taskId, unitIndex: u.index, totalUnits: total, status: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress?.({
          taskId,
          unitIndex: u.index,
          totalUnits: total,
          status: "failed",
          errorMessage: msg,
        });
      }
    }
  }

  const requested =
    typeof concurrency === "number" && concurrency > 0
      ? Math.min(MAX_CONCURRENCY, Math.floor(concurrency))
      : DEFAULT_CONCURRENCY;
  const effective = Math.min(requested, units.length);

  await Promise.all(Array.from({ length: effective }, () => worker()));

  return results.sort((a, b) => a.unitIndex - b.unitIndex);
}

/**
 * 列出所有单元记录
 * 📋 从数据库读取
 */
export function listAllUnits(db, taskId) {
  return listUnits(db, taskId);
}

/**
 * 获取单个单元记录
 * 📖 从数据库读取
 */
export function getUnitRecord(db, taskId, unitIndex) {
  return getUnit(db, taskId, unitIndex);
}

/**
 * 启动时清 zombie unit · 所有 status='generating' 转回 'pending'
 * 🧟 背景: Electron main 进程中途被 kill 时, catch 块没机会跑,
 * SQLite 里 status='generating' 就成了僵尸.
 *
 * 根治: App 启动时运行中状态一律翻 pending · 用户点"生成"时 runGenerateAll
 * 会把 pending 也当作 "需要跑" 再发请求.
 *
 * @param {Object} db - better-sqlite3 数据库实例
 * @returns {number} 重置的记录数
 */
export function resetZombieUnits(db) {
  try {
    const result = db
      .prepare(
        `UPDATE seedance_units
       SET status = 'pending',
           error_message = COALESCE(error_message, '') ||
             CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END ||
             'App 上次中途退出 · 本单元已重置为待生成 · 重新点"生成"即可续跑'
       WHERE status = 'generating'`
      )
      .run();
    if (result.changes > 0) {
      console.warn(
        `[seedance] reset ${result.changes} zombie unit(s) generating → pending`
      );
    }
    return result.changes;
  } catch (err) {
    console.warn(`[seedance] resetZombieUnits skipped (${err.message})`);
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 快速分镜：从概念直达完整分镜方案
// ═══════════════════════════════════════════════════════════════

/**
 * 快速分镜模式：用户只给主题+描述，跳过八步工作流，直接生成分镜
 *
 * 🎬 流程：
 * 1. 在 DB 中创建临时 project + script_task
 * 2. 调用 LLM（seedance_quick builder）生成完整分镜分析
 * 3. 解析结果并保存到 seedance_analysis
 * 4. 返回 taskId + analysis，前端可继续生成 unit
 *
 * @param {Object} db - 数据库实例
 * @param {Object} params - { concept, description, duration, genre }
 * @param {Function} [onChunk] - SSE 流式回调
 * @returns {Promise<{ taskId, analysis }>}
 */
export async function runQuickStoryboard(db, params, onChunk) {
  const runtimeConfig = resolveRuntimeConfig(getAppSettings(db));
  if (runtimeConfig.mode !== "remote-configured") {
    throw new Error("API 未配置，请先到设置页填写文字模型 API 密钥。");
  }

  const { concept, description, duration, genre } = params;
  if (!concept?.trim()) {
    throw new Error("请提供项目主题/概念。");
  }

  // 生成唯一 taskId
  const taskId = `qs_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

  // 在 DB 中创建 project + script_task（用于后续存储分析数据）
  const now = Date.now();
  const projectId = `proj_${crypto.randomBytes(6).toString("hex")}`;
  const projectName = concept.trim().slice(0, 50);

  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(projectId, projectName, now, now);
    db.prepare(
      `INSERT INTO script_tasks (id, project_id, mode, input_summary, duration, stage, created_at, updated_at)
       VALUES (?, ?, 'text', ?, ?, 'analyzed', ?, ?)`
    ).run(taskId, projectId, concept.trim(), duration || "3分钟", now, now);
  })();

  console.log(
    `[seedance Quick] 🚀 快速分镜 project=${projectId} task=${taskId} concept="${concept.trim().slice(0, 40)}..."`
  );

  // 构建 LLM 上下文
  const contextParams = {
    concept,
    description: description || "",
    duration: duration || "3分钟",
    genre: genre || "",
  };

  let fullText = "";
  const win = BrowserWindow.getAllWindows()[0];

  await requestLocalBuilderStream({
    runtimeConfig,
    contextType: "seedance_quick",
    contextParams,
    temperature: 0.5,
    onChunk: (chunk) => {
      fullText += chunk;
      if (win)
        win.webContents.send("seedance:analysis-chunk", { taskId, chunk });
      if (onChunk) onChunk(chunk);
    },
  });

  // 解析 markdown 输出
  const parsed = parseV5Analysis(fullText);

  if (parsed.units.length === 0) {
    throw new Error(
      `快速分镜失败：LLM 返回 0 个 UNIT。\n原始返回前 500 字:\n${fullText.slice(0, 500) || "(空)"}`
    );
  }

  if (parsed.warnings.length > 0) {
    console.warn(`[seedance Quick] parse warnings:`, parsed.warnings);
  }

  // 构建 paragraphIndex（快速模式下没有真实剧本，用 LLM 输出的 PARA blocks 作为段落源）
  const paragraphIndex = parsed.paragraphFacts.map((pf) => ({
    id: pf.id,
    text: "", // 快速模式没有原始文本
    facts: pf.facts,
  }));

  const analysis = mergeV5Analysis(parsed, paragraphIndex);
  analysis.scriptBodyHash = ""; // 快速模式无剧本 hash

  // 保存分析到数据库
  saveAnalysis(db, taskId, analysis);

  console.log(
    `[seedance Quick] ✅ 完成: ${analysis.totalUnits} units, ${paragraphIndex.length} paras, ` +
    `${analysis.sequences?.length || 0} sequences, ${analysis.cameraStrategies?.length || 0} strategies`
  );

  return { taskId, analysis };
}

/**
 * 🎯 FloobyNooby Steps 5-9: 分镜精炼
 * 粗缩略图 → Animatic审查 → 结构修订 → 镜头语言精炼 → 二轮缩略图
 * 这是只读操作，不保存到数据库，返回结构化精炼报告
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params - { analysis: object }
 * @param {Function} [onChunk] - SSE 流式回调
 * @returns {Promise<object>} 精炼报告
 */
export async function runRefine(db, params, onChunk) {
  const { analysis } = params;
  const runtimeConfig = await resolveRuntimeConfig(toSettings(getAppSettings(db)));

  const { buildPromptWithDB } = await import("./promptTemplates.mjs");
  const { systemPrompt, userPrompt } = await buildPromptWithDB(db, "seedance_refine", { analysis });

  const fullText = await new Promise((resolve, reject) => {
    requestLocalBuilderStream({
      ...runtimeConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 16000,
    }, (chunk) => {
      if (onChunk) onChunk(chunk);
    }).then(resolve).catch(reject);
  });

  if (!fullText || !fullText.trim()) {
    throw new Error("LLM 返回空文本，精炼失败");
  }

  return { text: fullText, timestamp: new Date().toISOString() };
}

/**
 * 🔑 FloobyNooby Steps 10-12: 关键面板锁定
 * 关键面板 → 粗动画计划 → 关键场次逐镜板
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params - { analysis: object }
 * @param {Function} [onChunk] - SSE 流式回调
 * @returns {Promise<object>} 关键面板+逐镜板报告
 */
export async function runKeyPanels(db, params, onChunk) {
  const { analysis } = params;
  const runtimeConfig = await resolveRuntimeConfig(toSettings(getAppSettings(db)));

  const { buildPromptWithDB } = await import("./promptTemplates.mjs");
  const { systemPrompt, userPrompt } = await buildPromptWithDB(db, "seedance_key_panels", { analysis });

  const fullText = await new Promise((resolve, reject) => {
    requestLocalBuilderStream({
      ...runtimeConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 16000,
    }, (chunk) => {
      if (onChunk) onChunk(chunk);
    }).then(resolve).catch(reject);
  });

  if (!fullText || !fullText.trim()) {
    throw new Error("LLM 返回空文本，关键面板生成失败");
  }

  return { text: fullText, timestamp: new Date().toISOString() };
}

/**
 * 📬 FloobyNooby Steps 13-15: 最终交付
 * 全片粗板包 → 清洁规则 → 最终交付说明
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params - { analysis: object }
 * @param {Function} [onChunk] - SSE 流式回调
 * @returns {Promise<object>} 最终交付包
 */
export async function runFinal(db, params, onChunk) {
  const { analysis } = params;
  const runtimeConfig = await resolveRuntimeConfig(toSettings(getAppSettings(db)));

  const { buildPromptWithDB } = await import("./promptTemplates.mjs");
  const { systemPrompt, userPrompt } = await buildPromptWithDB(db, "seedance_final", { analysis });

  const fullText = await new Promise((resolve, reject) => {
    requestLocalBuilderStream({
      ...runtimeConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 16000,
    }, (chunk) => {
      if (onChunk) onChunk(chunk);
    }).then(resolve).catch(reject);
  });

  if (!fullText || !fullText.trim()) {
    throw new Error("LLM 返回空文本，最终交付生成失败");
  }

  return { text: fullText, timestamp: new Date().toISOString() };
}
