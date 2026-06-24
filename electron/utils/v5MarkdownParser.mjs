/**
 * v5MarkdownParser · V5 Phase A-D 复合 markdown 输出解析
 *
 * 📐 格式 (LLM 需按此模板输出):
 *
 *   ## META
 *   structureType: linear
 *   totalSec: 480
 *   totalUnits: 20
 *
 *   ---
 *
 *   ## PARA §1
 *   人物: 周慕云
 *   动作: 整理袖扣
 *   台词:
 *   道具: 白手套银袖扣
 *   场景: 酒店套房
 *   情绪: 平稳
 *
 *   ---
 *
 *   ## PARA §1.1
 *   ...
 *
 *   ---
 *
 *   ## PEAK §3
 *   kind: 崩溃
 *   originalRef: 灯光闪烁
 *
 *   ---
 *
 *   ## BUFFER §5
 *   reason: 静止过渡
 *
 *   ---
 *
 *   ## SUBTEXT §2
 *   description: 照片暗示失去
 *
 *   ---
 *
 *   ## UNIT 1
 *   sceneId: 1
 *   sectionRefs: §1, §2
 *   durationSec: 15
 *   sceneType: 文戏
 *   subShotCount: 3
 *   summary: 周慕云整理袖扣, 准备会面
 *   plannedEntryState: 酒店套房内, 周慕云站在镜前
 *   plannedExitState: 周慕云转身, 手放门把
 *
 * 每个 block = `## TYPE [ID]` + kv 字段.
 * 多个 block 用 `---` 独占一行分隔.
 *
 * 解析策略:
 *   1. 按 `^## ` lookahead 切 block
 *   2. 每个 block 第 1 行抽 TYPE + ID
 *   3. 剩余行抽 kv 字段
 *   4. 按 TYPE 分桶组装最终对象
 */

/**
 * 从 markdown 里按 `## TYPE [ID]` 切 block
 * ✂️ lookahead 不消耗 anchor. 每 block = 标题 + kv 行.
 * block 间 `---` 分隔符被自然吞掉 (不带入 fields).
 *
 * @param {string} markdown - LLM 输出的 markdown 文本
 * @returns {Array<{ type: string, id: string, fields: Object, raw: string }>}
 */
