/**
 * serverLlmProxy.mjs — LLM 直连调用核心 🔥
 *
 * 重构后的精简版，完全独立运行，不依赖任何外部代理服务器：
 * 1. 本地 Prompt Builder 构建提示词（requestLocalBuilderStream）
 * 2. 直接调用用户配置的 LLM API（requestDirectLlmStream）
 * 3. 支持 OpenAI / Anthropic / Gemini 三种 API 格式
 * 4. SSE 流式解析器（OpenAI / Anthropic / Gemini 三种格式）
 * 5. 温度解析（Kimi K2 系列强制 temperature=1）
 * 6. 空流重试（LLM 偶尔抽风返回空内容，自动重试）
 *
 * 🚫 直连 LLM API，用户用自己的 API Key 直连 LLM
 */

// ── 超时配置 ───────────────────────────────────────────

/**
 * LLM 调用超时时间 (毫秒)
 *
 * 10 分钟！别觉得长，DeepSeek/Kimi/GLM 复杂 prompt 首 token 可能很慢 🐌
 */
const LLM_FETCH_TIMEOUT_MS = 600000;

/**
 * 构建组合超时信号
 *
 * 把"用户手动取消"和"自动超时"两个信号合二为一，
 * 哪个先触发都行，就像两个闹钟，谁先响你都得醒 ⏰
 *
 * @param {AbortSignal} [userSignal] - 用户传入的取消信号（比如点"停止生成"）
 * @returns {AbortSignal} 组合后的信号
 */
function buildTimeoutSignal(userSignal) {
  const timeoutSignal = AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS);
  if (!userSignal) return timeoutSignal;

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(userSignal.reason ?? timeoutSignal.reason);
  if (userSignal.aborted) onAbort();
  else userSignal.addEventListener("abort", onAbort, { once: true });
  if (timeoutSignal.aborted) onAbort();
  else timeoutSignal.addEventListener("abort", onAbort, { once: true });
  return ctrl.signal;
}

// ── 温度解析 ─────────────────────────────────────────────

/**
 * 解析模型温度参数
 *
 * 大多数模型你传啥温度就用啥，但 Kimi K2 系列是个刺头 🌡️
 * 它强制要求 temperature=1，传别的值直接报 400 错误！
 * 所以遇到 kimi-k2 开头的模型，不管你要啥温度，都给你改成 1
 *
 * @param {string} modelName - 模型名称
 * @param {number} [requested] - 请求的温度值
 * @returns {number} 最终使用的温度值
 */
function resolveTemperature(modelName, requested) {
  const name = modelName.trim().toLowerCase();
  if (name.startsWith("kimi-k2")) return 1;
  return requested ?? 0.8;
}

// ── Token 管理（兼容接口，保留但不再走远程验证）──────────────

/** 用户访问令牌（保留字段，兼容 IPC 调用） */
let userToken = null;
let userRefreshToken = null;
let sessionExpiredCallback = null;

/**
 * 设置用户 Token（兼容接口）
 *
 * 兼容接口，现在不再需要远程验证，
 * 但保留这个接口避免 IPC 报错 🤷
 */
export function setUserToken(token, refreshToken) {
  userToken = token;
  if (refreshToken !== undefined) userRefreshToken = refreshToken;
}

/**
 * 设置会话过期回调（兼容接口）
 */
export function setSessionExpiredCallback(cb) {
  sessionExpiredCallback = cb;
}

// ── SSE 解析器 ─────────────────────────────────────────────

/**
 * 解析 OpenAI 格式的 SSE 流
 *
 * OpenAI 的 SSE 长这样：
 *   data: {"choices":[{"delta":{"content":"你好"}}]}
 *   data: [DONE]
 *
 * 就像拆快递，每个包裹里有一小段文字，拆完拼起来就是完整回复 📦
 *
 * @param {ReadableStream} body - 响应体可读流
 * @param {Function} onChunk - 每收到一段文字就回调
 * @returns {Promise<string>} 完整文本
 */
export async function parseOpenAISSE(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          full += content;
          onChunk(content);
        }
      } catch {
        /* 格式不对的行直接跳过，不影响大局 */
      }
    }
  }

  return full.trim();
}

