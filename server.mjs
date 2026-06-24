/**
 * server.mjs — Web 版后端服务器 🌐
 *
 * 把原来 Electron IPC 的所有操作，改成 REST API 接口。
 * 这样前端不用 Electron，直接浏览器打开就能用！🎉
 *
 * 启动方式: node server.mjs
 * 默认端口: 3000
 * API 前缀: /api
 */

import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ═══════════════════════════════════════════════════════════════
//  数据库存路径 — 和 electron-stub.mjs 保持一致
//  electron-stub.mjs 用 import.meta.url 定位项目根目录
//  server.mjs 也用同样的方式，确保不管从哪里启动都指向同一个数据库
// ═══════════════════════════════════════════════════════════════

const USER_DATA_DIR = path.join(__dirname, "app-data");
const DATA_DIR = path.join(USER_DATA_DIR, "zens-data");
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * 模拟 Electron app 对象
 * 数据库存路径需要 app.getPath("userData")
 */
const mockApp = {
  getPath: (name) => {
    if (name === "userData") return USER_DATA_DIR;
    return os.tmpdir();
  },
  getVersion: () => "1.0.0-web",
};

// ═══════════════════════════════════════════════════════════════
//  初始化数据库和业务模块
// ═══════════════════════════════════════════════════════════════

/**
 * 给 ESM 模块注入 Electron app 的 mock
 * 因为 database/index.mjs 里 import { app } from "electron"
 * Web 模式下没有 Electron，需要先拦截这个 import
 */

// ═══════════════════════════════════════════════════════════════
//  动态导入所有业务模块
// ═══════════════════════════════════════════════════════════════

let database, screenplayService, seedanceService, llmClient, serverLlmProxy;

/**
 * 获取数据库实例
 */
async function getDbInstance() {
  const { db } = await database.initDatabase();
  return db;
}

/**
 * 获取运行时配置
 */
async function getRuntimeConfig() {
  const { resolveRuntimeConfig } = await import("./electron/runtime/runtimeConfig.mjs");
  const { getAppSettings } = await import("./electron/database/appSettings.mjs");
  const db = await getDbInstance();
  return resolveRuntimeConfig(getAppSettings(db));
}

// ═══════════════════════════════════════════════════════════════
//  API 路由
// ═══════════════════════════════════════════════════════════════

// ─── app 相关 ─────────────────────────────────────────────

