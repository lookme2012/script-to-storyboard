/**
 * screenplayStepParser · 剧本 Step 1-8 markdown 输出解析
 *
 * 🎬 每个 step 对应一个 parser, 输出和原 JSON 相同 shape.
 * renderer 的 applyStructured 零改动.
 *
 * Grammar 复用 v5MarkdownParser.parseTypedBlocks:
 *   ## TYPE [ID]
 *   kv 字段
 *   ---
 *   body (可选 list 或 正文)
 *   ===   (多 block 时)
 */

import { parseTypedBlocks } from "./v5MarkdownParser.mjs";

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════

/**
 * 分割逗号/分号分隔的字符串为数组
 * 🔪 支持中英文逗号和分号
 */
function splitCSV(s) {
  if (!s) return [];
  return s
    .split(/[,，;；]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * 安全解析整数, 失败返回 fallback
 * 🔢 防止 NaN 污染数据
 */
function parseIntSafe(s, fallback = 0) {
  if (!s) return fallback;
  const n = parseInt(String(s).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 从 block.body 抽 `- item` 列表项
 * 📝 支持 - / * / • / · 开头的列表
 */
function parseListFromBody(body) {
  if (!body) return [];
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*•·]\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * 解析带 body 的 typed blocks
 * 📦 在 parseTypedBlocks 基础上, 从 raw 中提取 --- 后的 body 部分
 */
function parseTypedBlocksWithBody(markdown) {
  const base = parseTypedBlocks(markdown);
  return base.map((b) => {
    const parts = b.raw.split(/^---+\s*$/m);
    const body = parts.length > 1 ? parts.slice(1).join("\n---\n").trim() : "";
    return { ...b, body };
  });
}

// ══════════════════════════════════════════════════════════════
// Step 1 · 破题 · { options: PremiseOption[] }
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 1 破题产出
 * 💡 支持 4 个分支 (A/B/C/D), 每个分支有不同的字段集
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ branch: string, options: Array, guidance: string }}
 */
export function parseStep1(md) {
  const allBlocks = parseTypedBlocks(md);
  const meta = allBlocks.find((b) => b.type === "META");
  const branch = meta?.fields["branch"] || meta?.fields["分支"];
  const guidance = meta?.fields["guidance"] || meta?.fields["引导"];
  const blocks = allBlocks.filter((b) => b.type === "PREMISE");
  const options = blocks.map((b, i) => ({
    id: b.id || `p${i + 1}`,
    title: b.fields["title"] || b.fields["标题"] || "",
    protagonist: b.fields["protagonist"] || b.fields["主角"] || "",
    want: b.fields["want"] || b.fields["欲望"] || b.fields["需求"] || "",
    obstacle: b.fields["obstacle"] || b.fields["阻碍"] || "",
    logline: b.fields["logline"] || b.fields["一句话"] || "",
    openingHook: b.fields["openingHook"],
    combo: b.fields["combo"],
    concept: b.fields["concept"],
    realAnxiety: b.fields["realAnxiety"],
    escalationPotential: b.fields["escalationPotential"],
    twistPotential: b.fields["twistPotential"],
    suggestedStructure: b.fields["suggestedStructure"],
    suggestedVisual: b.fields["suggestedVisual"],
    theme: b.fields["theme"],
    narrativeForm: b.fields["narrativeForm"],
    method: b.fields["method"],
    formContentBond: b.fields["formContentBond"],
    subBranch: b.fields["subBranch"],
    ...b.fields,
  }));
  return { branch, options, guidance };
}

// ══════════════════════════════════════════════════════════════
// SELFCHECK · { items: SelfcheckItem[] }
// ══════════════════════════════════════════════════════════════

/**
 * 解析自检产出
 * 🔍 每个 CHECK block 对应一个自检项, status 为 pass/warn/fail
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ items: Array<{ id, label, status, issue?, suggestion? }> }}
 */
export function parseSelfcheck(md) {
  const allBlocks = parseTypedBlocks(md);
  const checkBlocks = allBlocks.filter(
    (b) => b.type === "CHECK" || b.type === "检查点"
  );
  const overallBlock = allBlocks.find((b) => b.type === "OVERALL");

  const items = checkBlocks.map((b, i) => {
    const statusRaw = (
      b.fields["status"] ||
      b.fields["状态"] ||
      "pass"
    )
      .trim()
      .toLowerCase();
    const status = ["pass", "warn", "fail"].includes(statusRaw)
      ? statusRaw
      : "pass";
    return {
      id: b.id || String(i + 1),
      label: b.fields["label"] || b.fields["检查点"] || "",
      status,
      issue: b.fields["issue"] || b.fields["问题"] || undefined,
      suggestion: b.fields["suggestion"] || b.fields["建议"] || undefined,
    };
  });

  const overall = overallBlock ? {
    verdict: overallBlock.fields["verdict"] || overallBlock.fields["结论"] || "pass",
    summary: overallBlock.fields["summary"] || overallBlock.fields["总结"] || "",
    action: overallBlock.fields["action"] || overallBlock.fields["建议操作"] || "",
  } : null;

  return { items, overall };
}

// ══════════════════════════════════════════════════════════════
// Step 2 · 梗概 · { text, charCount, tone? }
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 2 梗概产出
 * 📖 body 是梗概正文, tone 是基调 (可选)
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ text: string, charCount: number, tone?: string }}
 */