/**
 * 解析 Anthropic 格式的 SSE 流
 *
 * Anthropic 的 SSE 长这样：
 *   data: {"delta":{"text":"你好"}}
 *
 * 和 OpenAI 格式差不多，就是字段名不一样（delta.text vs choices[0].delta.content）
 * 就像同一道菜，两家餐厅摆盘不同而已 🍽️
 *
 * @param {ReadableStream} body - 响应体可读流
 * @param {Function} onChunk - 每收到一段文字就回调
 * @returns {Promise<string>} 完整文本
 */
export async function parseAnthropicSSE(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      try {
        const parsed = JSON.parse(data);
        const text = parsed.delta?.text;
        if (text) {
          full += text;
          onChunk(text);
        }
      } catch {
        /* 跳过格式不对的行 */
      }
    }
  }

  return full.trim();
}

/**
 * 解析 Gemini 格式的 SSE 流
 * 📦 Gemini SSE 格式: data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
 */
async function _parseGeminiSSE(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      try {
        const parsed = JSON.parse(data);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          full += text;
          onChunk(text);
        }
      } catch {
        /* 跳过格式不对的行 */
      }
    }
  }

  return full.trim();
}

// ── 本地 Prompt Builder 流式调用 ─────────────────────────────

/**
 * 使用本地 Prompt Builder 构建提示词，然后直连 LLM API（流式） 🏠
 *
 * 工作流程：
 *   1. 优先从数据库加载自定义模板（buildPromptWithDB）
 *   2. 数据库没有就用内置 builder（buildPrompt）
 *   3. 构建 messages 数组（system + user）
 *   4. 调用 requestDirectLlmStream 直连用户配置的 LLM API
 *
 * 空流重试最多 2 次，因为 LLM 偶尔会"装死"返回空内容 🙃
 *
 * @param {object} params - 调用参数
 * @param {object} params.runtimeConfig - 运行时配置
 * @param {string} params.contextType - 上下文类型（如 "screenplay_step"）
 * @param {object} params.contextParams - 上下文参数（业务数据）
 * @param {Function} params.onChunk - 每收到一段文字就回调
 * @param {number} [params.temperature] - 温度参数
 * @returns {Promise<{text: string}>} 完整文本
 */
export async function requestLocalBuilderStream(params) {
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  let lastEmpty = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await _localBuilderOnce(params);
      if (result.text) return result;

      lastEmpty = true;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[localBuilder] attempt ${attempt}/${MAX_ATTEMPTS} returned empty text for ${params.contextType}, retrying in ${Math.min(1000 * 2 ** (attempt - 1), 8000)}ms...`
        );
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)));
      }
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[localBuilder] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${params.contextType}: ${err.message?.slice(0, 100) || err}, retrying in ${Math.min(2000 * 2 ** (attempt - 1), 12000)}ms...`
        );
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 12000)));
      }
    }
  }

  const reason = lastError
    ? `最后一次错误：${lastError.message?.slice(0, 200) || lastError}`
    : `连续 ${MAX_ATTEMPTS} 次返回空内容`;
  throw new Error(
    `AI 模型未返回有效内容 (已重试 ${MAX_ATTEMPTS} 次)` +
      `\n${reason}\n` +
      "可能原因：\n" +
      "1. 模型暂时繁忙或超载，稍后重试\n" +
      "2. 内容触发模型安全过滤\n" +
      "3. 内容过长超出模型处理上限，请尝试缩短\n" +
      "4. 模型配置有误，请检查设置中 API 地址和密钥"
  );
}

/**
 * 单次本地 Builder + 直连 LLM 调用（内部函数）
 *
 * @param {object} params - 同 requestLocalBuilderStream
 * @returns {Promise<{text: string}>}
 */
