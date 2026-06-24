/**
 * zensApp API 统一封装 🌉
 *
 * 这个模块是前后端通信的"万能适配器"：
 * - Electron 环境：用 window.zensApp（IPC 通信）
 * - 浏览器环境：用 fetch 调 REST API（/api/xxx）
 *
 * 不管你在哪种环境，调这些函数都不会炸 💣
 * 自动检测环境，走对应的通道，上层代码完全不用关心
 */

const _hasElectronApi = typeof window !== 'undefined' && !!window.zensApp

/**
 * REST API 基础地址
 * 浏览器模式下所有请求都走这个前缀
 */
const API_BASE = '/api'

/**
 * 通用 GET 请求封装
 * 📡 浏览器模式下用 fetch 发 GET 请求到后端
 *
 * @param {string} path - API 路径（如 /app/settings）
 * @param {*} fallback - 请求失败时的默认返回值
 * @returns {Function} 异步函数，调用后返回数据
 */
function _apiGet(path, fallback = null) {
  return async (...args) => {
    try {
      let url = `${API_BASE}${path}`
      // 如果第一个参数是路径参数（如 taskId），替换到 URL 里
      if (args.length > 0 && typeof args[0] === 'string') {
        // 对于带 :param 的路径，用参数替换
        if (url.includes(':')) {
          for (const arg of args) {
            url = url.replace(/:[^/]+/, encodeURIComponent(arg))
          }
        } else {
          // 否则作为 query string
          url += `/${encodeURIComponent(args[0])}`
        }
      }
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      console.error(`[API] GET ${path} 失败:`, err)
      throw err
    }
  }
}

/**
 * 通用 POST 请求封装
 * 📤 浏览器模式下用 fetch 发 POST 请求到后端
 *
 * @param {string} path - API 路径
 * @param {*} fallback - 请求失败时的默认返回值
 * @returns {Function} 异步函数，传入 body 数据
 */
function _apiPost(path, fallback = null) {
  return async (body) => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      console.error(`[API] POST ${path} 失败:`, err)
      throw err
    }
  }
}

/**
 * 通用 DELETE 请求封装
 * 🗑️ 浏览器模式下用 fetch 发 DELETE 请求
 *
 * @param {string} path - API 路径
 * @returns {Function} 异步函数
 */
function _apiDelete(path) {
  return async (id) => {
    try {
      let url = `${API_BASE}${path}`
      if (typeof id === 'string') {
        if (url.includes(':')) {
          url = url.replace(/:[^/]+/, encodeURIComponent(id))
        } else {
          url += `/${encodeURIComponent(id)}`
        }
      }
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      console.error(`[API] DELETE ${path} 失败:`, err)
      throw err
    }
  }
}

/**
 * SSE 流式请求封装
 * 🌊 浏览器模式下用 fetch + ReadableStream 接收 SSE，逐 chunk 回调
 *
 * 服务端发送格式：
 *   data: {"type":"chunk","chunk":"你好"}
 *   data: {"type":"done","result":{...}}
 *   data: {"type":"error","error":"错误信息"}
 *
 * @param {string} path - API 路径
 * @returns {Function} 异步函数，传入 (body, onChunk?) 调用
 */
function _apiSSE(path) {
  return async (body, onChunk) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') || ''

    if (contentType.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'chunk' && onChunk) {
              onChunk(parsed.chunk)
            } else if (parsed.type === 'done') {
              finalResult = parsed.result
            } else if (parsed.type === 'error') {
              throw new Error(parsed.error)
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              console.warn('[SSE] 跳过格式异常的数据行:', trimmed.slice(0, 80))
            } else {
              throw e
            }
          }
        }
      }

      return finalResult
    }

    return await res.json()
  }
}

/**
 * 流式事件监听器（浏览器模式下的空实现）
 * Web 版暂不支持实时流式推送，返回空 unsubscribe
 */