export function parseStep2(md) {
  const blocks = parseTypedBlocksWithBody(md).filter(
    (b) => b.type === "SYNOPSIS"
  );
  const b = blocks[0];
  if (!b) return { text: "", charCount: 0 };
  const text = b.body || b.fields["text"] || "";
  const tone = b.fields["tone"] || b.fields["基调"];
  return { text, charCount: text.length, tone };
}

// ══════════════════════════════════════════════════════════════
// Step 3 · 人物 · { characters: CharacterCard[] }
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 3 人物产出
 * 👤 每个 CHARACTER block 对应一个角色卡
 * 🎨 包含完整外貌描述（面容/发型/体型/衣着）+ 文生图摘要 + 性格 + 背景故事 + 语言特征
 * 外貌字段是后续 AI 视频生成保持角色一致性的关键
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ characters: Array }}
 */
export function parseStep3(md) {
  const blocks = parseTypedBlocksWithBody(md).filter(
    (b) => b.type === "CHARACTER"
  );
  const characters = blocks.map((b, i) => {
    const freqWordsFromList = parseListFromBody(b.body);
    const freqWords =
      freqWordsFromList.length > 0
        ? freqWordsFromList
        : splitCSV(b.fields["freqWords"] || b.fields["口头禅"]);
    
    // 角色名优先用 block ID（## CHARACTER [麻团]），fallback 到 name 字段
    const charName = b.id || b.fields["name"] || b.fields["姓名"] || "";
    const roleRaw = b.fields["role"] || b.fields["角色"];
    let role;
    if (roleRaw && ["主角", "配角", "反派"].includes(roleRaw)) {
      role = roleRaw;
    } else {
      role = characters.length === 0 ? "主角" : "配角";
    }

    return {
      id: b.id || `c${i + 1}`,
      name: charName,
      role,
      // 🎨 外貌特征（视频生成一致性核心，按 prompt 输出顺序排列）
      gender: b.fields["gender"] || b.fields["性别"] || "",
      age: b.fields["age"] || b.fields["年龄"] || "",
      height: b.fields["height"] || b.fields["身高"] || "",
      build: b.fields["build"] || b.fields["体型"] || "",
      face: b.fields["face"] || b.fields["面容"] || b.fields["面容特征"] || "",
      hair: b.fields["hair"] || b.fields["发型"] || b.fields["发型发色"] || "",
      clothing: b.fields["clothing"] || b.fields["衣着"] || b.fields["衣着风格"] || "",
      specialMark: b.fields["specialMark"] || b.fields["标志性特征"] || b.fields["特殊标记"] || "",
      appearanceSummary: b.fields["appearanceSummary"] || b.fields["外貌总结"] || b.fields["文生图描述"] || "",
      // 🧠 内在特质
      want: b.fields["want"] || b.fields["想要"] || "",
      need: b.fields["need"] || b.fields["真正需要"] || "",
      arc: b.fields["arc"] || b.fields["弧光"] || "",
      personality: b.fields["personality"] || b.fields["性格特征"] || "",
      background: b.fields["background"] || b.fields["背景故事"] || b.fields["bioKey"] || b.fields["背景关键"] || "",
      contradiction:
        b.fields["contradiction"] || b.fields["内在矛盾"] || "",
      // 🗣️ 语言特征
      linguistics: {
        freqWords,
        catchphrase:
          b.fields["catchphrase"] || b.fields["口头禅"] || b.fields["标志性口头禅"] || "",
        gesture: b.fields["gesture"] || b.fields["动作"] || b.fields["标志性动作"] || "",
        voice: b.fields["voice"] || b.fields["声音特征"] || "",
      },
    };
  });
  return { characters };
}

