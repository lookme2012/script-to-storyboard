# 🎬 抓耳挠腮剧本制作

> 从剧本到电影流线化产出 — 一站式 AI 辅助剧本创作与分镜生成工具

抓耳挠腮是一个面向短剧/微电影创作者的桌面 + Web 双模式工具，帮你从灵感萌芽一路走到可拍摄的分镜稿。内置八步剧本工作流、V5 分镜流水线、提示词模板管理和灵感库，让 AI 真正成为你的编剧搭档。

## ✨ 功能特性

### 🎭 八步剧本工作流
从破题到医生诊断，8 个步骤循序渐进：
1. **破题** — 生成 3 个故事方向供选择
2. **梗概** — 扩展成完整故事概要
3. **人物** — 详细角色卡（含外貌描述，可直接喂给 AI 绘图）
4. **背景** — 世界观与场景设定
5. **结构** — 四幕结构搭建
6. **场次** — 场景列表与时长分配
7. **写作** — 剧本正文（对话 + 动作）
8. **医生** — 诊断报告 + 手术建议（可采纳/拒绝）

每步支持：生成 → 自检 → 通过 → 下一步，含版本管理与回滚。

### 🎞️ V5 分镜流水线
将剧本转化为专业分镜：
- **Phase A-D** — 剧本切段、情绪地图、单元分配
- **Phase E-F-G** — 逐镜生成（COPY 区 + NOTE 区 + 自检）
- **FloobyNooby 15 步** — 从粗缩略图到最终交付的完整流水线
- 即梦 2000 字限制智能压缩，一键复制精简版

### 🤖 LLM 直连架构
- 支持 OpenAI / Anthropic / Gemini 三种 API 格式
- 流式 SSE 输出，实时看到 AI 创作过程
- 自带连接测试，配置即用
- 不依赖任何中间代理服务器，你的 API Key 只属于你

### 📝 提示词模板管理
- 9 个内置提示词模板（剧本/分镜/资产/视频）
- 可视化编辑 systemPrompt + userPrompt
- 支持自定义模板与一键重置

### 💡 灵感库
- 87 条精选灵感，覆盖 12 个分类
- 含故事摘要、完整提案、建议开场镜头
- 一键创建项目并跳转到工作流

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + React Router 6 + Vite 6 |
| 后端 | Node.js + Express |
| 桌面 | Electron 33 |
| 数据库 | sql.js（纯 JS/WASM SQLite，零编译问题） |
| 模块系统 | ESM（.mjs）+ CommonJS（.cjs）混合 |

## 📦 安装与运行

### 环境要求
- Node.js 18+（推荐 20+）
- npm 9+

### 安装依赖
```bash
npm install
```

### 方式一：Web 模式（推荐，最简单）
同时启动后端 API 和前端开发服务器：
```bash
npm run web
```
- 前端：http://localhost:5173
- 后端 API：http://localhost:3000

### 方式二：仅前端开发
```bash
npm run dev
```

### 方式三：Electron 桌面模式
```bash
npm run electron:dev
```

### 方式四：单独启动后端
```bash
node server.mjs
```

## 🚀 使用指南

1. **配置 LLM** — 进入「设置」页，填写你的 API 地址、密钥、模型名，点击测试连接
2. **创建项目** — 在首页点击「新建项目」，填写项目名称、概念、目标时长
3. **八步创作** — 进入「剧本创作」，按 Step 1 → Step 8 逐步生成，每步可自检、通过、回滚
4. **生成分镜** — 剧本完成后进入「分镜」，关联剧本任务，先分析再生成单元
5. **管理提示词** — 在「设置 → 提示词管理」查看和编辑所有提示词模板

## 📁 项目结构

