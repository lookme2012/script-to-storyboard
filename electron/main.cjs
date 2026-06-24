/**
 * main.js — Electron 主进程入口 🚀
 *
 * 这是整个应用的"大总管"，负责:
 *   1. 创建主窗口（1440x900，深色主题）
 *   2. 初始化数据库（SQLite）
 *   3. 清理僵尸单元（上次崩溃留下的 generating 状态）
 *   4. 注册所有 IPC handlers（前后端通信通道）
 *   5. 处理应用生命周期（退出、重新激活等）
 *
 * 启动流程:
 *   app.whenReady() → 动态导入 ESM 模块 → 初始化数据库 →
 *   清理僵尸 → 注册 IPC → 创建窗口
 *
 * 为什么用动态 import？
 *   因为现有的 database/services 模块是 ES Module 格式（import/export），
 *   而 Electron 主进程默认用 CommonJS（require/module.exports），
 *   动态 import() 是两种模块系统"握手言和"的桥梁 🤝
 */

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");

/** 主窗口引用，全局保持 */
let mainWindow = null;

// ═══════════════════════════════════════════════════════════════
//  窗口创建
// ═══════════════════════════════════════════════════════════════

/**
 * 创建主窗口
 * 🖥️ 1440x900，深色背景 #120b19，隐藏标题栏（自定义拖拽区）
 *
 * webPreferences 关键配置:
 *   - preload: 加载桥接脚本，暴露 window.zensApp
 *   - contextIsolation: true，渲染进程不能直接访问 Node.js
 *   - nodeIntegration: false，安全第一 🔒
 */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#120b19",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /**
   * webview 新窗口拦截
   * 🚫 不允许弹出新窗口，在原 webview 内导航
   * 防止用户点击链接时弹出额外的 Electron 窗口
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.webContents.loadURL(url);
    return { action: "deny" };
  });

  /**
   * 根据环境加载不同的页面
   * 🛠️ 开发模式: 加载 Vite 开发服务器（热更新）
   * 📦 生产模式: 加载打包后的 dist/index.html
   */
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html")
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ═══════════════════════════════════════════════════════════════
//  自动更新 IPC 存根
// ═══════════════════════════════════════════════════════════════

/**
 * 注册自动更新相关的 IPC handlers（存根）
 * 🔄 目前只是占位，等接入 electron-updater 后替换
 */
function registerUpdateStubs() {
  ipcMain.handle("update:check", () => {
    console.log("[Update] 检查更新（存根）");
    return { hasUpdate: false, version: app.getVersion() };
  });

  ipcMain.handle("update:download", () => {
    console.log("[Update] 下载更新（存根）");
    return { success: false, error: "自动更新尚未实现" };
  });

  ipcMain.handle("update:install", () => {
    console.log("[Update] 安装更新（存根）");
    return { success: false, error: "自动更新尚未实现" };
  });
}

// ═══════════════════════════════════════════════════════════════
//  启动引导
// ═══════════════════════════════════════════════════════════════

/**
 * 应用启动引导函数
 * 🏗️ 按顺序执行:
 *   1. 动态导入 ESM 模块
 *   2. 初始化数据库
 *   3. 清理僵尸单元
 *   4. 注册 IPC handlers
 *   5. 注册更新存根
 *   6. 创建主窗口
 */
async function bootstrap() {
  try {
    console.log("[Main] 🚀 开始启动引导...");

    // ── 1. 动态导入 ESM 模块 ──────────────────────────────
    const database = await import("./database/index.mjs");
    const screenplayService = await import("./services/screenplayService.mjs");
    const seedanceService = await import("./database/seedanceService.mjs");
    const llmClient = await import("./runtime/llmClient.mjs");
    const serverLlmProxy = await import("./runtime/serverLlmProxy.mjs");

    console.log("[Main] ✅ ESM 模块导入完成");

    // ── 2. 初始化数据库 ────────────────────────────────────
    const { db } = database.initDatabase();
    console.log("[Main] ✅ 数据库初始化完成");

    // ── 3. 清理僵尸单元 ────────────────────────────────────
    /**
     * 上次 Electron 崩溃时，可能有单元卡在 generating 状态
     * 启动时统一重置为 pending，用户重新点"生成"即可续跑 🧟‍♂️→🧑
     */
    const zombieCount = seedanceService.resetZombieUnits(db);
    if (zombieCount > 0) {
      console.log(
        `[Main] 🧟 清理了 ${zombieCount} 个僵尸单元 (generating → pending)`
      );
    }

    // ── 4. 注册 IPC handlers ───────────────────────────────
    const { registerIpcHandlers } = require("./ipc.cjs");
    registerIpcHandlers({
      ipcMain,
      app,
      dialog,
      BrowserWindow,
      database,
      screenplayService,
      seedanceService,
      llmClient,
      serverLlmProxy,
    });

    // ── 5. 注册更新存根 ────────────────────────────────────
    registerUpdateStubs();

    // ── 6. 创建主窗口 ──────────────────────────────────────
    await createWindow();

    console.log("[Main] 🎉 应用启动完成！");
  } catch (err) {
    console.error("[Main] ❌ 启动失败:", err);
    app.quit();
  }
}

// ═══════════════════════════════════════════════════════════════
//  应用生命周期
// ═══════════════════════════════════════════════════════════════

/**
 * 应用就绪后启动引导
 * 🎬 Electron 的 app.whenReady() 是一切的开始
 */
app.whenReady().then(bootstrap);

/**
 * 所有窗口关闭时退出应用
 * 🚪 Windows/Linux 上关闭所有窗口 = 退出应用
 * （macOS 上通常不退出，保留在 Dock 里）
 */
app.on("window-all-closed", () => {
  app.quit();
});

/**
 * 应用重新激活时创建窗口
 * 🔄 macOS 点击 Dock 图标时触发，如果没有窗口就创建一个
 */
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