// ══════════════════════════════════════════════════════════════
// Step 4 · 背景 · BackstoryData (单对象, 4 字段)
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 4 背景产出
 * 🏛️ 单个 BACKSTORY block, 4 个字段: era / protagonistGhost / relationPast / crossSection
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ era: string, protagonistGhost: string, relationPast: string, crossSection: string }}
 */
export function parseStep4(md) {
  const blocks = parseTypedBlocks(md).filter((b) => b.type === "BACKSTORY");
  const f = blocks[0]?.fields || {};
  return {
    era: f["era"] || f["时代"] || "",
    protagonistGhost:
      f["protagonistGhost"] || f["主角前史"] || "",
    relationPast: f["relationPast"] || f["关系既往"] || "",
    crossSection: f["crossSection"] || f["横截面"] || "",
    worldRules: f["worldRules"] || f["世界观规则"] || "",
  };
}

// ══════════════════════════════════════════════════════════════
// Step 5 · 结构 · StructureData (4 acts)
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 5 结构产出
 * 🏗️ 4 幕结构: ACT1(建置) / ACT2(冲突升级) / ACT3(高潮) / ACT4(新常态)
 * 兼容多种格式: `## ACT1` / `## ACT 1` / `## act 1` / `## 第一幕`
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ act1, act2, act3, act4 }}
 */
export function parseStep5(md) {
  const blocks = parseTypedBlocks(md).filter(
    (b) =>
      b.type === "ACT" ||
      /^ACT[1-4]$/.test(b.type) ||
      b.type === "第一幕" ||
      b.type === "第二幕" ||
      b.type === "第三幕" ||
      b.type === "第四幕"
  );

  /**
   * 查找指定幕号的 block
   * 🔎 兼容 ACT1 / ACT 1 / 第一幕 等多种写法
   */
  const findBlock = (actNum) => {
    const cnChar = ["一", "二", "三", "四"][actNum - 1];
    return blocks.find((b) => {
      const typeU = b.type.toUpperCase();
      const typeL = b.type.toLowerCase();
      if (typeU === `ACT${actNum}`) return true;
      if (typeU === "ACT" && b.id.trim() === String(actNum)) return true;
      if (b.type.includes(`第${cnChar}幕`)) return true;
      if (
        typeL.includes("act") &&
        (b.id.includes(String(actNum)) || b.type.includes(String(actNum)))
      )
        return true;
      return false;
    });
  };

  const a1 = findBlock(1)?.fields || {};
  const a2 = findBlock(2)?.fields || {};
  const a3 = findBlock(3)?.fields || {};
  const a4 = findBlock(4)?.fields || {};

  return {
    act1: {
      hook: a1["hook"] || a1["开场钩子"] || "",
      setup: a1["setup"] || a1["建置"] || "",
      incitingIncident:
        a1["incitingIncident"] || a1["激励事件"] || "",
      bridge: a1["act1→2Bridge"] || a1["转折1"] || "",
    },
    act2: {
      rise1: a2["rise1"] || a2["冲突升级1"] || "",
      rise2: a2["rise2"] || a2["冲突升级2"] || "",
      midpoint: a2["midpoint"] || a2["中点"] || "",
      bridge: a2["act2→3Bridge"] || a2["转折2"] || "",
    },
    act3: {
      climax: a3["climax"] || a3["最终对决"] || "",
      turnaround: a3["turnaround"] || a3["关键反转"] || "",
      bridge: a3["act3→4Bridge"] || a3["转折3"] || "",
    },
    act4: {
      newNormal: a4["newNormal"] || a4["新常态"] || "",
      emotionalLanding:
        a4["emotionalLanding"] || a4["情感落点"] || "",
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Step 6 · 场次 · { scenes: SceneItem[] }
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 6 场次产出
 * 🎬 每个 "场景" / "SCENE" block 对应一场戏, 含时长/节奏/核心动作
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ scenes: Array }}
 */
export function parseStep6(md) {
  const blocks = parseTypedBlocks(md).filter((b) => {
    return b.type === "场景" || b.type.toUpperCase() === "SCENE";
  });
  const scenes = blocks.map((b, i) => {
    const index = parseIntSafe(b.id.replace(/\D/g, ""), i + 1);
    const rhythmPlot =
      b.fields["plotRhythm"] || b.fields["情节节奏"] || "中";
    const rhythmEmo =
      b.fields["emotionRhythm"] || b.fields["情感节奏"] || "中";
    return {
      id: b.fields["id"] || `s${index}`,
      index,
      title: b.fields["title"] || b.fields["标题"] || "",
      locationTime:
        b.fields["locationTime"] || b.fields["地点时间"] || "",
      durationSec: parseIntSafe(
        b.fields["durationSec"] || b.fields["时长秒"],
        0
      ),
      plotRhythm: ["松", "中", "紧"].includes(rhythmPlot)
        ? rhythmPlot
        : "中",
      emotionRhythm: ["轻", "中", "重"].includes(rhythmEmo)
        ? rhythmEmo
        : "中",
      coreAction:
        b.fields["coreAction"] || b.fields["核心动作"] || "",
      act: b.fields["act"] || b.fields["所属幕"] || "",
    };
  });
  return { scenes };
}

// ══════════════════════════════════════════════════════════════
// Step 7 · body 写作 · { scenes: WritingScene[] }
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 7 写作产出
 * ✍️ 每场戏含 header + body (剧本正文), 还有节奏标注
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ scenes: Array }}
 */