```
zhuaernaosai/
├── electron/                  # 后端（Electron 主进程 + 业务逻辑）
│   ├── database/              # 数据库层（sql.js 适配 + 14 张表 CRUD）
│   │   ├── sqliteAdapter.mjs  # sql.js 适配器（模拟 better-sqlite3 同步 API）
│   │   ├── schema.mjs         # 表结构定义
│   │   ├── index.mjs          # 数据库初始化 + 统一导出
│   │   └── *.mjs              # 各业务表 CRUD
│   ├── prompts/
│   │   └── index.mjs          # 9 个提示词 Builder
│   ├── runtime/               # LLM 运行时
│   │   ├── serverLlmProxy.mjs # LLM 直连调用（OpenAI/Anthropic/Gemini）
│   │   ├── runtimeConfig.mjs  # 运行时配置解析
│   │   └── llmClient.mjs      # 连接测试
│   ├── services/              # 业务服务层
│   │   ├── screenplayService.mjs # 八步工作流主服务
│   │   └── screenplayStore.mjs   # 工作流数据持久化
│   ├── utils/                 # 工具函数
│   │   ├── screenplayStepParser.mjs # 八步产出解析器
│   │   ├── v5MarkdownParser.mjs     # V5 Markdown 解析器
│   │   └── durationSpec.mjs         # 时长规格
│   ├── electron-stub.mjs      # Electron 模块适配器（Web 模式 mock）
│   ├── main.cjs               # Electron 主进程入口
│   ├── preload.cjs            # 桥接层（暴露 window.zensApp）
│   └── ipc.cjs                # IPC 注册中心
├── src/                       # 前端（React + Vite）
│   ├── components/
│   │   └── Layout.jsx         # 左侧导航 + 右侧内容布局
│   ├── pages/
│   │   ├── Home.jsx           # 首页（项目列表）
│   │   ├── Screenplay.jsx     # 八步工作流页面
│   │   ├── Seedance.jsx       # V5 分镜页面
│   │   ├── Inspiration.jsx    # 灵感库页面
│   │   └── Settings.jsx       # 设置页面（模型 + 提示词管理）
│   ├── data/
│   │   └── inspirations.js    # 87 条灵感数据
│   ├── lib/
│   │   └── zensApp.js         # 前后端通信统一封装
│   ├── App.jsx                # 路由配置
│   ├── index.css              # 全局深色主题样式
│   └── main.jsx               # React 入口
├── public/
│   └── logo.png               # 应用 Logo
├── server.mjs                 # Web 模式后端服务器（Express）
├── server-electron.mjs        # Electron 模式后端服务器
├── vite.config.js             # Vite 配置
├── package.json
└── .gitignore
```

## 💾 数据存储

- **数据库**：`app-data/zens-data/zens.sqlite`（已加入 .gitignore，不会上传）
- **工作流数据**：`app-data/screenplay-projects/*.json`
- 数据库使用 sql.js（纯 JS/WASM），无需编译原生模块，跨平台无忧

## 🔧 开发说明

### 前后端通信
- **Electron 模式**：通过 `window.zensApp` 调用 IPC（`preload.cjs` 桥接）
- **Web 模式**：通过 `fetch` 调用 REST API（`/api/*`）
- `src/lib/zensApp.js` 统一封装两种模式，上层代码无感知

### 提示词修改
所有提示词在 `electron/prompts/index.mjs`，按 `contextType` 组织：
- `screenplay_step` / `screenplay_selfcheck` / `screenplay_checkpoint`
- `seedance_phase_ad` / `seedance_unit_efg` / `seedance_quick`
- `asset_extract` / `video_prompt` / `script_generation` / `script_review`

修改提示词后需重启服务器生效（Node.js 会缓存 import 的模块）。

### 构建生产版本
```bash
npm run build      # 构建前端
npm run electron:build  # 打包 Electron 应用
```

## 📜 许可证

[MIT License](./LICENSE) — 自由使用、修改、分发。

## 🙏 致谢

- [FloobyNooby](https://github.com/) — 分镜叙事方法论
- [sql.js](https://github.com/sql-js/sql.js) — 纯 JS SQLite 实现
- [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [Vite](https://vitejs.dev/)
