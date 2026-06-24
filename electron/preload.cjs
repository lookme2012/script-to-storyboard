/**
 * preload.js — 桥接层 🌉
 *
 * 这是 Electron 的"翻译官"，把主进程的能力翻译给渲染进程用。
 * 渲染进程通过 window.zensApp 调用方法，背后其实是跨进程 IPC 通信。
 *
 * 核心机制:
 *   - contextBridge.exposeInMainWorld → 把 API 挂到 window.zensApp
 *   - ipcRenderer.invoke → 调用主进程的 ipcMain.handle
 *   - ipcRenderer.on → 监听主进程推送的流式事件
 *   - 返回 unsubscribe 函数 → 方便组件卸载时清理监听器，防止内存泄漏
 *
 * 安全原则:
 *   - contextIsolation=true，渲染进程不能直接访问 Node.js API
 *   - 只暴露必要的 IPC 方法，不暴露 ipcRenderer 本身
 */

const { contextBridge, ipcRenderer } = require("electron");

// ═══════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * 创建 IPC invoke 的快捷封装
 * 📡 一行代码搞定：调用主进程 handler + 返回 Promise
 *
 * @param {string} channel - IPC 通道名
 * @returns {Function} 封装后的函数，调用时自动 invoke
 */
function invoke(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}

/**
 * 创建流式事件监听器
 * 🎧 监听主进程推送的事件，返回 unsubscribe 函数
 *
 * 用法:
 *   const unsub = zensApp.onScriptGenerationChunk((data) => { ... });
 *   // 组件卸载时:
 *   unsub();
 *
 * @param {string} channel - IPC 通道名
 * @returns {Function} 注册函数，传入 callback，返回 unsubscribe 函数
 */