export function parseTypedBlocks(markdown) {
  const segments = markdown
    .split(/^(?=##+\s+\S)/m)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("##"));

  const out = [];
  for (const seg of segments) {
    const lines = seg.split(/\r?\n/);
    if (lines.length === 0) continue;

    const headerLine = lines[0];
    // 匹配 `## TYPE` 或 `## TYPE ID` · 容忍中英文混合
    //   `## META` → type=META, id=""
    //   `## ACT1` → type=ACT1, id=""
    //   `## ACT 1` → type=ACT, id="1"
    //   `## 场景 1` → type=场景, id="1"
    //   `## 第一幕` → type=第一幕, id=""
    //   `## PARA §1` → type=PARA, id=§1
    const headerMatch = headerLine.match(/^##+\s+(\S+)\s*(.*)$/);
    if (!headerMatch) continue;

    const type = headerMatch[1].trim();
    const idRaw = (headerMatch[2] || "").trim();
    // 尝试从 [名称] 格式提取，否则直接用原始文本
    const bracketMatch = idRaw.match(/^\[(.*?)\]/);
    const id = bracketMatch ? bracketMatch[1].trim() : idRaw.trim();

    // 正文行 · 排除 --- 分隔符
    const bodyLines = lines.slice(1).filter((ln) => !/^---+\s*$/.test(ln));

    // kv 提取: 匹配 `key: value` 或 `key：value`
    const fields = {};
    for (const ln of bodyLines) {
      const m = ln.match(/^\s*([^:：\s][^:：]*?)\s*[:：]\s*(.*?)\s*$/);
      if (m) {
        const key = m[1].trim();
        const value = m[2].trim();
        if (key) fields[key] = value;
      }
    }

    // 表格行提取: 匹配 `| **key** | value |` 或 `| key | value |`
    if (Object.keys(fields).length === 0) {
      for (const ln of bodyLines) {
        const tm = ln.match(/^\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|\s*([^|]+?)\s*\|/);
        if (tm) {
          const key = tm[1].trim();
          const value = tm[2].trim();
          if (key && !key.startsWith("---") && key !== "字段" && key !== "Field") {
            fields[key] = value;
          }
        }
      }
    }

    out.push({ type, id, fields, raw: seg });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
// V5 Phase D 专用 · 组装 V5Analysis
// ══════════════════════════════════════════════════════════════

/** 合法的场景类型列表 */
const VALID_SCENE_TYPES = ["文戏", "快节奏文戏", "武戏", "环境戏", "动作非武戏"];

/**
 * 标准化场景类型
 * 🎭 不在合法列表中的统一归为 "文戏"
 */
function normalizeSceneType(s) {
  if (!s) return "文戏";
  const t = s.trim();
  if (VALID_SCENE_TYPES.includes(t)) return t;
  return "文戏";
}

/**
 * 解析段号引用列表
 * 📎 支持 `§1, §2` / `§1,§2` / `§1 §2` / `§1; §2` 等分隔格式
 */
function parseSectionRefs(s) {
  if (!s) return [];
  return s
    .split(/[,，;；\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * 安全解析整数
 * 🔢 防止 NaN 污染数据
 */
function parseIntSafe(s, fallback = 0) {
  if (!s) return fallback;
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** PARA block 字段中英文映射表 */
const PARA_FIELD_MAP = {
  人物: "character",
  character: "character",
  动作: "action",
  action: "action",
  台词: "dialogue",
  dialogue: "dialogue",
  道具: "prop",
  prop: "prop",
  场景: "scene",
  地点: "scene",
  scene: "scene",
  location: "scene",
  情绪: "emotion",
  emotion: "emotion",
};

/**
 * 解析 V5 Phase A-D 的 markdown 输出, 组装成 V5Analysis 对象
 * 🧩 按 TYPE 分桶: META / PARA / PEAK / BUFFER / SUBTEXT / UNIT
 *
 * @param {string} markdown - LLM 输出的 markdown 文本
 * @returns {{ paragraphFacts, structureType, emotionMap, units, totalSec, totalUnits, warnings }}
 */
export function parseV5Analysis(markdown) {
  const blocks = parseTypedBlocks(markdown);
  const warnings = [];

  // 分桶
  const metaBlocks = blocks.filter((b) => b.type === "META");
  const paraBlocks = blocks.filter((b) => b.type === "PARA");
  const peakBlocks = blocks.filter((b) => b.type === "PEAK");
  const bufferBlocks = blocks.filter((b) => b.type === "BUFFER");
  const subtextBlocks = blocks.filter((b) => b.type === "SUBTEXT");
  const unitBlocks = blocks.filter((b) => b.type === "UNIT");
  // 🆕 FloobyNooby 结构分析块
  const dramaBlocks = blocks.filter((b) => b.type === "DRAMA_STRUCTURE");
  const sequenceBlocks = blocks.filter((b) => b.type === "SEQUENCE");
  const cameraBlocks = blocks.filter((b) => b.type === "CAMERA_STRATEGY");
  const sceneCoreBlocks = blocks.filter((b) => b.type === "SCENE_CORE");

  // META
  const meta = metaBlocks[0]?.fields || {};
  const structureType =
    meta["structureType"] || meta["结构类型"] || "linear";
  const totalSec = parseIntSafe(meta["totalSec"] || meta["总时长"], 0);
  const totalUnits = parseIntSafe(
    meta["totalUnits"] || meta["总单元数"],
    unitBlocks.length
  );

  // PARA · 按 id 整理 facts
  const paragraphFacts = paraBlocks.map((b) => {
    const facts = {};
    for (const [k, v] of Object.entries(b.fields)) {
      const mapped = PARA_FIELD_MAP[k];
      if (mapped && v) facts[mapped] = v;
    }
    return { id: b.id, facts };
  });

  // EMOTION · peaks / buffers / subtexts
  const emotionMap = {
    peaks: peakBlocks.map((b) => ({
      sectionId: b.id,
      kind: b.fields["kind"] || b.fields["类型"] || "其他",
      trigger:
        b.fields["trigger"] || b.fields["originalRef"] || b.fields["原文引用"] || "",
    })),
    buffers: bufferBlocks.map((b) => ({
      sectionId: b.id,
      reason: b.fields["reason"] || b.fields["原因"] || "",
    })),
    subtexts: subtextBlocks.map((b) => ({
      sectionId: b.id,
      description:
        b.fields["description"] || b.fields["描述"] || "",
    })),
  };

  // UNITS (附带 sceneId 给客户端校验用)
  const units = unitBlocks.map((b, arrayIdx) => {
    const index = parseIntSafe(b.id, arrayIdx + 1);
    const sceneIdRaw = b.fields["sceneId"] || b.fields["场号"];
    const sceneId = sceneIdRaw
      ? parseIntSafe(sceneIdRaw, 0) || undefined
      : undefined;
    return {
      index,
      sectionRefs: parseSectionRefs(
        b.fields["sectionRefs"] || b.fields["段号引用"]
      ),
      durationSec: parseIntSafe(
        b.fields["durationSec"] || b.fields["时长秒"],
        13
      ),
      sceneType: normalizeSceneType(
        b.fields["sceneType"] || b.fields["场景类型"]
      ),
      subShotCount: parseIntSafe(
        b.fields["subShotCount"] || b.fields["分镜数"],
        3
      ),
      summary: b.fields["summary"] || b.fields["摘要"] || "",
      plannedEntryState:
        b.fields["plannedEntryState"] || b.fields["起幅锚点"],
      plannedExitState:
        b.fields["plannedExitState"] || b.fields["落幅锚点"],
      sceneId,
    };
  });

  // 健康度 warnings
  if (metaBlocks.length === 0) warnings.push("META block 缺失 · 用默认值");
  if (unitBlocks.length === 0) warnings.push("0 UNIT blocks · 异常");
  if (paragraphFacts.length === 0)
    warnings.push("0 PARA blocks · 异常 (段落标注为空)");
  if (units.length > 0 && totalUnits !== units.length) {
    warnings.push(
      `totalUnits=${totalUnits} 但实际 ${units.length} 个 UNIT · 用实际数`
    );
  }

  // 🆕 FloobyNooby 结构分析解析
  const dramaticStructure = dramaBlocks[0]?.fields || {};

  const sequences = sequenceBlocks.map((b) => ({
    id: b.id,
    name: b.fields["name"] || b.fields["名称"] || "",
    dramaticCore: b.fields["dramaticCore"] || b.fields["戏核"] || "",
    whatChangesByEnd: b.fields["whatChangesByEnd"] || b.fields["变化"] || "",
    audiencePosition: b.fields["audiencePosition"] || b.fields["观众站位"] || "",
    primaryPressure: b.fields["primaryPressure"] || b.fields["压力来源"] || "",
  }));

  const cameraStrategies = cameraBlocks.map((b) => ({
    id: b.id,
    openingSize: b.fields["openingSize"] || b.fields["开场景别"] || "",
    pressureDirection: b.fields["pressureDirection"] || b.fields["压力方向"] || "",
    infoPattern: b.fields["infoPattern"] || b.fields["信息顺序"] || "",
    reactionOwner: b.fields["reactionOwner"] || b.fields["反应所有权"] || "",
    climaxPlacement: b.fields["climaxPlacement"] || b.fields["高潮位置"] || "",
    forbidden: b.fields["forbidden"] || b.fields["禁止"] || "",
  }));

  const sceneCores = sceneCoreBlocks.map((b) => ({
    id: b.id,
    sceneName: b.fields["sceneName"] || b.fields["场景名称"] || "",
    dramaticCore: b.fields["dramaticCore"] || b.fields["戏核"] || "",
    audiencePosition: b.fields["audiencePosition"] || b.fields["观众站位"] || "",
    shotFlow: b.fields["shotFlow"] || b.fields["镜头流"] || "",
    firstCloseUp: b.fields["firstCloseUp"] || b.fields["第一刀特写"] || "",
    climaxDuty: b.fields["climaxDuty"] || b.fields["高潮职责"] || "",
    reactionOwner: b.fields["reactionOwner"] || b.fields["反应所有权"] || "",
    continuityAnchor: b.fields["continuityAnchor"] || b.fields["连续性锚点"] || "",
    commonMistake: b.fields["commonMistake"] || b.fields["易犯错误"] || "",
  }));

  if (dramaBlocks.length === 0 && sequenceBlocks.length === 0) {
    // 静默: LLM 可能还没采用新的 4 阶段格式, 不算错误
  }

  return {
    paragraphFacts,
    structureType,
    emotionMap,
    units,
    totalSec,
    totalUnits,
    warnings,
    // 🆕 FloobyNooby 结构分析字段
    dramaticStructure,
    sequences,
    cameraStrategies,
    sceneCores,
  };
}

/**
 * 用 Phase A-D markdown 合并到 V5Analysis
 * 🔗 调用方提供权威 paragraphIndex.text, markdown 里的 facts 按 id 贴回
 * 专给 seedanceService.runPhaseAD 用 · 取代 tryParseJson → 按 id 合并 facts.
 *
 * @param {Object} parsed - parseV5Analysis 的返回值
 * @param {Array} serverParagraphIndex - 服务端切段结果 [{ id, text }]
 * @returns {Object} 合并后的 V5Analysis
 */
export function mergeV5Analysis(parsed, serverParagraphIndex) {
  const factsMap = new Map();
  for (const { id, facts } of parsed.paragraphFacts) {
    factsMap.set(id, facts);
  }

  // 以服务端切段为主，贴上 LLM 标注的 facts
  const mergedParagraphIndex = serverParagraphIndex.map((p) => ({
    id: p.id,
    text: p.text,
    facts: factsMap.get(p.id) || {},
  }));

  // 🔧 不再添加 LLM 独有段落（_llmOnly）
  // 原因：LLM 为满足"段落不重叠"规则，会在剧本不够长时编造空段落（§3~§8 的 text 为空），
  // 导致单元生成时分配给这些空段落后无内容可拍，只能反复用 §1 的同一场景。
  // 现在改为：只保留服务端实际切出的段落。段落不够时，允许多个单元共享同一段落，
  // 通过 summary/plannedEntryState/plannedExitState 区分各自负责的不同故事节拍。

  return {
    paragraphIndex: mergedParagraphIndex,
    structureType: parsed.structureType,
    emotionMap: parsed.emotionMap,
    units: parsed.units,
    totalSec: parsed.totalSec,
    totalUnits: parsed.totalUnits,
    // 🆕 FloobyNooby 结构分析字段
    dramaticStructure: parsed.dramaticStructure || {},
    sequences: parsed.sequences || [],
    cameraStrategies: parsed.cameraStrategies || [],
    sceneCores: parsed.sceneCores || [],
  };
}
