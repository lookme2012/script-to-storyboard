/**
 * durationSpec · 时长档位查表 + 规划指南生成
 *
 * 每个档位告诉你：这个时长的剧本需要多少字、分几场、用什么结构
 * AI 拿到这些数据才能真正"根据时间来规划" 🤖⏱
 */

const TABLE = [
  {
    match: /^30\s*秒?$/,
    spec: {
      label: "30 秒",
      sec: 30,
      wordMin: 250,
      wordMax: 350,
      sceneMin: 1,
      sceneMax: 2,
      structure: "单场景: 设置→反转→钩子",
    },
  },
  {
    match: /^1\s*分钟?$/,
    spec: {
      label: "1 分钟",
      sec: 60,
      wordMin: 500,
      wordMax: 750,
      sceneMin: 2,
      sceneMax: 3,
      structure: "微型三幕: 铺垫→冲突→悬念",
    },
  },
  {
    match: /^2\s*分钟?$/,
    spec: {
      label: "2 分钟",
      sec: 120,
      wordMin: 1100,
      wordMax: 1500,
      sceneMin: 3,
      sceneMax: 5,
      structure: "完整小三幕",
    },
  },
  {
    match: /^3\s*分钟?$/,
    spec: {
      label: "3 分钟",
      sec: 180,
      wordMin: 1500,
      wordMax: 2200,
      sceneMin: 4,
      sceneMax: 6,
      structure: "标准三幕",
    },
  },
  {
    match: /^5\s*分钟?$/,
    spec: {
      label: "5 分钟",
      sec: 300,
      wordMin: 3000,
      wordMax: 3600,
      sceneMin: 8,
      sceneMax: 10,
      structure: "标准三幕 + 第二幕递进",
    },
  },
  {
    match: /^8\s*分钟?$/,
    spec: {
      label: "8 分钟",
      sec: 480,
      wordMin: 5100,
      wordMax: 5700,
      sceneMin: 12,
      sceneMax: 14,
      structure: "标准三幕 + 双轨节奏",
    },
  },
  {
    match: /^10\s*分钟?$/,
    spec: {
      label: "10 分钟",
      sec: 600,
      wordMin: 6000,
      wordMax: 7000,
      sceneMin: 16,
      sceneMax: 20,
      structure: "标准三幕 + 多递进段",
    },
  },
]

/**
 * 外推公式：每 +1 分钟 ≈ +700 字 / +2 场次
 * 用于超出表格范围的自定义时长
 */
function extrapolate(minutes) {
  const sec = minutes * 60
  const extraMin = Math.max(0, minutes - 3)
  const wordMax = 2200 + extraMin * 700
  const wordMin = Math.round(wordMax * 0.75)
  const sceneMax = 6 + extraMin * 2
  const sceneMin = Math.max(1, sceneMax - 2)
  return {
    label: `${minutes} 分钟 (外推)`,
    sec,
    wordMin,
    wordMax,
    sceneMin,
    sceneMax,
    structure: minutes <= 4 ? "标准三幕 (外推)" : "标准三幕 + 多递进段 (外推)",
  }
}

/**
 * 根据时长字符串/数字，匹配对应的时长规格
 *
 * @param {string|number} duration - 如 "3分钟" / "180" / 180 / "180秒"
 * @returns {{ label, sec, wordMin, wordMax, sceneMin, sceneMax, structure } | null}
 */
export function resolveDurationSpec(duration) {
  if (!duration && duration !== 0) return null

  const d = String(duration).trim()

  // 1. 匹配表格里的精确档位
  for (const entry of TABLE) {
    if (entry.match.test(d)) return entry.spec
  }

  // 2. 匹配纯秒数，如 "180秒" / "180"
  const secMatch = d.match(/^(\d+)\s*秒?$/)
  if (secMatch) {
    const s = parseInt(secMatch[1], 10)
    if (s <= 0) return null

    // 秒数刚好命中某个档位
    for (const entry of TABLE) {
      if (entry.spec.sec === s) return entry.spec
    }

    // 外推
    const wordMax = Math.round(s * 9)
    const wordMin = Math.round(s * 7)
    return {
      label: `${s} 秒 (外推)`,
      sec: s,
      wordMin,
      wordMax,
      sceneMin: 1,
      sceneMax: 2,
      structure: "单场景外推",
    }
  }

  // 3. 匹配分钟数，如 "3分钟" / "3"
  const minMatch = d.match(/^(\d+)\s*分钟?$/)
  if (minMatch) {
    const m = parseInt(minMatch[1], 10)
    if (m > 0) return extrapolate(m)
  }

  return null
}

/**
 * 根据时长（秒）生成规划指导文本
 * 可以直接塞进 LLM 的 user prompt，让 AI 按照字数/场次/结构来规划
 *
 * @param {number} durationSec - 时长（秒）
 * @returns {string} 规划指导文本
 */
export function buildDurationGuide(durationSec) {
  if (!durationSec) return ""

  const spec = resolveDurationSpec(durationSec)
  if (!spec) return `\n## ⏱ 目标时长\n${durationSec} 秒\n`

  return `\n## ⏱ 时长规划指南
- **目标时长**：${spec.label}（${spec.sec} 秒）
- **字数范围**：${spec.wordMin} ~ ${spec.wordMax} 字
- **建议场次**：${spec.sceneMin} ~ ${spec.sceneMax} 场
- **推荐结构**：${spec.structure}
- **每秒字数**：约 7~9 字/秒（台词节奏参考）

⚠️ 请在规划场次和写作时严格遵守以上约束，总字数控制在建议范围内。
`
}

/**
 * 前台 UI 用的时长选项列表
 * 从 TABLE 中提取，方便 Home/Seedance/Inspiration 页面复用
 */
export const DURATION_OPTIONS = [
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 120, label: "2 分钟" },
  { value: 180, label: "3 分钟" },
  { value: 300, label: "5 分钟" },
  { value: 480, label: "8 分钟" },
  { value: 600, label: "10 分钟" },
]