function createListener(channel) {
  return (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

// ═══════════════════════════════════════════════════════════════
//  暴露 API 给渲染进程
// ═══════════════════════════════════════════════════════════════

contextBridge.exposeInMainWorld("zensApp", {
  // ─── 平台与版本信息 ───────────────────────────────────
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },

  // ═══════════════════════════════════════════════════════════
  //  app 相关 — 应用全局信息与设置
  // ═══════════════════════════════════════════════════════════

  /** 获取数据库元信息 */
  getDatabaseMeta: invoke("app:get-database-meta"),

  /** 获取应用版本号 */
  getVersion: invoke("app:get-version"),

  /** 读取应用设置 */
  getAppSettings: invoke("app:get-settings"),

  /** 保存应用设置 */
  saveAppSettings: invoke("app:save-settings"),

  /** 测试 LLM 连接 */
  testConnection: invoke("app:test-connection"),

  // ═══════════════════════════════════════════════════════════
  //  script 相关 — 剧本任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的剧本任务列表 */
  getRecentScriptTasks: invoke("script:get-recent-tasks"),

  /** 加载指定剧本任务 */
  loadScriptTask: invoke("script:load-task"),

  /** 删除指定剧本任务 */
  deleteScriptTask: invoke("script:delete-task"),

  /** 保存剧本草稿 */
  saveScriptDraft: invoke("script:save-draft"),

  /** 运行剧本生成 */
  runScriptGeneration: invoke("script:run-generation"),

  /** 更新剧本正文 */
  updateScriptBody: invoke("script:update-body"),

  /** 导入已有剧本 */
  importExistingScript: invoke("script:import-existing"),

  /** 运行剧本审核 */
  runScriptReview: invoke("script:run-review"),

  /** 监听剧本生成流式 chunk */
  onScriptGenerationChunk: createListener("script:generation-chunk"),

  // ═══════════════════════════════════════════════════════════
  //  image 相关 — 图片提示词任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的图片任务列表 */
  getRecentImageTasks: invoke("image:get-recent-tasks"),

  /** 保存图片草稿 */
  saveImageDraft: invoke("image:save-draft"),

  /** 运行图片提示词生成 */
  runImageGeneration: invoke("image:run-generation"),

  /** 运行图片审核 */
  runImageReview: invoke("image:run-review"),

  /** 删除图片任务 */
  deleteImageTask: invoke("image:delete-task"),

  // ═══════════════════════════════════════════════════════════
  //  video 相关 — 视频提示词任务管理
  // ═══════════════════════════════════════════════════════════

  /** 获取最近的视频任务列表 */
  getRecentVideoTasks: invoke("video:get-recent-tasks"),

  /** 保存视频草稿 */
  saveVideoDraft: invoke("video:save-draft"),

  /** 运行视频提示词生成 */
  runVideoGeneration: invoke("video:run-generation"),

  /** 运行视频审核 */
  runVideoReview: invoke("video:run-review"),

  /** 删除视频任务 */
  deleteVideoTask: invoke("video:delete-task"),

  // ═══════════════════════════════════════════════════════════
  //  asset 相关 — 资产管理（角色/场景/道具）
  // ═══════════════════════════════════════════════════════════

  /** 运行资产提取 */
  runAssetExtraction: invoke("asset:extract"),

  /** 获取指定任务的资产列表 */
  getAssetsByTask: invoke("asset:get-by-task"),

  /** 获取资产扫描结果 */
  getAssetScan: invoke("asset:get-scan"),

  /** 更新资产记录 */
  updateAsset: invoke("asset:update"),

  /** 监听资产提取进度 */
  onAssetExtractProgress: createListener("asset:extract-progress"),

  // ═══════════════════════════════════════════════════════════
  //  prompt 相关 — 提示词生成与管理
  // ═══════════════════════════════════════════════════════════

  /** 生成单个场景的提示词 */
  generatePrompt: invoke("prompt:generate"),

  /** 批量生成一组场景的提示词 */
  generatePromptGroup: invoke("prompt:generate-group"),

  /** 更新提示词记录 */
  updatePrompt: invoke("prompt:update"),

  /** 获取指定任务的提示词列表 */
  getPromptsByTask: invoke("prompt:get-by-task"),

  /** 获取场景数量 */
  getPromptSceneCount: invoke("prompt:scene-count"),

  /** 获取分段标题列表 */
  getPromptSegmentTitles: invoke("prompt:segment-titles"),

  /** 运行提示词质量检查 */
  runPromptQualityCheck: invoke("prompt:quality-check"),

  /** 生成大纲 */
  generateOutline: invoke("prompt:generate-outline"),

  /** 确认大纲 */
  confirmOutline: invoke("prompt:confirm-outline"),

  /** 获取大纲 */
  getOutline: invoke("prompt:get-outline"),

  /** 生成视频提示词（流式）— 抓耳挠腮 Prompt 模板 v1.22 */
  generateVideoPrompt: invoke("prompt:generate-video-prompt"),

  /** 监听视频提示词生成流式 chunk */
  onVideoPromptChunk: createListener("prompt:video-prompt-chunk"),

  // ═══════════════════════════════════════════════════════════
  //  project 相关 — 项目管理
  // ═══════════════════════════════════════════════════════════

  /** 获取所有项目列表 */
  getProjects: invoke("project:get-all"),

  /** 重命名项目 */
  renameProject: invoke("project:rename"),

  /** 删除项目 */
  deleteProject: invoke("project:delete"),

  // ═══════════════════════════════════════════════════════════
  //  file 相关 — 文件选择与读取
  // ═══════════════════════════════════════════════════════════

  /** 选择文本文件并读取内容 */
  selectTextFile: invoke("file:select-text"),

  /** 选择图片文件并转为 base64 */
  selectImageFile: invoke("file:select-image"),

  // ═══════════════════════════════════════════════════════════
  //  auth 相关 — 认证与令牌管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 设置认证令牌
   * 🎫 登录成功后调用，传入 token 和 refreshToken
   */
  setAuthToken: (token, refreshToken) =>
    ipcRenderer.invoke("auth:set-token", { token, refreshToken }),

  /**
   * 监听会话过期事件
   * 🔔 当 Token 失效或被踢下线时触发，通常用来弹登录框
   */
  onSessionExpired: createListener("auth:session-expired"),

  // ═══════════════════════════════════════════════════════════
  //  screenplay 子对象 — 八步工作流 🎬
  // ═══════════════════════════════════════════════════════════

  screenplay: {
    /** 获取 SKILL 状态 */
    skillStatus: invoke("screenplay:skill-status"),

    /** 创建新项目 */
    createProject: invoke("screenplay:create-project"),

    /** 获取项目详情 */
    getProject: invoke("screenplay:get-project"),

    /** 列出最近项目 */
    listRecentProjects: invoke("screenplay:list-recent-projects"),

    /** 删除项目 */
    deleteProject: invoke("screenplay:delete-project"),

    /** 更新某一步的 structured 数据 */
    updateStepStructured: (projectId, stepNumber, structured) =>
      ipcRenderer.invoke(
        "screenplay:update-step-structured",
        projectId,
        stepNumber,
        structured
      ),

    /** 重命名项目 */
    renameProject: (projectId, newName) =>
      ipcRenderer.invoke("screenplay:rename-project", projectId, newName),

    /** 更新项目时长 */
    updateDuration: (projectId, duration) =>
      ipcRenderer.invoke("screenplay:update-duration", projectId, duration),

    /** 桥接到老 script_tasks 体系 */
    finalizeToScriptTask: (projectId) =>
      ipcRenderer.invoke("screenplay:finalize-to-script-task", projectId),

    /** 生成某一步的产出（流式） */
    generateStep: (params) =>
      ipcRenderer.invoke("screenplay:generate-step", params),

    /** 自检某一步的产出（流式） */
    selfcheckStep: (params) =>
      ipcRenderer.invoke("screenplay:selfcheck-step", params),

    /** 获取缓存的自检结果 */
    getCachedSelfcheck: (projectId, stepNumber) =>
      ipcRenderer.invoke(
        "screenplay:get-cached-selfcheck",
        projectId,
        stepNumber
      ),

    /** 批准某一步完成 */
    approveStep: (params) =>
      ipcRenderer.invoke(
        "screenplay:approve-step",
        params?.projectId,
        params?.stepNumber,
        params?.nextStep,
        params?.surgeryDecisions
      ),

    /** 回滚到指定步骤 */
    rollbackTo: (projectId, targetStep) =>
      ipcRenderer.invoke("screenplay:rollback-to", projectId, targetStep),

    /** 列出某一步的所有版本 */
    listVersions: (projectId, stepNumber) =>
      ipcRenderer.invoke("screenplay:list-versions", projectId, stepNumber),

    /** 恢复到指定版本 */
    restoreVersion: (projectId, stepNumber, versionId) =>
      ipcRenderer.invoke(
        "screenplay:restore-version",
        projectId,
        stepNumber,
        versionId
      ),

    /** 设置某一步的用户选择 */
    setStepSelection: (projectId, stepNumber, selectionId) =>
      ipcRenderer.invoke(
        "screenplay:set-step-selection",
        projectId,
        stepNumber,
        selectionId
      ),

    /** 获取检查点内容 */
    getCheckpoint: (projectId, trigger) =>
      ipcRenderer.invoke("screenplay:get-checkpoint", projectId, trigger),

    /** 重新生成检查点 */
    regenerateCheckpoint: (projectId, trigger) =>
      ipcRenderer.invoke(
        "screenplay:regenerate-checkpoint",
        projectId,
        trigger
      ),

    /**
     * 监听八步工作流流式 chunk
     * 🌊 生成/自检时，LLM 输出的每个 chunk 都会推送
     * 回调参数: { projectId, stepNumber, chunk }
     */
    onStreamChunk: createListener("screenplay:stream-chunk"),
  },

  // ═══════════════════════════════════════════════════════════
  //  seedance 子对象 — V5 分镜服务 🎬
  // ═══════════════════════════════════════════════════════════

  seedance: {
    /** 运行 Phase A-D 分析 */
    runPhaseAD: (taskId) =>
      ipcRenderer.invoke("seedance:run-phase-ad", taskId),

    /** 获取已保存的分析结果 */
    getAnalysis: (taskId) =>
      ipcRenderer.invoke("seedance:get-analysis", taskId),

    /** 运行单个单元的 Phase E-F-G 生成 */
    runUnit: (taskId, unitIndex) =>
      ipcRenderer.invoke("seedance:run-unit", taskId, unitIndex),

    /** 并行生成所有单元 */
    runAll: (taskId, concurrency) =>
      ipcRenderer.invoke("seedance:run-all", { taskId, concurrency }),

    /** 列出所有单元记录 */
    listUnits: (taskId) =>
      ipcRenderer.invoke("seedance:list-units", taskId),

    /** 获取单个单元记录 */
    getUnit: (taskId, unitIndex) =>
      ipcRenderer.invoke("seedance:get-unit", taskId, unitIndex),

    /** 检测分析是否与当前剧本对应 */
    checkFreshness: (taskId) =>
      ipcRenderer.invoke("seedance:check-freshness", taskId),

    /**
     * 监听批量生成进度
     * 📊 回调参数: { taskId, unitIndex, totalUnits, status }
     */
    onProgress: createListener("seedance:run-all-progress"),

    /**
     * 监听 Phase A-D 分析流式 chunk
     * 🌊 回调参数: { taskId, chunk }
     */
    onAnalysisChunk: createListener("seedance:analysis-chunk"),

    /**
     * 监听单元生成流式 chunk
     * 🌊 回调参数: { taskId, unitIndex, chunk }
     */
    onUnitChunk: createListener("seedance:unit-chunk"),
  },

  // ═══════════════════════════════════════════════════════════
  //  update 子对象 — 自动更新 🔄
  // ═══════════════════════════════════════════════════════════

  update: {
    /** 检查是否有新版本 */
    checkForUpdate: () => ipcRenderer.invoke("update:check"),

    /** 下载更新包 */
    downloadUpdate: () => ipcRenderer.invoke("update:download"),

    /** 安装更新（会重启应用） */
    installUpdate: () => ipcRenderer.invoke("update:install"),

    /**
     * 监听"发现新版本"事件
     * 📢 回调参数: { version, releaseNotes }
     */
    onUpdateAvailable: createListener("update:available"),

    /**
     * 监听下载进度
     * 📊 回调参数: { bytesPerSecond, percent, transferred, total }
     */
    onUpdateDownloadProgress: createListener("update:download-progress"),

    /**
     * 监听下载完成
     * ✅ 下载完成后可以提示用户安装
     */
    onUpdateDownloaded: createListener("update:downloaded"),

    /**
     * 监听更新错误
     * ❌ 回调参数: { message }
     */
    onUpdateError: createListener("update:error"),
  },
});
