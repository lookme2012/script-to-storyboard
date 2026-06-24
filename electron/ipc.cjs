/**
 * ipc.js — IPC 注册中心 🎯
 *
 * 所有前后端通信通道的"总调度台"。
 * 就像邮局的分拣中心，每一封信（IPC 消息）都有对应的处理窗口（handler）。
 *
 * 架构设计:
 *   - 使用依赖注入模式，main.js 动态 import ESM 模块后把引用传进来
 *   - 流式通道用 event.sender.send 向渲染进程推送 chunk/progress
 *   - 所有 sender.send 前都检查 isDestroyed()，防止窗口关闭后崩溃
 *   - 尚未实现的数据库函数用存根（stub）占位，后续开发替换即可
 */

const fs = require("node:fs");
const path = require("node:path");

// ═══════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════



/**
 * 安全地向渲染进程发送 IPC 消息
 * 🛡️ 先检查 sender 是否已销毁，避免 "Object has been destroyed" 崩溃
 *
 * @param {Electron.IpcMainEvent} sender - IPC 事件的 sender
 * @param {string} channel - IPC 通道名
 * @param {*} data - 要发送的数据
 */
function safeSend(sender, channel, data) {
  try {
    if (sender && !sender.isDestroyed()) {
      sender.send(channel, data);
    }
  } catch (err) {
    console.warn(`[IPC] safeSend ${channel} 失败:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  数据库存根（尚未实现的函数）
// ═══════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
//  核心：注册所有 IPC Handlers
// ═══════════════════════════════════════════════════════════════

/**
 * 注册所有 IPC handlers
 * 📡 把每个 IPC 通道绑定到对应的处理函数
 *
 * @param {object} deps - 依赖注入对象
 * @param {object} deps.ipcMain - Electron ipcMain
 * @param {object} deps.app - Electron app 实例
 * @param {object} deps.dialog - Electron dialog 模块
 * @param {object} deps.BrowserWindow - Electron BrowserWindow 类
 * @param {object} deps.database - 数据库模块（ESM 动态导入后的引用）
 * @param {object} deps.screenplayService - 八步工作流服务模块
 * @param {object} deps.seedanceService - V5 分镜服务模块
 * @param {object} deps.llmClient - LLM 连接测试模块
 * @param {object} deps.serverLlmProxy - 服务端 LLM 代理模块
 */
function registerIpcHandlers(deps) {
  const {
    ipcMain,
    app,
    dialog,
    BrowserWindow,
    database,
    screenplayService,
    seedanceService,
    llmClient,
    serverLlmProxy,
  } = deps;

  /**
   * 获取数据库实例（better-sqlite3）
   * 🔑 很多 seedanceService 函数需要 db 参数，统一从这里拿
   */
  function getDbInstance() {
    return database.initDatabase().db;
  }

  // ═══════════════════════════════════════════════════════════
  //  app 相关 — 应用全局信息与设置
  // ═══════════════════════════════════════════════════════════

  /** 获取数据库元信息（路径、数据目录等） */
  ipcMain.handle("app:get-database-meta", () => {
    return database.getDatabaseMeta();
  });

  /** 获取应用版本号 */
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  /** 读取应用设置 */
  ipcMain.handle("app:get-settings", () => {
    return database.getAppSettingsFull();
  });

  /** 保存应用设置 */
  ipcMain.handle("app:save-settings", (_event, payload) => {
    return database.saveAppSettingsFull(payload);
  });

  /** 测试 LLM 连接是否正常 */
  ipcMain.handle("app:test-connection", (_event, payload) => {
    return llmClient.testConnection(payload);
  });

  // ═══════════════════════════════════════════════════════════
  //  script 相关 — 剧本任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的剧本任务列表 */
  ipcMain.handle("script:get-recent-tasks", () => {
    return database.getRecentScriptTasksFull();
  });

  /** 加载指定剧本任务的详情 */
  ipcMain.handle("script:load-task", (_event, taskId) => {
    return database.loadScriptTaskFull(taskId);
  });

  /** 删除指定剧本任务 */
  ipcMain.handle("script:delete-task", (_event, taskId) => {
    return database.deleteScriptTaskFull(taskId);
  });

  /** 保存剧本草稿 */
  ipcMain.handle("script:save-draft", (_event, payload) => {
    return database.saveScriptDraftFull(payload);
  });

  /**
   * 运行剧本生成（流式）— 使用本地 Prompt Builder
   * 🌊 LLM 一边生成一边通过 sender.send 推送 chunk 给渲染进程
   */
  ipcMain.handle("script:run-generation", async (event, payload) => {
    const { resolveRuntimeConfig } = await import("./runtime/runtimeConfig.mjs");
    const { getAppSettings } = await import("./database/appSettings.mjs");
    const { requestLocalBuilderStream } = serverLlmProxy;

    const dbInstance = getDbInstance();
    const runtimeConfig = resolveRuntimeConfig(getAppSettings(dbInstance));
    if (runtimeConfig.mode === "local-mock") {
      throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
    }

    let fullText = "";
    await requestLocalBuilderStream({
      runtimeConfig,
      contextType: "script_generation",
      contextParams: {
        concept: payload.concept,
        genre: payload.genre,
        duration: payload.duration,
        style: payload.style,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        safeSend(event.sender, "script:generation-chunk", chunk);
      },
    });

    return { text: fullText, taskId: payload.taskId };
  });

  /** 更新剧本正文 */
  ipcMain.handle("script:update-body", (_event, taskId, newBody) => {
    return database.updateScriptBodyFull(taskId, newBody);
  });

  /** 导入已有剧本 */
  ipcMain.handle("script:import-existing", (_event, payload) => {
    return database.importExistingScriptFull(payload);
  });

  /**
   * 运行剧本审核/医生（流式）— 使用本地 Prompt Builder
   * 🩺 contextType="script_review"，剧本诊断
   */
  ipcMain.handle("script:run-review", async (event, payload) => {
    const { resolveRuntimeConfig } = await import("./runtime/runtimeConfig.mjs");
    const { getAppSettings } = await import("./database/appSettings.mjs");
    const { requestLocalBuilderStream } = serverLlmProxy;

    const dbInstance = getDbInstance();
    const runtimeConfig = resolveRuntimeConfig(getAppSettings(dbInstance));
    if (runtimeConfig.mode === "local-mock") {
      throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
    }

    let fullText = "";
    await requestLocalBuilderStream({
      runtimeConfig,
      contextType: "script_review",
      contextParams: {
        scriptBody: payload.scriptBody,
        concept: payload.concept,
        reviewType: payload.reviewType,
      },
      onChunk: (chunk) => {
        fullText += chunk;
      },
    });

    return { text: fullText, taskId: payload.taskId };
  });

  // ═══════════════════════════════════════════════════════════
  //  image 相关 — 图片提示词任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的图片任务列表 */
  ipcMain.handle("image:get-recent-tasks", () => {
    return database.getRecentImageTasksFull();
  });

  /** 保存图片草稿 */
  ipcMain.handle("image:save-draft", (_event, payload) => {
    return database.saveImageDraftFull(payload);
  });

  /** 运行图片提示词生成 */
  ipcMain.handle("image:run-generation", (_event, payload) => {
    return database.runImageGenerationFull(payload);
  });

  /** 运行图片审核 */
  ipcMain.handle("image:run-review", (_event, payload) => {
    return database.runImageReviewFull(payload);
  });

  /** 删除图片任务 */
  ipcMain.handle("image:delete-task", (_event, taskId) => {
    return database.deleteImageTaskFull(taskId);
  });

  // ═══════════════════════════════════════════════════════════
  //  video 相关 — 视频提示词任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的视频任务列表 */
  ipcMain.handle("video:get-recent-tasks", () => {
    return database.getRecentVideoTasksFull();
  });

  /** 保存视频草稿 */
  ipcMain.handle("video:save-draft", (_event, payload) => {
    return database.saveVideoDraftFull(payload);
  });

  /** 运行视频提示词生成 */
  ipcMain.handle("video:run-generation", (_event, payload) => {
    return database.runVideoGenerationFull(payload);
  });

  /** 运行视频审核 */
  ipcMain.handle("video:run-review", (_event, payload) => {
    return database.runVideoReviewFull(payload);
  });

  /** 删除视频任务 */
  ipcMain.handle("video:delete-task", (_event, taskId) => {
    return database.deleteVideoTaskFull(taskId);
  });

  // ═══════════════════════════════════════════════════════════
  //  asset 相关 — 资产管理（角色/场景/道具）🏠 本地 Builder
  // ═══════════════════════════════════════════════════════════

  /**
   * 运行资产提取（流式）— 使用本地 Prompt Builder
   * � contextType="asset_extract"，全资产大师 V3.0
   * 流式 chunk 通过 asset:extract-progress 推送给渲染进程
   */
  ipcMain.handle("asset:extract", async (event, payload) => {
    const { resolveRuntimeConfig } = await import("./runtime/runtimeConfig.mjs");
    const { getAppSettings } = await import("./database/appSettings.mjs");
    const { requestLocalBuilderStream } = serverLlmProxy;

    const dbInstance = getDbInstance();
    const runtimeConfig = resolveRuntimeConfig(getAppSettings(dbInstance));
    if (runtimeConfig.mode === "local-mock") {
      throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
    }

    let fullText = "";
    await requestLocalBuilderStream({
      runtimeConfig,
      contextType: "asset_extract",
      contextParams: {
        scriptText: payload.scriptText,
        assetType: payload.assetType,
        visualStyle: payload.visualStyle,
        era: payload.era,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        safeSend(event.sender, "asset:extract-progress", {
          taskId: payload.taskId,
          chunk,
        });
      },
    });

    return { text: fullText, taskId: payload.taskId };
  });

  /** 获取指定任务的资产列表 */
  ipcMain.handle("asset:get-by-task", (_event, taskId) => {
    return database.getAssetsByTaskFull(taskId);
  });

  /** 获取资产扫描结果 */
  ipcMain.handle("asset:get-scan", (_event, taskId) => {
    return database.getAssetScanFull(taskId);
  });

  /** 更新资产记录 */
  ipcMain.handle("asset:update", (_event, payload) => {
    return database.updateAssetFull(payload);
  });

  // ═══════════════════════════════════════════════════════════
  //  prompt 相关 — 提示词生成与管理
  // ═══════════════════════════════════════════════════════════

  /** 生成单个场景的提示词 */
  ipcMain.handle("prompt:generate", (_event, payload) => {
    return database.generatePromptFull(payload);
  });

  /** 批量生成一组场景的提示词 */
  ipcMain.handle("prompt:generate-group", (_event, payload) => {
    return database.generatePromptGroupFull(payload);
  });

  /** 更新提示词记录 */
  ipcMain.handle("prompt:update", (_event, payload) => {
    return database.updatePromptFull(payload);
  });

  /** 获取指定任务的提示词列表 */
  ipcMain.handle("prompt:get-by-task", (_event, taskId) => {
    return database.getPromptsByTaskFull(taskId);
  });

  /** 获取场景数量 */
  ipcMain.handle("prompt:scene-count", (_event, taskId) => {
    return database.getPromptSceneCountFull(taskId);
  });

  /** 获取分段标题列表 */
  ipcMain.handle("prompt:segment-titles", (_event, taskId) => {
    return database.getPromptSegmentTitlesFull(taskId);
  });

  /** 运行提示词质量检查 */
  ipcMain.handle("prompt:quality-check", (_event, payload) => {
    return database.runPromptQualityCheckFull(payload);
  });

  /** 生成大纲 */
  ipcMain.handle("prompt:generate-outline", (_event, payload) => {
    return database.generateOutlineFull(payload);
  });

  /** 确认大纲 */
  ipcMain.handle("prompt:confirm-outline", (_event, payload) => {
    return database.confirmOutlineFull(payload);
  });

  /** 获取大纲 */
  ipcMain.handle("prompt:get-outline", (_event, taskId) => {
    return database.getOutlineFull(taskId);
  });

  /**
   * 生成视频提示词（流式）— 使用本地 Prompt Builder 🎬
   * contextType="video_prompt"，抓耳挠腮 Prompt 模板 v1.22
   * 支持故事板 prompt 和视频 prompt 两种模式
   */
  ipcMain.handle("prompt:generate-video-prompt", async (event, payload) => {
    const { resolveRuntimeConfig } = await import("./runtime/runtimeConfig.mjs");
    const { getAppSettings } = await import("./database/appSettings.mjs");
    const { requestLocalBuilderStream } = serverLlmProxy;

    const dbInstance = getDbInstance();
    const runtimeConfig = resolveRuntimeConfig(getAppSettings(dbInstance));
    if (runtimeConfig.mode === "local-mock") {
      throw new Error("API 未配置, 请先到设置页填写文字模型 API 密钥.");
    }

    let fullText = "";
    await requestLocalBuilderStream({
      runtimeConfig,
      contextType: "video_prompt",
      contextParams: {
        promptType: payload.promptType,
        shotlistData: payload.shotlistData,
        visualStyle: payload.visualStyle,
        referenceImages: payload.referenceImages,
        genre: payload.genre,
      },
      onChunk: (chunk) => {
        fullText += chunk;
        safeSend(event.sender, "prompt:video-prompt-chunk", {
          taskId: payload.taskId,
          chunk,
        });
      },
    });

    return { text: fullText, taskId: payload.taskId };
  });

  // ═══════════════════════════════════════════════════════════
  //  project 相关 — 项目管理
  // ═══════════════════════════════════════════════════════════

  /** 获取所有项目列表 */
  ipcMain.handle("project:get-all", () => {
    return database.getProjectsList();
  });

  /** 重命名项目 */
  ipcMain.handle("project:rename", (_event, projectId, newName) => {
    return database.renameProjectById(projectId, newName);
  });

  /** 删除项目（级联删除所有关联数据） */
  ipcMain.handle("project:delete", (_event, projectId) => {
    return database.deleteProjectById(projectId);
  });

  // ═══════════════════════════════════════════════════════════
  //  auth 相关 — 认证与令牌管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 设置用户认证令牌
   * 🎫 登录成功后调用，同时注册会话过期回调
   * 回调触发时通知渲染进程弹登录框
   */
  ipcMain.handle("auth:set-token", (_event, { token, refreshToken }) => {
    serverLlmProxy.setUserToken(token, refreshToken);
    serverLlmProxy.setSessionExpiredCallback(() => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send("auth:session-expired");
      }
    });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════
  //  file 相关 — 文件选择与读取
  // ═══════════════════════════════════════════════════════════

  /**
   * 选择文本文件并读取内容
   * 📄 弹出文件选择对话框，读取文件内容返回
   */
  ipcMain.handle("file:select-text", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "文本文件", extensions: ["txt", "md", "json", "csv"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, "utf8");
    return { path: filePath, content };
  });

  /**
   * 选择图片文件并转为 base64
   * 🖼️ 弹出文件选择对话框，读取图片并编码为 base64 字符串
   */
  ipcMain.handle("file:select-image", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "图片文件",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };
    const mimeType = mimeMap[ext] || "image/png";
    return { path: filePath, base64, mimeType };
  });

  // ═══════════════════════════════════════════════════════════
  //  screenplay 相关 — 八步工作流 🎬
  // ═══════════════════════════════════════════════════════════

  /** 获取 SKILL 状态（UI 兼容用） */
  ipcMain.handle("screenplay:skill-status", () => {
    return screenplayService.getSkillStatus();
  });

  /** 创建新的八步工作流项目 */
  ipcMain.handle("screenplay:create-project", (_event, init) => {
    return screenplayService.createProject(init);
  });

  /** 获取八步工作流项目详情 */
  ipcMain.handle("screenplay:get-project", (_event, projectId) => {
    return screenplayService.getProject(projectId);
  });

  /** 列出最近的八步工作流项目 */
  ipcMain.handle("screenplay:list-recent-projects", (_event, limit) => {
    return screenplayService.listRecentProjects(limit);
  });

  /** 删除八步工作流项目 */
  ipcMain.handle("screenplay:delete-project", (_event, projectId) => {
    return screenplayService.deleteProject(projectId);
  });

  /** 更新某一步的 structured 数据（用户手动编辑后保存） */
  ipcMain.handle(
    "screenplay:update-step-structured",
    (_event, projectId, stepNumber, structured) => {
      return screenplayService.updateStepStructured(
        projectId,
        stepNumber,
        structured
      );
    }
  );

  /** 重命名八步工作流项目 */
  ipcMain.handle(
    "screenplay:rename-project",
    (_event, projectId, newName) => {
      return screenplayService.renameProject(projectId, newName);
    }
  );

  /** 更新八步工作流项目时长 */
  ipcMain.handle(
    "screenplay:update-duration",
    (_event, projectId, duration) => {
      return screenplayService.updateProjectDuration(projectId, duration);
    }
  );

  /**
   * 把八步工作流产出桥接到老 script_tasks 体系
   * 🌉 Step 7 写作通过后调用，解锁资产/提示词/画布
   */
  ipcMain.handle(
    "screenplay:finalize-to-script-task",
    (_event, projectId) => {
      return screenplayService.finalizeToScriptTask(projectId);
    }
  );

  /**
   * 生成某一步的产出（流式）
   * 🤖 LLM 一边生成，screenplayService 内部通过 broadcastChunk 推送
   * 渲染进程监听 screenplay:stream-chunk 接收
   */
  ipcMain.handle("screenplay:generate-step", async (_event, params) => {
    return screenplayService.generateStep(params);
  });

  /**
   * 自检某一步的产出（流式）
   * 🔍 LLM 一边自检，screenplayService 内部通过 broadcastChunk 推送
   */
  ipcMain.handle("screenplay:selfcheck-step", async (_event, params) => {
    return screenplayService.selfcheckStep(params);
  });

  /** 获取缓存的自检结果（不调用 LLM，直接读 store） */
  ipcMain.handle(
    "screenplay:get-cached-selfcheck",
    (_event, projectId, stepNumber) => {
      return screenplayService.getCachedSelfcheck(projectId, stepNumber);
    }
  );

  /**
   * 批准某一步完成
   * ✅ Step 6 approve 后自动触发 checkpoint 生成（异步不阻塞）
   */
  ipcMain.handle(
    "screenplay:approve-step",
    (_event, projectId, stepNumber, nextStep, surgeryDecisions) => {
      return screenplayService.approveStep(projectId, stepNumber, nextStep, surgeryDecisions);
    }
  );

  /** 回滚到指定步骤 */
  ipcMain.handle(
    "screenplay:rollback-to",
    (_event, projectId, targetStep) => {
      return screenplayService.rollbackTo(projectId, targetStep);
    }
  );

  /** 列出某一步的所有版本 */
  ipcMain.handle(
    "screenplay:list-versions",
    (_event, projectId, stepNumber) => {
      return screenplayService.listVersions(projectId, stepNumber);
    }
  );

  /** 恢复到指定版本（设置活跃版本） */
  ipcMain.handle(
    "screenplay:restore-version",
    (_event, projectId, stepNumber, versionId) => {
      return screenplayService.restoreVersion(
        projectId,
        stepNumber,
        versionId
      );
    }
  );

  /** 设置某一步的用户选择 */
  ipcMain.handle(
    "screenplay:set-step-selection",
    (_event, projectId, stepNumber, selectionId) => {
      return screenplayService.setStepSelection(
        projectId,
        stepNumber,
        selectionId
      );
    }
  );

  /** 获取检查点内容 */
  ipcMain.handle(
    "screenplay:get-checkpoint",
    (_event, projectId, trigger) => {
      return screenplayService.getCheckpoint(projectId, trigger);
    }
  );

  /**
   * 重新生成检查点
   * 💾 手动触发 checkpoint 重新生成
   */
  ipcMain.handle(
    "screenplay:regenerate-checkpoint",
    async (_event, projectId, trigger) => {
      return screenplayService.generateCheckpoint(projectId, trigger);
    }
  );

  // ═══════════════════════════════════════════════════════════
  //  seedance 相关 — V5 分镜服务 🎬
  // ═══════════════════════════════════════════════════════════

  /**
   * 运行 Phase A-D 分析
   * 🧠 单次 LLM 调用，输出段号索引 + 结构 + 情绪地图 + 单元分配表
   * 流式 chunk 通过 seedance:analysis-chunk 推送（seedanceService 内部处理）
   */
  ipcMain.handle("seedance:run-phase-ad", async (_event, taskId) => {
    const dbInstance = getDbInstance();
    return seedanceService.runPhaseAD(dbInstance, taskId);
  });

  /** 获取已保存的分析结果 */
  ipcMain.handle("seedance:get-analysis", (_event, taskId) => {
    const dbInstance = getDbInstance();
    return seedanceService.getAnalysis(dbInstance, taskId);
  });

  /**
   * 运行单个单元的 Phase E-F-G 生成
   * 🎬 流式 chunk 通过 seedance:unit-chunk 推送（seedanceService 内部处理）
   */
  ipcMain.handle("seedance:run-unit", async (_event, taskId, unitIndex) => {
    const dbInstance = getDbInstance();
    return seedanceService.runUnitGeneration(dbInstance, taskId, unitIndex);
  });

  /**
   * 并行生成所有单元（流式进度）
   * 🏗️ worker 池模式，跳过已 done 的 unit
   * 进度通过 seedance:run-all-progress 推送给渲染进程
   */
  ipcMain.handle(
    "seedance:run-all",
    async (event, { taskId, concurrency }) => {
      const dbInstance = getDbInstance();
      return seedanceService.runGenerateAll(
        dbInstance,
        taskId,
        (progress) => {
          safeSend(event.sender, "seedance:run-all-progress", progress);
        },
        concurrency
      );
    }
  );

  /** 列出所有单元记录 */
  ipcMain.handle("seedance:list-units", (_event, taskId) => {
    const dbInstance = getDbInstance();
    return seedanceService.listAllUnits(dbInstance, taskId);
  });

  /** 获取单个单元记录 */
  ipcMain.handle("seedance:get-unit", (_event, taskId, unitIndex) => {
    const dbInstance = getDbInstance();
    return seedanceService.getUnitRecord(dbInstance, taskId, unitIndex);
  });

  /**
   * 检测分析是否与当前剧本对应
   * 🔍 fresh=true 表示剧本没改过，可以直接重生单元
   */
  ipcMain.handle("seedance:check-freshness", (_event, taskId) => {
    const dbInstance = getDbInstance();
    return seedanceService.checkAnalysisFreshness(dbInstance, taskId);
  });

  console.log("[IPC] ✅ 所有 IPC handlers 注册完成");
}

module.exports = { registerIpcHandlers };