app.get("/api/app/database-meta", (req, res) => {
  try {
    res.json(database.getDatabaseMeta());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/app/version", (req, res) => {
  res.json({ version: mockApp.getVersion() });
});

app.get("/api/app/settings", async (req, res) => {
  try {
    res.json(await database.getAppSettingsFull());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/app/settings", async (req, res) => {
  try {
    res.json(await database.saveAppSettingsFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/app/test-connection", async (req, res) => {
  try {
    const result = await llmClient.testConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── script 相关 ─────────────────────────────────────────

app.get("/api/script/recent-tasks", async (req, res) => {
  try {
    res.json(await database.getRecentScriptTasksFull());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/script/task/:taskId", async (req, res) => {
  try {
    res.json(await database.loadScriptTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/script/task/:taskId", async (req, res) => {
  try {
    res.json(await database.deleteScriptTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/script/save-draft", async (req, res) => {
  try {
    res.json(await database.saveScriptDraftFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 剧本生成（流式 SSE）
 * 🌊 用 Server-Sent Events 代替 Electron 的 sender.send
 */
app.post("/api/script/run-generation", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") {
      return res.status(400).json({ error: "API 未配置, 请先到设置页填写文字模型 API 密钥." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig,
      contextType: "script_generation",
      contextParams: {
        concept: req.body.concept,
        genre: req.body.genre,
        duration: req.body.duration,
        style: req.body.style,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/script/update-body", async (req, res) => {
  try {
    res.json(await database.updateScriptBodyFull(req.body.taskId, req.body.newBody));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/script/import-existing", async (req, res) => {
  try {
    res.json(await database.importExistingScriptFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 剧本审核/医生（流式 SSE）
 */
app.post("/api/script/run-review", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") {
      return res.status(400).json({ error: "API 未配置, 请先到设置页填写文字模型 API 密钥." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig,
      contextType: "script_review",
      contextParams: {
        scriptBody: req.body.scriptBody,
        concept: req.body.concept,
        reviewType: req.body.reviewType,
      },
      onChunk: (chunk) => {
        fullText += chunk;
      },
    });

    res.json({ text: fullText, taskId: req.body.taskId });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ─── image 相关 ──────────────────────────────────────────

app.get("/api/image/recent-tasks", async (req, res) => {
  try {
    res.json(await database.getRecentImageTasksFull());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/image/save-draft", async (req, res) => {
  try {
    res.json(await database.saveImageDraftFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/image/run-generation", async (req, res) => {
  try {
    res.json(await database.runImageGenerationFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/image/run-review", async (req, res) => {
  try {
    res.json(await database.runImageReviewFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/image/task/:taskId", async (req, res) => {
  try {
    res.json(await database.deleteImageTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── video 相关 ──────────────────────────────────────────

app.get("/api/video/recent-tasks", async (req, res) => {
  try {
    res.json(await database.getRecentVideoTasksFull());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/video/save-draft", async (req, res) => {
  try {
    res.json(await database.saveVideoDraftFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/video/run-generation", async (req, res) => {
  try {
    res.json(await database.runVideoGenerationFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/video/run-review", async (req, res) => {
  try {
    res.json(await database.runVideoReviewFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/video/task/:taskId", async (req, res) => {
  try {
    res.json(await database.deleteVideoTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── asset 相关 ──────────────────────────────────────────

/**
 * 资产提取（流式 SSE）
 */
app.post("/api/asset/extract", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") {
      return res.status(400).json({ error: "API 未配置, 请先到设置页填写文字模型 API 密钥." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig,
      contextType: "asset_extract",
      contextParams: {
        scriptText: req.body.scriptText,
        assetType: req.body.assetType,
        visualStyle: req.body.visualStyle,
        era: req.body.era,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        res.write(`data: ${JSON.stringify({ type: "chunk", taskId: req.body.taskId, chunk })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.get("/api/asset/by-task/:taskId", async (req, res) => {
  try {
    res.json(await database.getAssetsByTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/asset/scan/:taskId", async (req, res) => {
  try {
    res.json(await database.getAssetScanFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/asset/update", async (req, res) => {
  try {
    res.json(await database.updateAssetFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── prompt 相关 ─────────────────────────────────────────

app.post("/api/prompt/generate", async (req, res) => {
  try {
    res.json(await database.generatePromptFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt/generate-group", async (req, res) => {
  try {
    res.json(await database.generatePromptGroupFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt/update", async (req, res) => {
  try {
    res.json(await database.updatePromptFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prompt/by-task/:taskId", async (req, res) => {
  try {
    res.json(await database.getPromptsByTaskFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prompt/scene-count/:taskId", async (req, res) => {
  try {
    res.json(await database.getPromptSceneCountFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prompt/segment-titles/:taskId", async (req, res) => {
  try {
    res.json(await database.getPromptSegmentTitlesFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt/quality-check", async (req, res) => {
  try {
    res.json(await database.runPromptQualityCheckFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt/generate-outline", async (req, res) => {
  try {
    res.json(await database.generateOutlineFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt/confirm-outline", async (req, res) => {
  try {
    res.json(await database.confirmOutlineFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prompt/outline/:taskId", async (req, res) => {
  try {
    res.json(await database.getOutlineFull(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 视频提示词生成（流式 SSE）
 */
app.post("/api/prompt/generate-video-prompt", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") {
      return res.status(400).json({ error: "API 未配置, 请先到设置页填写文字模型 API 密钥." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig,
      contextType: "video_prompt",
      contextParams: {
        promptType: req.body.promptType,
        shotlistData: req.body.shotlistData,
        visualStyle: req.body.visualStyle,
        referenceImages: req.body.referenceImages,
        genre: req.body.genre,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        res.write(`data: ${JSON.stringify({ type: "chunk", taskId: req.body.taskId, chunk })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── prompt-template 相关（提示词模板管理）─────────────────

app.get("/api/prompt-template/list", async (req, res) => {
  try {
    res.json(await database.listAllTemplatesFull());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prompt-template/detail/:contextType", async (req, res) => {
  try {
    const result = await database.getTemplateDetailFull(req.params.contextType);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt-template/save", async (req, res) => {
  try {
    res.json(await database.saveTemplateFull(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/prompt-template/:contextType", async (req, res) => {
  try {
    res.json(await database.deleteTemplateFull(req.params.contextType));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/prompt-template/reset/:contextType", async (req, res) => {
  try {
    res.json(await database.resetTemplateFull(req.params.contextType));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── project 相关 ────────────────────────────────────────

app.get("/api/project/all", async (req, res) => {
  try {
    res.json(await database.getProjectsList());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/project/rename", async (req, res) => {
  try {
    res.json(await database.renameProjectById(req.body.projectId, req.body.newName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/project/:projectId", async (req, res) => {
  try {
    res.json(await database.deleteProjectById(req.params.projectId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── auth 相关 ───────────────────────────────────────────

app.post("/api/auth/set-token", (req, res) => {
  try {
    const { token, refreshToken } = req.body;
    serverLlmProxy.setUserToken(token, refreshToken);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── file 相关（Web 版简化实现） ──────────────────────────

app.post("/api/file/upload-text", express.text({ type: "text/plain", limit: "10mb" }), (req, res) => {
  res.json({ content: req.body, path: "uploaded" });
});

app.post("/api/file/upload-image", express.raw({ type: "*/*", limit: "50mb" }), (req, res) => {
  const base64 = req.body.toString("base64");
  res.json({ base64, mimeType: req.headers["content-type"] || "image/png" });
});

// ─── screenplay 相关（八步工作流）─────────────────────────

app.get("/api/screenplay/skill-status", (req, res) => {
  try {
    res.json(screenplayService.getSkillStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/create-project", (req, res) => {
  try {
    res.json(screenplayService.createProject(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/screenplay/project/:projectId", (req, res) => {
  try {
    res.json(screenplayService.getProject(req.params.projectId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/screenplay/recent-projects", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    res.json(screenplayService.listRecentProjects(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/screenplay/project/:projectId", (req, res) => {
  try {
    res.json(screenplayService.deleteProject(req.params.projectId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/update-step-structured", (req, res) => {
  try {
    const { projectId, stepNumber, structured } = req.body;
    res.json(screenplayService.updateStepStructured(projectId, stepNumber, structured));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/rename-project", (req, res) => {
  try {
    res.json(screenplayService.renameProject(req.body.projectId, req.body.newName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/update-duration", (req, res) => {
  try {
    res.json(screenplayService.updateProjectDuration(req.body.projectId, req.body.duration));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/finalize-to-script-task", (req, res) => {
  try {
    res.json(screenplayService.finalizeToScriptTask(req.body.projectId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 八步工作流 - 生成步骤（流式 SSE）
 * 🌊 服务端把 LLM 的流式输出逐 chunk 推给浏览器，实现"打字机"效果
 */
app.post("/api/screenplay/generate-step", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const result = await screenplayService.generateStep({
      ...req.body,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      },
    });
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[generate-step] ERROR:", err.message);
    console.error("[generate-step] STACK:", err.stack);
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    res.end();
  }
});

/**
 * 八步工作流 - 自检步骤（流式 SSE）
 */
app.post("/api/screenplay/selfcheck-step", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const result = await screenplayService.selfcheckStep({
      ...req.body,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      },
    });
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[selfcheck-step] ERROR:", err.message);
    console.error("[selfcheck-step] STACK:", err.stack);
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    res.end();
  }
});

app.get("/api/screenplay/cached-selfcheck", (req, res) => {
  try {
    const { projectId, stepNumber } = req.query;
    res.json(screenplayService.getCachedSelfcheck(projectId, parseInt(stepNumber)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/approve-step", async (req, res) => {
  try {
    const { projectId, stepNumber, nextStep, surgeryDecisions } = req.body;
    res.json(screenplayService.approveStep(projectId, stepNumber, nextStep, surgeryDecisions));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/rollback-to", (req, res) => {
  try {
    res.json(screenplayService.rollbackTo(req.body.projectId, req.body.targetStep));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/screenplay/versions", (req, res) => {
  try {
    const { projectId, stepNumber } = req.query;
    res.json(screenplayService.listVersions(projectId, parseInt(stepNumber)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/restore-version", (req, res) => {
  try {
    const { projectId, stepNumber, versionId } = req.body;
    res.json(screenplayService.restoreVersion(projectId, stepNumber, versionId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/set-step-selection", (req, res) => {
  try {
    const { projectId, stepNumber, selectionId } = req.body;
    res.json(screenplayService.setStepSelection(projectId, stepNumber, selectionId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/screenplay/checkpoint", (req, res) => {
  try {
    const { projectId, trigger } = req.query;
    res.json(screenplayService.getCheckpoint(projectId, trigger));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/screenplay/regenerate-checkpoint", async (req, res) => {
  try {
    res.json(await screenplayService.generateCheckpoint(req.body.projectId, req.body.trigger));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── seedance 相关（V5 分镜）─────────────────────────────

app.post("/api/seedance/quick-storyboard", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const db = await getDbInstance();
    const { concept, description, duration, genre } = req.body;
    const result = await seedanceService.runQuickStoryboard(
      db,
      { concept, description, duration, genre },
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      }
    );
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── seedance 精炼/深化/交付 (FloobyNooby Steps 5-15) ──────

app.post("/api/seedance/refine", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const db = await getDbInstance();
    const { analysis } = req.body;
    const result = await seedanceService.runRefine(
      db,
      { analysis },
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      }
    );
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/seedance/key-panels", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const db = await getDbInstance();
    const { analysis } = req.body;
    const result = await seedanceService.runKeyPanels(
      db,
      { analysis },
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      }
    );
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/seedance/final", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const db = await getDbInstance();
    const { analysis } = req.body;
    const result = await seedanceService.runFinal(
      db,
      { analysis },
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
      }
    );
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/seedance/run-phase-ad", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.setTimeout(600000);
  res.setTimeout(600000);
  res.flushHeaders();

  try {
    const db = await getDbInstance();
    const result = await seedanceService.runPhaseAD(db, req.body.taskId, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.get("/api/seedance/analysis/:taskId", async (req, res) => {
  try {
    const db = await getDbInstance();
    res.json(seedanceService.getAnalysis(db, req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/seedance/run-unit", async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    const db = await getDbInstance();
    const result = await seedanceService.runUnitGeneration(db, req.body.taskId, req.body.unitIndex);
    res.json(result);
  } catch (err) {
    console.error("[run-unit] ERROR:", err.message);
    console.error("[run-unit] STACK:", err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/seedance/run-all", async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    const db = await getDbInstance();
    const { taskId, concurrency } = req.body;
    const result = await seedanceService.runGenerateAll(db, taskId, (progress) => {
      // Web 版暂不支持实时进度推送，结果一次性返回
    }, concurrency);
    res.json(result);
  } catch (err) {
    console.error("[run-all] ERROR:", err.message);
    console.error("[run-all] STACK:", err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/seedance/units/:taskId", async (req, res) => {
  try {
    const db = await getDbInstance();
    res.json(seedanceService.listAllUnits(db, req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/seedance/unit/:taskId/:unitIndex", async (req, res) => {
  try {
    const db = await getDbInstance();
    res.json(seedanceService.getUnitRecord(db, req.params.taskId, parseInt(req.params.unitIndex)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/seedance/analysis/:taskId", async (req, res) => {
  try {
    const db = await getDbInstance();
    seedanceService.deleteAnalysisFull(db, req.params.taskId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/seedance/check-freshness/:taskId", async (req, res) => {
  try {
    const db = await getDbInstance();
    res.json(seedanceService.checkAnalysisFreshness(db, req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  启动服务器
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.API_PORT || 9000;

async function start() {
  console.log("[Server] 🚀 Web 版服务器启动中...");

  // 需要先 mock electron 模块，再 import 依赖 electron 的模块
  const electronDir = path.join(__dirname, "electron");

  // 动态导入业务模块
  database = await import("./electron/database/index.mjs");
  screenplayService = await import("./electron/services/screenplayService.mjs");
  seedanceService = await import("./electron/database/seedanceService.mjs");
  llmClient = await import("./electron/runtime/llmClient.mjs");
  serverLlmProxy = await import("./electron/runtime/serverLlmProxy.mjs");

  // 初始化数据库
  await database.initDatabase();
  console.log("[Server] ✅ 数据库初始化完成");

  // 清理僵尸单元
  const { db: dbInstance } = await database.initDatabase();
  const zombieCount = seedanceService.resetZombieUnits(dbInstance);
  if (zombieCount > 0) {
    console.log(`[Server] 🧟 清理了 ${zombieCount} 个僵尸单元`);
  }

  // 清理同名重复项目
  database.cleanupDuplicateProjects(dbInstance);

  app.listen(PORT, () => {
    console.log(`[Server] 🎉 API 服务器已启动: http://localhost:${PORT}`);
    console.log(`[Server] 📡 API 地址: http://localhost:${PORT}/api`);
  });
}

start().catch((err) => {
  console.error("[Server] ❌ 启动失败:", err);
  process.exit(1);
});
