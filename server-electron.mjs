/**
 * server-electron.mjs — 基于 Electron 的 Web API 服务器 🖥️🌐
 *
 * 为什么不直接用 node server.mjs？
 *   因为 better-sqlite3 是原生模块，需要跟 Electron 内置的 Node 版本匹配。
 *   直接用系统 Node 跑会报 NODE_MODULE_VERSION 不兼容。
 *   用 Electron 跑就没这个问题，因为 better-sqlite3 已经为 Electron 编译过了。
 *
 * 启动方式: npx electron server-electron.mjs
 * 原理: Electron 启动后不创建窗口，只启动 Express API 服务器
 */

import { app } from "electron";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";

const expressApp = express();

expressApp.use(cors());
expressApp.use(express.json({ limit: "50mb" }));

let database, screenplayService, seedanceService, llmClient, serverLlmProxy;

function getDbInstance() {
  return database.initDatabase().db;
}

async function getRuntimeConfig() {
  const { resolveRuntimeConfig } = await import("./electron/runtime/runtimeConfig.mjs");
  const { getAppSettings } = await import("./electron/database/appSettings.mjs");
  const db = getDbInstance();
  return resolveRuntimeConfig(getAppSettings(db));
}

// ═══════════════════════════════════════════════════════════════
//  API 路由 — 和 server.mjs 完全一样
// ═══════════════════════════════════════════════════════════════