async function _localBuilderOnce(params) {
  let systemPrompt, userPrompt;

  try {
    const { buildPromptWithDB } = await import("../database/promptTemplates.mjs");
    const { initDatabase } = await import("../database/index.mjs");
    const { db } = await initDatabase();
    const result = await buildPromptWithDB(db, params.contextType, params.contextParams);
    systemPrompt = result.systemPrompt;
    userPrompt = result.userPrompt;
  } catch (dbErr) {
    console.error("[_localBuilderOnce] DB prompt failed, fallback to builtin:", dbErr.message);
    const { buildPrompt } = await import("../prompts/index.mjs");
    const result = await buildPrompt(
      params.contextType,
      params.contextParams
    );
    systemPrompt = result.systemPrompt;
    userPrompt = result.userPrompt;
  }

  if (!systemPrompt && !userPrompt) {
    throw new Error(
      `本地 Prompt Builder 未注册 contextType: ${params.contextType}`
    );
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (userPrompt) {
    messages.push({ role: "user", content: userPrompt });
  }

  return requestDirectLlmStream({
    runtimeConfig: params.runtimeConfig,
    messages,
    onChunk: params.onChunk,
    temperature: params.temperature,
  });
}

// ── 直接调 LLM API ──────────────────────────────────────

/**
 * 直接调用用户配置的 LLM API（流式） 🎯
 *
 * 支持 OpenAI / Anthropic / Gemini 三种 API 格式
 * 用户用自己的 API Key 直连 LLM，不经过任何代理服务器
 *
 * @param {object} params - 调用参数
 * @param {object} params.runtimeConfig - 运行时配置（含 apiKey, apiBaseUrl, textMode, defaultModel）
 * @param {Array<{role: string, content: string}>} params.messages - 完整消息列表（含 system + user）
 * @param {Function} params.onChunk - 每收到一段文字就回调
 * @param {number} [params.temperature] - 温度参数
 * @returns {Promise<{text: string}>} 完整文本
 */
export async function requestDirectLlmStream(params) {
  const { runtimeConfig, messages, onChunk } = params;
  const model = runtimeConfig.defaultModel;
  const temperature = resolveTemperature(model, params.temperature);
  const mode = runtimeConfig.textMode || "openai";
  const apiKey = runtimeConfig.apiKey;
  const baseUrl = (runtimeConfig.apiBaseUrl || "").replace(/\/+$/, "");

  if (!apiKey || !baseUrl) {
    throw new Error("API 密钥或地址未配置，请先到设置页填写");
  }

  if (mode === "anthropic") {
    return _directAnthropicStream({ baseUrl, apiKey, model, messages, temperature, onChunk });
  }
  if (mode === "gemini") {
    return _directGeminiStream({ baseUrl, apiKey, model, messages, temperature, onChunk });
  }
  return _directOpenAIStream({ baseUrl, apiKey, model, messages, temperature, onChunk });
}

/**
 * 直接调用 OpenAI 兼容 API（流式）
 * 📡 适用于 OpenAI / DeepSeek / Kimi / GLM 等兼容接口
 */
async function _directOpenAIStream({ baseUrl, apiKey, model, messages, temperature, onChunk }) {
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    stream: true,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: buildTimeoutSignal(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LLM API 调用失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
  }

  if (!response.body) {
    throw new Error("LLM API 响应没有返回可读流");
  }

  const fullText = await parseOpenAISSE(response.body, onChunk);
  return { text: fullText ?? "" };
}

/**
 * 直接调用 Anthropic API（流式）
 * 📡 适用于 Claude 系列模型
 */
async function _directAnthropicStream({ baseUrl, apiKey, model, messages, temperature, onChunk }) {
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const url = `${baseUrl}/messages`;
  const body = {
    model,
    messages: chatMessages,
    system: systemMsg?.content ?? "",
    temperature,
    max_tokens: 8192,
    stream: true,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: buildTimeoutSignal(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Anthropic API 调用失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
  }

  if (!response.body) {
    throw new Error("Anthropic API 响应没有返回可读流");
  }

  const fullText = await parseAnthropicSSE(response.body, onChunk);
  return { text: fullText ?? "" };
}

/**
 * 直接调用 Gemini API（流式）
 * 📡 适用于 Google Gemini 系列模型
 */
async function _directGeminiStream({ baseUrl, apiKey, model, messages, temperature, onChunk }) {
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find((m) => m.role === "system");

  const url = `${baseUrl}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const body = {
    contents,
    generationConfig: { temperature },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: buildTimeoutSignal(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini API 调用失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
  }

  if (!response.body) {
    throw new Error("Gemini API 响应没有返回可读流");
  }

  const fullText = await _parseGeminiSSE(response.body, onChunk);
  return { text: fullText ?? "" };
}