function _webListener(eventName) {
  return (callback) => {
    console.log(`[API] 流式监听 ${eventName} 已注册（Web 模式暂不支持实时推送）`)
    return () => {}
  }
}

/**
 * Electron IPC 调用封装
 * 🖥️ 有 window.zensApp 时走 IPC，否则走 REST API
 */
function _wrap(fn, fallbackValue = null) {
  if (!fn) return async () => fallbackValue
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      console.error('[zensApp] 调用失败:', err)
      throw err
    }
  }
}

function _wrapListener(registerFn) {
  if (!registerFn) return () => () => {}
  return (callback) => {
    try {
      return registerFn(callback) || (() => {})
    } catch (err) {
      console.error('[zensApp] 监听注册失败:', err)
      return () => {}
    }
  }
}

const electronApi = _hasElectronApi ? window.zensApp : null

// ═══════════════════════════════════════════════════════════════
//  构建 zensApp 对象：Electron 走 IPC，浏览器走 fetch
// ═══════════════════════════════════════════════════════════════

export const zensApp = {
  hasApi: _hasElectronApi,

  platform: electronApi?.platform || 'web',
  versions: electronApi?.versions || { chrome: '-', electron: '-', node: '-' },

  getAppVersion: _hasElectronApi
    ? _wrap(electronApi.getAppVersion, '1.0.0-web')
    : _apiGet('/app/version', '1.0.0-web'),

  getDatabaseMeta: _hasElectronApi
    ? _wrap(electronApi.getDatabaseMeta, {})
    : _apiGet('/app/database-meta', {}),

  getAppSettings: _hasElectronApi
    ? _wrap(electronApi.getAppSettings, {})
    : _apiGet('/app/settings', {}),

  saveAppSettings: _hasElectronApi
    ? _wrap(electronApi.saveAppSettings, {})
    : _apiPost('/app/settings', {}),

  testConnection: _hasElectronApi
    ? _wrap(electronApi.testConnection, { success: false, message: '无法测试连接' })
    : _apiPost('/app/test-connection', { success: false, message: '无法测试连接' }),

  getProjects: _hasElectronApi
    ? _wrap(electronApi.getProjects, [])
    : _apiGet('/project/all', []),

  renameProject: _hasElectronApi
    ? _wrap(electronApi.renameProject, {})
    : _apiPost('/project/rename', {}),

  deleteProject: _hasElectronApi
    ? _wrap(electronApi.deleteProject, {})
    : async (projectId) => {
        if (_hasElectronApi) return electronApi.deleteProject(projectId)
        const res = await fetch(`${API_BASE}/project/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
        return res.json()
      },

  selectTextFile: _hasElectronApi
    ? _wrap(electronApi.selectTextFile, { cancelled: true })
    : async () => {
        // Web 版：用 <input type="file"> 让用户选文件
        return new Promise((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.txt,.md,.json,.csv'
          input.onchange = async () => {
            const file = input.files[0]
            if (!file) return resolve({ cancelled: true })
            const content = await file.text()
            resolve({ path: file.name, content })
          }
          input.click()
        })
      },

  selectImageFile: _hasElectronApi
    ? _wrap(electronApi.selectImageFile, { cancelled: true })
    : async () => {
        return new Promise((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = async () => {
            const file = input.files[0]
            if (!file) return resolve({ cancelled: true })
            const reader = new FileReader()
            reader.onload = () => {
              const base64 = reader.result.split(',')[1]
              resolve({ path: file.name, base64, mimeType: file.type })
            }
            reader.readAsDataURL(file)
          }
          input.click()
        })
      },

  setAuthToken: _hasElectronApi
    ? _wrap(electronApi.setAuthToken, {})
    : _apiPost('/auth/set-token', {}),

  onSessionExpired: _hasElectronApi
    ? _wrapListener(electronApi.onSessionExpired)
    : _webListener('auth:session-expired'),

  runAssetExtraction: _hasElectronApi
    ? _wrap(electronApi.runAssetExtraction, {})
    : _apiSSE('/asset/extract'),

  getAssetsByTask: _hasElectronApi
    ? _wrap(electronApi.getAssetsByTask, [])
    : async (taskId) => {
        if (_hasElectronApi) return electronApi.getAssetsByTask(taskId)
        const res = await fetch(`${API_BASE}/asset/by-task/${encodeURIComponent(taskId)}`)
        return res.json()
      },

  getAssetScan: _hasElectronApi
    ? _wrap(electronApi.getAssetScan, {})
    : async (taskId) => {
        if (_hasElectronApi) return electronApi.getAssetScan(taskId)
        const res = await fetch(`${API_BASE}/asset/scan/${encodeURIComponent(taskId)}`)
        return res.json()
      },

  updateAsset: _hasElectronApi
    ? _wrap(electronApi.updateAsset, {})
    : _apiPost('/asset/update', {}),

  onAssetExtractProgress: _hasElectronApi
    ? _wrapListener(electronApi.onAssetExtractProgress)
    : _webListener('asset:extract-progress'),

  generateVideoPrompt: _hasElectronApi
    ? _wrap(electronApi.generateVideoPrompt, {})
    : _apiSSE('/prompt/generate-video-prompt'),

  onVideoPromptChunk: _hasElectronApi
    ? _wrapListener(electronApi.onVideoPromptChunk)
    : _webListener('prompt:video-prompt-chunk'),

  promptTemplate: {
    list: _hasElectronApi
      ? _wrap(electronApi.promptTemplate?.list, [])
      : _apiGet('/prompt-template/list', []),

    getDetail: _hasElectronApi
      ? _wrap(electronApi.promptTemplate?.getDetail, {})
      : async (contextType) => {
          if (_hasElectronApi) return electronApi.promptTemplate.getDetail(contextType)
          const res = await fetch(`${API_BASE}/prompt-template/detail/${encodeURIComponent(contextType)}`)
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `HTTP ${res.status}`)
          }
          return res.json()
        },

    save: _hasElectronApi
      ? _wrap(electronApi.promptTemplate?.save, {})
      : _apiPost('/prompt-template/save', {}),

    delete: _hasElectronApi
      ? _wrap(electronApi.promptTemplate?.delete, {})
      : async (contextType) => {
          if (_hasElectronApi) return electronApi.promptTemplate.delete(contextType)
          const res = await fetch(`${API_BASE}/prompt-template/${encodeURIComponent(contextType)}`, { method: 'DELETE' })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `HTTP ${res.status}`)
          }
          return res.json()
        },

    reset: _hasElectronApi
      ? _wrap(electronApi.promptTemplate?.reset, {})
      : async (contextType) => {
          if (_hasElectronApi) return electronApi.promptTemplate.reset(contextType)
          const res = await fetch(`${API_BASE}/prompt-template/reset/${encodeURIComponent(contextType)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `HTTP ${res.status}`)
          }
          return res.json()
        },
  },

  screenplay: {
    skillStatus: _hasElectronApi
      ? _wrap(electronApi.screenplay?.skillStatus, {})
      : _apiGet('/screenplay/skill-status', {}),

    createProject: _hasElectronApi
      ? _wrap(electronApi.screenplay?.createProject, {})
      : _apiPost('/screenplay/create-project', {}),

    getProject: _hasElectronApi
      ? _wrap(electronApi.screenplay?.getProject, {})
      : async (projectId) => {
          if (_hasElectronApi) return electronApi.screenplay.getProject(projectId)
          const res = await fetch(`${API_BASE}/screenplay/project/${encodeURIComponent(projectId)}`)
          return res.json()
        },

    listRecentProjects: _hasElectronApi
      ? _wrap(electronApi.screenplay?.listRecentProjects, [])
      : async (limit) => {
          if (_hasElectronApi) return electronApi.screenplay.listRecentProjects(limit)
          const res = await fetch(`${API_BASE}/screenplay/recent-projects?limit=${limit || 20}`)
          return res.json()
        },

    deleteProject: _hasElectronApi
      ? _wrap(electronApi.screenplay?.deleteProject, {})
      : async (projectId) => {
          if (_hasElectronApi) return electronApi.screenplay.deleteProject(projectId)
          const res = await fetch(`${API_BASE}/screenplay/project/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
          return res.json()
        },

    updateStepStructured: _hasElectronApi
      ? _wrap(electronApi.screenplay?.updateStepStructured, {})
      : _apiPost('/screenplay/update-step-structured', {}),

    renameProject: _hasElectronApi
      ? _wrap(electronApi.screenplay?.renameProject, {})
      : _apiPost('/screenplay/rename-project', {}),

    updateDuration: _hasElectronApi
      ? _wrap(electronApi.screenplay?.updateDuration, {})
      : _apiPost('/screenplay/update-duration', {}),

    finalizeToScriptTask: _hasElectronApi
      ? _wrap(electronApi.screenplay?.finalizeToScriptTask, {})
      : _apiPost('/screenplay/finalize-to-script-task', {}),

    generateStep: _hasElectronApi
      ? _wrap(electronApi.screenplay?.generateStep, {})
      : _apiSSE('/screenplay/generate-step'),

    selfcheckStep: _hasElectronApi
      ? _wrap(electronApi.screenplay?.selfcheckStep, {})
      : _apiSSE('/screenplay/selfcheck-step'),

    getCachedSelfcheck: _hasElectronApi
      ? _wrap(electronApi.screenplay?.getCachedSelfcheck, {})
      : async (projectId, stepNumber) => {
          if (_hasElectronApi) return electronApi.screenplay.getCachedSelfcheck(projectId, stepNumber)
          const res = await fetch(`${API_BASE}/screenplay/cached-selfcheck?projectId=${encodeURIComponent(projectId)}&stepNumber=${stepNumber}`)
          return res.json()
        },

    approveStep: _hasElectronApi
      ? _wrap(electronApi.screenplay?.approveStep, {})
      : _apiPost('/screenplay/approve-step', {}),

    rollbackTo: _hasElectronApi
      ? _wrap(electronApi.screenplay?.rollbackTo, {})
      : _apiPost('/screenplay/rollback-to', {}),

    listVersions: _hasElectronApi
      ? _wrap(electronApi.screenplay?.listVersions, [])
      : async (projectId, stepNumber) => {
          if (_hasElectronApi) return electronApi.screenplay.listVersions(projectId, stepNumber)
          const res = await fetch(`${API_BASE}/screenplay/versions?projectId=${encodeURIComponent(projectId)}&stepNumber=${stepNumber}`)
          return res.json()
        },

    restoreVersion: _hasElectronApi
      ? _wrap(electronApi.screenplay?.restoreVersion, {})
      : _apiPost('/screenplay/restore-version', {}),

    setStepSelection: _hasElectronApi
      ? _wrap(electronApi.screenplay?.setStepSelection, {})
      : _apiPost('/screenplay/set-step-selection', {}),

    getCheckpoint: _hasElectronApi
      ? _wrap(electronApi.screenplay?.getCheckpoint, {})
      : async (projectId, trigger) => {
          if (_hasElectronApi) return electronApi.screenplay.getCheckpoint(projectId, trigger)
          const res = await fetch(`${API_BASE}/screenplay/checkpoint?projectId=${encodeURIComponent(projectId)}&trigger=${encodeURIComponent(trigger || '')}`)
          return res.json()
        },

    regenerateCheckpoint: _hasElectronApi
      ? _wrap(electronApi.screenplay?.regenerateCheckpoint, {})
      : _apiPost('/screenplay/regenerate-checkpoint', {}),

    onStreamChunk: _hasElectronApi
      ? _wrapListener(electronApi.screenplay?.onStreamChunk)
      : _webListener('screenplay:stream-chunk'),
  },

  seedance: {
    runPhaseAD: _hasElectronApi
      ? _wrap(electronApi.seedance?.runPhaseAD, {})
      : _apiSSE('/seedance/run-phase-ad'),

    quickStoryboard: _hasElectronApi
      ? _wrap(electronApi.seedance?.quickStoryboard, {})
      : _apiSSE('/seedance/quick-storyboard'),

    getAnalysis: _hasElectronApi
      ? _wrap(electronApi.seedance?.getAnalysis, {})
      : async (arg) => {
          const taskId = (arg && typeof arg === 'object') ? (arg.taskId || arg.id) : arg
          const res = await fetch(`${API_BASE}/seedance/analysis/${encodeURIComponent(taskId)}`)
          return res.json()
        },

    runUnit: _hasElectronApi
      ? _wrap(electronApi.seedance?.runUnit, {})
      : _apiPost('/seedance/run-unit', {}),

    runAll: _hasElectronApi
      ? _wrap(electronApi.seedance?.runAll, {})
      : _apiPost('/seedance/run-all', {}),

    listUnits: _hasElectronApi
      ? _wrap(electronApi.seedance?.listUnits, [])
      : async (arg) => {
          const taskId = (arg && typeof arg === 'object') ? (arg.taskId || arg.id) : arg
          const res = await fetch(`${API_BASE}/seedance/units/${encodeURIComponent(taskId)}`)
          return res.json()
        },

    getUnit: _hasElectronApi
      ? _wrap(electronApi.seedance?.getUnit, {})
      : async (arg1, unitIndex) => {
          const taskId = (arg1 && typeof arg1 === 'object') ? (arg1.taskId || arg1.id) : arg1
          const res = await fetch(`${API_BASE}/seedance/unit/${encodeURIComponent(taskId)}/${unitIndex}`)
          return res.json()
        },

    checkFreshness: _hasElectronApi
      ? _wrap(electronApi.seedance?.checkFreshness, {})
      : async (arg) => {
          const taskId = (arg && typeof arg === 'object') ? (arg.taskId || arg.id) : arg
          const res = await fetch(`${API_BASE}/seedance/check-freshness/${encodeURIComponent(taskId)}`)
          return res.json()
        },

    deleteAnalysis: _hasElectronApi
      ? _wrap(electronApi.seedance?.deleteAnalysis, {})
      : async (arg) => {
          const taskId = (arg && typeof arg === 'object') ? (arg.taskId || arg.id) : arg
          const res = await fetch(`${API_BASE}/seedance/analysis/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
          return res.json()
        },

    onProgress: _hasElectronApi
      ? _wrapListener(electronApi.seedance?.onProgress)
      : _webListener('seedance:run-all-progress'),

    onAnalysisChunk: _hasElectronApi
      ? _wrapListener(electronApi.seedance?.onAnalysisChunk)
      : _webListener('seedance:analysis-chunk'),

    onUnitChunk: _hasElectronApi
      ? _wrapListener(electronApi.seedance?.onUnitChunk)
      : _webListener('seedance:unit-chunk'),

    /**
     * 🎯 FloobyNooby Steps 5-9 精炼
     * 粗缩略图→Animatic审查→结构修订→镜头语言精炼→二轮缩略图
     */
    refine: _apiSSE('/seedance/refine'),

    /**
     * 🔑 FloobyNooby Steps 10-12 关键面板+逐镜板
     * 锁定关键面板→粗动画计划→关键场次逐镜板
     */
    keyPanels: _apiSSE('/seedance/key-panels'),

    /**
     * 📬 FloobyNooby Steps 13-15 最终交付
     * 全片粗板包→清洁规则→最终交付
     */
    final: _apiSSE('/seedance/final'),
  },
}

export default zensApp