// app 相关
expressApp.get("/api/app/database-meta", (req, res) => {
  try { res.json(database.getDatabaseMeta()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/app/version", (req, res) => {
  res.json({ version: app.getVersion() });
});
expressApp.get("/api/app/settings", (req, res) => {
  try { res.json(database.getAppSettingsFull()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/app/settings", (req, res) => {
  try { res.json(database.saveAppSettingsFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/app/test-connection", async (req, res) => {
  try { res.json(await llmClient.testConnection(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// script 相关
expressApp.get("/api/script/recent-tasks", (req, res) => {
  try { res.json(database.getRecentScriptTasksFull()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/script/task/:taskId", (req, res) => {
  try { res.json(database.loadScriptTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.delete("/api/script/task/:taskId", (req, res) => {
  try { res.json(database.deleteScriptTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/script/save-draft", (req, res) => {
  try { res.json(database.saveScriptDraftFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/script/run-generation", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") return res.status(400).json({ error: "API 未配置" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig, contextType: "script_generation",
      contextParams: { concept: req.body.concept, genre: req.body.genre, duration: req.body.duration, style: req.body.style },
      onChunk: (chunk) => { fullText += chunk; res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`); },
    });
    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`); res.end(); }
  }
});
expressApp.post("/api/script/update-body", (req, res) => {
  try { res.json(database.updateScriptBodyFull(req.body.taskId, req.body.newBody)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/script/import-existing", (req, res) => {
  try { res.json(database.importExistingScriptFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/script/run-review", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") return res.status(400).json({ error: "API 未配置" });
    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig, contextType: "script_review",
      contextParams: { scriptBody: req.body.scriptBody, concept: req.body.concept, reviewType: req.body.reviewType },
      onChunk: (chunk) => { fullText += chunk; },
    });
    res.json({ text: fullText, taskId: req.body.taskId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// image 相关
expressApp.get("/api/image/recent-tasks", (req, res) => {
  try { res.json(database.getRecentImageTasksFull()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/image/save-draft", (req, res) => {
  try { res.json(database.saveImageDraftFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/image/run-generation", (req, res) => {
  try { res.json(database.runImageGenerationFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/image/run-review", (req, res) => {
  try { res.json(database.runImageReviewFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.delete("/api/image/task/:taskId", (req, res) => {
  try { res.json(database.deleteImageTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// video 相关
expressApp.get("/api/video/recent-tasks", (req, res) => {
  try { res.json(database.getRecentVideoTasksFull()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/video/save-draft", (req, res) => {
  try { res.json(database.saveVideoDraftFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/video/run-generation", (req, res) => {
  try { res.json(database.runVideoGenerationFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/video/run-review", (req, res) => {
  try { res.json(database.runVideoReviewFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.delete("/api/video/task/:taskId", (req, res) => {
  try { res.json(database.deleteVideoTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// asset 相关
expressApp.post("/api/asset/extract", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") return res.status(400).json({ error: "API 未配置" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig, contextType: "asset_extract",
      contextParams: { scriptText: req.body.scriptText, assetType: req.body.assetType, visualStyle: req.body.visualStyle, era: req.body.era },
      onChunk: (chunk) => { fullText += chunk; res.write(`data: ${JSON.stringify({ type: "chunk", taskId: req.body.taskId, chunk })}\n\n`); },
    });
    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`); res.end(); }
  }
});
expressApp.get("/api/asset/by-task/:taskId", (req, res) => {
  try { res.json(database.getAssetsByTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/asset/scan/:taskId", (req, res) => {
  try { res.json(database.getAssetScanFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/asset/update", (req, res) => {
  try { res.json(database.updateAssetFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// prompt 相关
expressApp.post("/api/prompt/generate", (req, res) => {
  try { res.json(database.generatePromptFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/generate-group", (req, res) => {
  try { res.json(database.generatePromptGroupFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/update", (req, res) => {
  try { res.json(database.updatePromptFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/prompt/by-task/:taskId", (req, res) => {
  try { res.json(database.getPromptsByTaskFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/prompt/scene-count/:taskId", (req, res) => {
  try { res.json(database.getPromptSceneCountFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/prompt/segment-titles/:taskId", (req, res) => {
  try { res.json(database.getPromptSegmentTitlesFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/quality-check", (req, res) => {
  try { res.json(database.runPromptQualityCheckFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/generate-outline", (req, res) => {
  try { res.json(database.generateOutlineFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/confirm-outline", (req, res) => {
  try { res.json(database.confirmOutlineFull(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/prompt/outline/:taskId", (req, res) => {
  try { res.json(database.getOutlineFull(req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/prompt/generate-video-prompt", async (req, res) => {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.mode === "local-mock") return res.status(400).json({ error: "API 未配置" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    let fullText = "";
    await serverLlmProxy.requestLocalBuilderStream({
      runtimeConfig, contextType: "video_prompt",
      contextParams: { promptType: req.body.promptType, shotlistData: req.body.shotlistData, visualStyle: req.body.visualStyle, referenceImages: req.body.referenceImages, genre: req.body.genre },
      onChunk: (chunk) => { fullText += chunk; res.write(`data: ${JSON.stringify({ type: "chunk", taskId: req.body.taskId, chunk })}\n\n`); },
    });
    res.write(`data: ${JSON.stringify({ type: "done", text: fullText, taskId: req.body.taskId })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`); res.end(); }
  }
});

// project 相关
expressApp.get("/api/project/all", (req, res) => {
  try { res.json(database.getProjectsList()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/project/rename", (req, res) => {
  try { res.json(database.renameProjectById(req.body.projectId, req.body.newName)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.delete("/api/project/:projectId", (req, res) => {
  try { res.json(database.deleteProjectById(req.params.projectId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// auth 相关
expressApp.post("/api/auth/set-token", (req, res) => {
  try { serverLlmProxy.setUserToken(req.body.token, req.body.refreshToken); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// screenplay 相关
expressApp.get("/api/screenplay/skill-status", (req, res) => {
  try { res.json(screenplayService.getSkillStatus()); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/create-project", (req, res) => {
  try { res.json(screenplayService.createProject(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/screenplay/project/:projectId", (req, res) => {
  try { res.json(screenplayService.getProject(req.params.projectId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/screenplay/recent-projects", (req, res) => {
  try { res.json(screenplayService.listRecentProjects(parseInt(req.query.limit) || 20)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.delete("/api/screenplay/project/:projectId", (req, res) => {
  try { res.json(screenplayService.deleteProject(req.params.projectId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/update-step-structured", (req, res) => {
  try { const { projectId, stepNumber, structured } = req.body; res.json(screenplayService.updateStepStructured(projectId, stepNumber, structured)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/rename-project", (req, res) => {
  try { res.json(screenplayService.renameProject(req.body.projectId, req.body.newName)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/finalize-to-script-task", (req, res) => {
  try { res.json(screenplayService.finalizeToScriptTask(req.body.projectId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/generate-step", async (req, res) => {
  try { res.json(await screenplayService.generateStep(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/selfcheck-step", async (req, res) => {
  try { res.json(await screenplayService.selfcheckStep(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/screenplay/cached-selfcheck", (req, res) => {
  try { res.json(screenplayService.getCachedSelfcheck(req.query.projectId, parseInt(req.query.stepNumber))); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/approve-step", (req, res) => {
  try { const { projectId, stepNumber, nextStep } = req.body; res.json(screenplayService.approveStep(projectId, stepNumber, nextStep)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/rollback-to", (req, res) => {
  try { res.json(screenplayService.rollbackTo(req.body.projectId, req.body.targetStep)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/screenplay/versions", (req, res) => {
  try { res.json(screenplayService.listVersions(req.query.projectId, parseInt(req.query.stepNumber))); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/restore-version", (req, res) => {
  try { const { projectId, stepNumber, versionId } = req.body; res.json(screenplayService.restoreVersion(projectId, stepNumber, versionId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/set-step-selection", (req, res) => {
  try { const { projectId, stepNumber, selectionId } = req.body; res.json(screenplayService.setStepSelection(projectId, stepNumber, selectionId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/screenplay/checkpoint", (req, res) => {
  try { res.json(screenplayService.getCheckpoint(req.query.projectId, req.query.trigger)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/screenplay/regenerate-checkpoint", async (req, res) => {
  try { res.json(await screenplayService.generateCheckpoint(req.body.projectId, req.body.trigger)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// seedance 相关
expressApp.post("/api/seedance/run-phase-ad", async (req, res) => {
  try { const db = getDbInstance(); res.json(await seedanceService.runPhaseAD(db, req.body.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/seedance/analysis/:taskId", (req, res) => {
  try { const db = getDbInstance(); res.json(seedanceService.getAnalysis(db, req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/seedance/run-unit", async (req, res) => {
  try { const db = getDbInstance(); res.json(await seedanceService.runUnitGeneration(db, req.body.taskId, req.body.unitIndex)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.post("/api/seedance/run-all", async (req, res) => {
  try { const db = getDbInstance(); res.json(await seedanceService.runGenerateAll(db, req.body.taskId, () => {}, req.body.concurrency)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/seedance/units/:taskId", (req, res) => {
  try { const db = getDbInstance(); res.json(seedanceService.listAllUnits(db, req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/seedance/unit/:taskId/:unitIndex", (req, res) => {
  try { const db = getDbInstance(); res.json(seedanceService.getUnitRecord(db, req.params.taskId, parseInt(req.params.unitIndex))); } catch (err) { res.status(500).json({ error: err.message }); }
});
expressApp.get("/api/seedance/check-freshness/:taskId", (req, res) => {
  try { const db = getDbInstance(); res.json(seedanceService.checkAnalysisFreshness(db, req.params.taskId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.API_PORT || 3000;

async function bootstrap() {
  console.log("[WebServer] 🚀 Electron + Express Web 服务器启动中...");

  database = await import("./electron/database/index.mjs");
  screenplayService = await import("./electron/services/screenplayService.mjs");
  seedanceService = await import("./electron/database/seedanceService.mjs");
  llmClient = await import("./electron/runtime/llmClient.mjs");
  serverLlmProxy = await import("./electron/runtime/serverLlmProxy.mjs");

  const { db } = database.initDatabase();
  console.log("[WebServer] ✅ 数据库初始化完成");

  const zombieCount = seedanceService.resetZombieUnits(db);
  if (zombieCount > 0) console.log(`[WebServer] 🧟 清理了 ${zombieCount} 个僵尸单元`);

  expressApp.listen(PORT, () => {
    console.log(`[WebServer] 🎉 API 服务器已启动: http://localhost:${PORT}`);
    console.log(`[WebServer] 📡 API 地址: http://localhost:${PORT}/api`);
    console.log(`[WebServer] 🌐 前端地址: http://localhost:5173`);
  });
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  // Web 模式下不需要退出
});