export function parseStep7(md) {
  const blocks = parseTypedBlocksWithBody(md).filter(
    (b) => b.type === "场景" || b.type.toUpperCase() === "SCENE"
  );
  const scenes = blocks.map((b, i) => {
    const index = parseIntSafe(b.id.replace(/\D/g, ""), i + 1);
    const rhythmPlot =
      b.fields["plotRhythm"] || b.fields["情节节奏"] || "中";
    const rhythmEmo =
      b.fields["emotionRhythm"] || b.fields["情感节奏"] || "中";
    return {
      index,
      header:
        b.fields["header"] || b.fields["场景头"] || `【场景 ${index}】`,
      duration: b.fields["duration"] || b.fields["时长"] || "",
      plotRhythm: ["松", "中", "紧"].includes(rhythmPlot)
        ? rhythmPlot
        : "中",
      emotionRhythm: ["轻", "中", "重"].includes(rhythmEmo)
        ? rhythmEmo
        : "中",
      body: b.body || "",
    };
  });
  return { scenes };
}

// ══════════════════════════════════════════════════════════════
// Step 8 · 医生 · DoctorReport
// ══════════════════════════════════════════════════════════════

/**
 * 解析 Step 8 医生产出
 * 🩺 包含: 总分 / 结论 / 维度评分 / 问题列表 / 手术建议 / 修改路径
 *
 * @param {string} md - LLM 输出的 markdown 文本
 * @returns {{ totalScore: number, verdict: string, dimensions: Array, issues: Array, surgery: Array, revisionPath: Array }}
 */
export function parseStep8(md) {
  const blocks = parseTypedBlocksWithBody(md);
  const doctor = blocks.find((b) => b.type === "DOCTOR");
  const totalScore = parseIntSafe(
    doctor?.fields["totalScore"] || doctor?.fields["总分"],
    0
  );
  const verdict =
    doctor?.fields["verdict"] || doctor?.fields["结论"] || "";
  const issuesRaw = doctor ? parseListFromBody(doctor.body) : [];
  const issues = issuesRaw.map((item, i) => {
    if (typeof item === 'object' && item !== null) return item;
    return {
      title: item,
      severity: 'warn',
    };
  });
  const dimensions = blocks
    .filter((b) => b.type === "DIMENSION")
    .map((b) => ({
      name: b.fields["name"] || b.fields["维度名"] || "",
      score: parseIntSafe(
        b.fields["score"] || b.fields["分数"],
        0
      ),
      comment: b.fields["comment"] || b.fields["评语"],
    }));
  const surgery = blocks
    .filter((b) => b.type === "SURGERY")
    .map((b, i) => ({
      id: b.id || `sg${i + 1}`,
      original: b.fields["original"] || b.fields["原文"] || "",
      diagnosis:
        b.fields["diagnosis"] || b.fields["诊断"] || "",
      rewrite: b.fields["rewrite"] || b.fields["重写"] || "",
    }));
  const revisionPath = blocks.find(
    (b) => b.type === "REVISION_PATH" || b.type === "REVISIONPATH"
  );
  const revPath = revisionPath ? parseListFromBody(revisionPath.body) : [];
  return {
    totalScore,
    verdict,
    dimensions,
    issues,
    surgery,
    revisionPath: revPath,
  };
}

// ══════════════════════════════════════════════════════════════
// 自动检测 + 路由
// ══════════════════════════════════════════════════════════════

/**
 * 判断文本是否看起来像 JSON
 * 🔍 剥掉围栏后首字符是 { 或 [ 就判定为 JSON
 */
function looksLikeJson(s) {
  let t = s.trim();
  t = t
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  return t.startsWith("{") || t.startsWith("[");
}

/**
 * 基础 JSON 解析尝试
 * 🎯 剥围栏后直接 JSON.parse
 */
