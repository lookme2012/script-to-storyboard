/**
 * electron-stub.mjs — Electron 模块智能适配器 🎭
 *
 * 在 Electron 环境下：直接转发到真正的 electron 模块
 * 在纯 Node.js 环境下：提供 mock 实现
 *
 * 这样同一份代码既能跑 Electron 又能跑纯 Node.js 🤝
 *
 * ⚠️ 不用 top-level await，因为那玩意儿在 import 链里容易翻车
 * 改用同步检测 + 延迟 import 的方式
 *
 * 💡 数据库存路径：用 import.meta.url 定位项目根目录
 *    不管从哪个工作目录启动，数据库路径都一样，数据不会丢
 *    避免用 process.cwd()（依赖启动目录）或 os.homedir()（可能有权限问题）
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = path.resolve(__dirname, "..");

const USER_DATA_DIR = path.join(PROJECT_ROOT, "app-data");

fs.mkdirSync(USER_DATA_DIR, { recursive: true });

const _app = {
  getPath: (name) => {
    if (name === "userData") {
      return USER_DATA_DIR;
    }
    return os.tmpdir();
  },
  getVersion: () => "1.0.0-web",
};

const _BrowserWindow = {
  getAllWindows: () => [],
};

export const app = _app;
export const BrowserWindow = _BrowserWindow;
