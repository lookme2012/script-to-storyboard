/**
 * llmClient.js — LLM 连接测试（直连版）🔌
 *
 * 重构说明：
 *   - 直连版：直接测试用户配置的 LLM API
 *   - 新版直接测试用户配置的 LLM API 端点，不依赖任何中间代理
 *   - 支持 OpenAI / Anthropic / Gemini 三种 API 格式
 *   - 发一条最简单的 "Hi" 消息，能收到回复就算连接成功 ✅
 */

/**
 * 测试 LLM 连接是否正常
 *
 * 根据用户选择的 API 模式，直接调用对应的 LLM 端点，
 * 发一条 "Hi" 试试水，能收到回复就说明配置没问题 🏊
 *
 * @param {object} params - 测试参数
 * @param {string} params.apiBaseUrl - API 端点地址
 * @param {string} params.apiKey - API 密钥
 * @param {string} params.defaultModel - 模型名称
 * @param {string} params.textMode - 模式 ("openai" / "anthropic" / "gemini")
 * @returns {Promise<{success: boolean, latency: number, message?: string, model?: string}>} 测试结果
 */
export async function testConnection(params) {
  const { apiBaseUrl, apiKey, defaultModel, textMode } = params;
  const baseUrl = (apiBaseUrl || "").replace(/\/+$/, "");
  const model = defaultModel || "deepseek-chat";
  const mode = textMode || "openai";

  if (!baseUrl || !apiKey) {
    return {
      success: false,
      latency: 0,
      message: "API 地址或密钥未填写",
    };
  }

  const start = Date.now();

  try {
    let result;

    if (mode === "anthropic") {
      result = await _testAnthropic(baseUrl, apiKey, model);
    } else if (mode === "gemini") {
      result = await _testGemini(baseUrl, apiKey, model);
    } else {
      result = await _testOpenAI(baseUrl, apiKey, model);
    }

    return {
      success: true,
      latency: Date.now() - start,
      message: result.message || "连接成功",
      model,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      latency: Date.now() - start,
      message: msg,
    };
  }
}

/**
 * 测试 OpenAI 兼容 API 连接
 *
 * 📡 适用于 OpenAI / DeepSeek / Kimi / GLM 等兼容接口
 * 发一条最简单的消息，非流式调用，拿到第一个回复就收工
 */
async function _testOpenAI(baseUrl, apiKey, model) {
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: "user", content: "Hi" },
    ],
    max_tokens: 8,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let hint = "";
    try {
      const errJson = JSON.parse(detail);
      hint = errJson?.error?.message || errJson?.message || "";
    } catch {}
    throw new Error(
      `API 返回 HTTP ${res.status}${hint ? `：${hint}` : ""}`
    );
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content || "";
  return {
    message: reply ? `连接成功，模型回复：${reply.slice(0, 50)}` : "连接成功（空回复）",
  };
}

/**
 * 测试 Anthropic API 连接
 *
 * 📡 适用于 Claude 系列模型
 * 用最简单的消息格式，非流式调用
 */
async function _testAnthropic(baseUrl, apiKey, model) {
  const url = `${baseUrl}/messages`;
  const body = {
    model,
    messages: [{ role: "user", content: "Hi" }],
    max_tokens: 8,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let hint = "";
    try {
      const errJson = JSON.parse(detail);
      hint = errJson?.error?.message || errJson?.message || "";
    } catch {}
    throw new Error(
      `Anthropic API 返回 HTTP ${res.status}${hint ? `：${hint}` : ""}`
    );
  }

  const data = await res.json();
  const reply = data?.content?.[0]?.text || "";
  return {
    message: reply ? `连接成功，模型回复：${reply.slice(0, 50)}` : "连接成功（空回复）",
  };
}

/**
 * 测试 Gemini API 连接
 *
 * 📡 适用于 Google Gemini 系列模型
 * 用 generateContent 非流式接口
 */
async function _testGemini(baseUrl, apiKey, model) {
  const url = `${baseUrl}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    generationConfig: { maxOutputTokens: 8 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let hint = "";
    try {
      const errJson = JSON.parse(detail);
      hint = errJson?.error?.message || "";
    } catch {}
    throw new Error(
      `Gemini API 返回 HTTP ${res.status}${hint ? `：${hint}` : ""}`
    );
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return {
    message: reply ? `连接成功，模型回复：${reply.slice(0, 50)}` : "连接成功（空回复）",
  };
}