function tryParseJsonBasic(s) {
  let t = s.trim();
  t = t
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 自动检测 JSON vs markdown, 路由到对应 parser
 * 🚦 Step 1/8 服务端仍输出 JSON (结构太复杂暂未迁移),
 * Step 2-7 输出 markdown (v2.2.0 已 deploy).
 *
 * 自检测策略: 剥掉前后 whitespace + ```json 围栏, 若首字符是 { 或 [ 判 JSON.
 *
 * @param {number} stepNumber - 步骤号 (1-8)
 * @param {string} md - LLM 输出文本
 * @returns {{ value: any, error?: string }}
 */
export function parseStepOutput(stepNumber, md) {
  try {
    if (looksLikeJson(md)) {
      const j = tryParseJsonBasic(md);
      if (j.ok) {
        return { value: j.value };
      }
    }

    let value;
    switch (stepNumber) {
      case 1:
        value = parseStep1(md);
        break;
      case 2:
        value = parseStep2(md);
        break;
      case 3:
        value = parseStep3(md);
        break;
      case 4:
        value = parseStep4(md);
        break;
      case 5:
        value = parseStep5(md);
        break;
      case 6:
        value = parseStep6(md);
        break;
      case 7:
        value = parseStep7(md);
        break;
      case 8:
        value = parseStep8(md);
        break;
      default:
        return { value: null, error: `unknown stepNumber: ${stepNumber}` };
    }

    /**
     * 严格健康度检查: 解析虽成功但结构全空 = 失败, 不吞
     * 🏥 每步有各自的空值检测规则
     */
    const failWithLog = (reason) => {
      console.error(
        `[parseStepOutput] Step ${stepNumber} 解析失败: ${reason}`
      );
      console.error(
        `[parseStepOutput] raw output (首 2000 字符):`
      );
      console.error(md.slice(0, 2000));
      if (md.length > 2000) {
        console.error(
          `[parseStepOutput] ... 省略 ${md.length - 2000} 字符 ...`
        );
        console.error(
          `[parseStepOutput] raw 末 500 字符: ${md.slice(-500)}`
        );
      }
      return {
        value: null,
        error: `Step ${stepNumber}: ${reason}\n\nRaw 前 500 字:\n${md.slice(0, 500)}`,
      };
    };

    if (stepNumber === 1 && !(value.options?.length)) {
      return failWithLog("0 options (分支字段不匹配?)");
    }
    if (stepNumber === 2 && !value.text) {
      return failWithLog("SYNOPSIS text 空");
    }
    if (stepNumber === 3 && !(value.characters?.length)) {
      return failWithLog("0 characters");
    }
    if (stepNumber === 4) {
      const v = value;
      if (
        !v.era &&
        !v.protagonistGhost &&
        !v.relationPast &&
        !v.crossSection &&
        !v.worldRules
      ) {
        return failWithLog("BACKSTORY 所有 5 字段都空");
      }
    }
    if (stepNumber === 5) {
      const v = value;
      const hasAny =
        (v.act1?.hook || v.act1?.setup || v.act1?.incitingIncident || v.act1?.bridge) ||
        (v.act2?.rise1 || v.act2?.rise2 || v.act2?.midpoint || v.act2?.bridge) ||
        (v.act3?.climax || v.act3?.turnaround || v.act3?.bridge) ||
        v.act4?.newNormal || v.act4?.emotionalLanding;
      if (!hasAny) {
        return failWithLog(
          "STRUCTURE 所有 ACT 字段都空 (ACT block 检测失败?)"
        );
      }
    }
    if (stepNumber === 6 && !(value.scenes?.length)) {
      return failWithLog("0 scenes (## 场景 N block 检测失败?)");
    }
    if (stepNumber === 7 && !(value.scenes?.length)) {
      return failWithLog("0 scenes (## 场景 N block 检测失败?)");
    }
    if (stepNumber === 8) {
      const v = value;
      if (!v.totalScore && !v.verdict) {
        return failWithLog("DOCTOR 无 totalScore + verdict");
      }
      const hasSurgery = (v.surgery?.length ?? 0) >= 2;
      const hasPath = (v.revisionPath?.length ?? 0) >= 2;
      if (!hasSurgery && !hasPath) {
        return failWithLog(
          "医生报告不完整 (SURGERY " +
            (v.surgery?.length ?? 0) +
            " 个 · REVISION_PATH " +
            (v.revisionPath?.length ?? 0) +
            " 项 · 至少一项需 ≥ 2). 请点「↻ 再找医生复查」重试."
        );
      }
    }

    return { value };
  } catch (e) {
    return {
      value: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
