import React, { useState, useEffect, useCallback } from 'react'
import { zensApp } from '../lib/zensApp'

/**
 * Settings 设置页面
 *
 * 功能：
 * 1. 文字模型设置（API 地址/密钥/模型名/模式）
 * 2. 连接测试（显示延迟/成功/失败）
 * 3. 提示词模板管理（查看/编辑/新增/重置）
 * 4. 保存设置
 */

const MODE_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'gemini', label: 'Google Gemini' },
]

const CATEGORY_COLORS = {
  '剧本创作': '#6c5ce7',
  '分镜创作': '#00b894',
  '资产管理': '#fdcb6e',
  '视频生成': '#e17055',
  '自定义': '#74b9ff',
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('model')
  const [settings, setSettings] = useState({
    textEndpoint: '',
    textKey: '',
    textModel: '',
    textMode: 'openai',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await zensApp.getAppSettings()
      if (result) {
        setSettings({
          textEndpoint: result.textEndpoint || '',
          textKey: result.textKey || '',
          textModel: result.textModel || '',
          textMode: result.textMode || 'openai',
        })
      }
    } catch (err) {
      setError('加载设置失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await zensApp.saveAppSettings({
        textEndpoint: settings.textEndpoint,
        textKey: settings.textKey,
        textModel: settings.textModel,
        textMode: settings.textMode,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError('保存失败: ' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    const startTime = Date.now()
    try {
      const result = await zensApp.testConnection({
        apiBaseUrl: settings.textEndpoint,
        apiKey: settings.textKey,
        defaultModel: settings.textModel,
        textMode: settings.textMode,
      })
      const latency = Date.now() - startTime
      setTestResult({
        success: result?.success !== false,
        latency,
        message: result?.message || result?.error || '',
        model: result?.model || settings.textModel,
      })
    } catch (err) {
      const latency = Date.now() - startTime
      setTestResult({
        success: false,
        latency,
        message: err.message || '连接失败',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="loading-spinner" style={{ width: 32, height: 32 }} />
        <p style={{ marginTop: 12 }}>加载设置中...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }} className="fade-in">
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>
        ⚙️ 设置
      </h2>

      {error && (
        <div style={{
          background: 'var(--error-dim)',
          border: '1px solid var(--error)',
          borderRadius: 'var(--radius)',
          padding: '10px 16px',
          marginBottom: 16,
          color: 'var(--error)',
          fontSize: 13,
        }}>
          ⚠️ {error}
        </div>
      )}

      {saved && (
        <div style={{
          background: 'var(--success-dim)',
          border: '1px solid var(--success)',
          borderRadius: 'var(--radius)',
          padding: '10px 16px',
          marginBottom: 16,
          color: 'var(--success)',
          fontSize: 13,
        }}>
          ✅ 设置已保存
        </div>
      )}

      {/* Tab 切换 */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 24,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        padding: 4,
        border: '1px solid var(--border)',
      }}>
        {[
          { key: 'model', label: '🤖 模型设置' },
          { key: 'prompts', label: '📝 提示词管理' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 'calc(var(--radius) - 2px)',
              border: 'none',
              background: activeTab === tab.key ? 'var(--accent)' : 'transparent',
              color: activeTab === tab.key ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 模型设置 Tab */}
      {activeTab === 'model' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              🤖 文字模型设置
            </h3>

            <div className="form-group">
              <label className="form-label">API 模式</label>
              <select
                className="form-input"
                value={settings.textMode}
                onChange={(e) => handleChange('textMode', e.target.value)}
              >
                {MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                选择你的 LLM 提供商，不同模式使用不同的 API 格式
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">API 地址</label>
              <input
                className="form-input"
                type="text"
                value={settings.textEndpoint}
                onChange={(e) => handleChange('textEndpoint', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                LLM 服务的 Base URL，如使用代理请填写代理地址
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">API 密钥</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showKey ? 'text' : 'password'}
                  value={settings.textKey}
                  onChange={(e) => handleChange('textKey', e.target.value)}
                  placeholder="sk-..."
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    color: 'var(--text-secondary)',
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                  title={showKey ? '隐藏密钥' : '显示密钥'}
                >
                  {showKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                你的 API Key，将安全地存储在本地
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">默认模型</label>
              <input
                className="form-input"
                type="text"
                value={settings.textModel}
                onChange={(e) => handleChange('textModel', e.target.value)}
                placeholder="gpt-4o / claude-3-5-sonnet / gemini-pro"
              />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                生成剧本时使用的默认模型名称
              </p>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              🔌 连接测试
            </h3>

            <button
              className="btn btn-primary"
              onClick={handleTestConnection}
              disabled={testing || !settings.textEndpoint || !settings.textKey}
            >
              {testing ? (
                <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 测试中...</>
              ) : '🧪 测试连接'}
            </button>

            {testResult && (
              <div style={{
                marginTop: 16,
                padding: '14px 16px',
                borderRadius: 'var(--radius)',
                background: testResult.success ? 'var(--success-dim)' : 'var(--error-dim)',
                border: `1px solid ${testResult.success ? 'var(--success)' : 'var(--error)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{testResult.success ? '✅' : '❌'}</span>
                  <span style={{
                    fontWeight: 600,
                    color: testResult.success ? 'var(--success)' : 'var(--error)',
                  }}>
                    {testResult.success ? '连接成功' : '连接失败'}
                  </span>
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}>
                    ⏱ {testResult.latency}ms
                  </span>
                </div>
                {testResult.message && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    {testResult.message}
                  </p>
                )}
                {testResult.model && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    📎 模型: {testResult.model}
                  </p>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost" onClick={loadSettings}>
              🔄 重置
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 保存中...</> : '💾 保存设置'}
            </button>
          </div>
        </>
      )}

      {/* 提示词管理 Tab */}
      {activeTab === 'prompts' && (
        <PromptManager />
      )}

      {/* 环境信息 */}
      <div style={{
        marginTop: 32,
        padding: '16px',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text-secondary)',
      }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
          ℹ️ 环境信息
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px 12px' }}>
          <span>平台:</span><span>{zensApp.platform}</span>
          <span>Chrome:</span><span>{zensApp.versions.chrome}</span>
          <span>Electron:</span><span>{zensApp.versions.electron}</span>
          <span>Node:</span><span>{zensApp.versions.node}</span>
          <span>API:</span><span>{zensApp.hasApi ? '✅ 已连接' : '⚠️ 浏览器模式（无 Electron API）'}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * PromptManager 提示词管理器组件
 *
 * 📝 让用户可以查看、编辑、新增、重置提示词模板
 * - 左侧：模板列表（按分类分组）
 * - 右侧：编辑区域（systemPrompt + userPrompt）
 * - 支持：编辑内置模板 / 新增自定义模板 / 重置到默认 / 删除自定义
 */
function PromptManager() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({ label: '', systemPrompt: '', userPrompt: '' })
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newData, setNewData] = useState({ contextType: '', label: '', category: '自定义', systemPrompt: '', userPrompt: '' })

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const list = await zensApp.promptTemplate.list()
      setTemplates(Array.isArray(list) ? list : [])
      if (list.length > 0 && !selectedType) {
        setSelectedType(list[0].contextType)
      }
    } catch (err) {
      console.error('加载模板列表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedType])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (!selectedType) return
    setDetailLoading(true)
    setEditing(false)
    zensApp.promptTemplate.getDetail(selectedType)
      .then(d => {
        setDetail(d)
        setEditData({
          label: d.label || '',
          systemPrompt: d.systemPrompt || '',
          userPrompt: d.userPrompt || '',
        })
      })
      .catch(err => console.error('加载模板详情失败:', err))
      .finally(() => setDetailLoading(false))
  }, [selectedType])

  const handleSave = async () => {
    setSaving(true)
    try {
      await zensApp.promptTemplate.save({
        contextType: selectedType,
        label: editData.label,
        systemPrompt: editData.systemPrompt,
        userPrompt: editData.userPrompt,
      })
      setEditing(false)
      await loadTemplates()
      setDetail(prev => ({ ...prev, isCustom: true, isOverride: true, label: editData.label }))
    } catch (err) {
      console.error('保存失败:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    try {
      await zensApp.promptTemplate.reset(selectedType)
      await loadTemplates()
      const d = await zensApp.promptTemplate.getDetail(selectedType)
      setDetail(d)
      setEditData({
        label: d.label || '',
        systemPrompt: d.systemPrompt || '',
        userPrompt: d.userPrompt || '',
      })
      setEditing(false)
    } catch (err) {
      console.error('重置失败:', err)
    }
  }

  const handleDelete = async () => {
    try {
      await zensApp.promptTemplate.delete(selectedType)
      setSelectedType(null)
      setDetail(null)
      await loadTemplates()
    } catch (err) {
      console.error('删除失败:', err)
    }
  }

  const handleCreateNew = async () => {
    if (!newData.contextType || !newData.label) return
    setSaving(true)
    try {
      await zensApp.promptTemplate.save({
        contextType: newData.contextType,
        label: newData.label,
        category: newData.category || '自定义',
        description: newData.label,
        systemPrompt: newData.systemPrompt,
        userPrompt: newData.userPrompt,
      })
      setShowNewForm(false)
      setNewData({ contextType: '', label: '', category: '自定义', systemPrompt: '', userPrompt: '' })
      await loadTemplates()
      setSelectedType(newData.contextType)
    } catch (err) {
      console.error('创建失败:', err)
    } finally {
      setSaving(false)
    }
  }

  const categories = [...new Set(templates.map(t => t.category))]

  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <div className="loading-spinner" style={{ width: 28, height: 28 }} />
        <p style={{ marginTop: 12, fontSize: 13 }}>加载提示词模板...</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
      {/* 左侧：模板列表 */}
      <div style={{
        width: 280,
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>📋 模板列表</span>
          <button
            onClick={() => setShowNewForm(true)}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ➕ 新增
          </button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {categories.map(cat => (
            <div key={cat}>
              <div style={{
                padding: '8px 16px 4px',
                fontSize: 11,
                fontWeight: 600,
                color: CATEGORY_COLORS[cat] || 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {cat}
              </div>
              {templates
                .filter(t => t.category === cat)
                .map(t => (
                  <div
                    key={t.contextType}
                    onClick={() => setSelectedType(t.contextType)}
                    style={{
                      padding: '8px 16px',
                      cursor: 'pointer',
                      background: selectedType === t.contextType ? 'var(--accent-dim, rgba(99,102,241,0.1))' : 'transparent',
                      borderLeft: selectedType === t.contextType ? '3px solid var(--accent)' : '3px solid transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      fontSize: 13,
                      fontWeight: selectedType === t.contextType ? 600 : 400,
                      color: selectedType === t.contextType ? 'var(--accent)' : 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {t.label}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      marginTop: 2,
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                    }}>
                      <span style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: t.isCustom ? (t.isOverride ? 'rgba(253,203,110,0.2)' : 'rgba(116,185,255,0.2)') : 'rgba(255,255,255,0.05)',
                        color: t.isCustom ? (t.isOverride ? '#fdcb6e' : '#74b9ff') : 'var(--text-secondary)',
                      }}>
                        {t.isCustom ? (t.isOverride ? '已修改' : '自定义') : '内置'}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.contextType}
                      </span>
                    </div>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：编辑区 */}
      <div style={{
        flex: 1,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {detailLoading ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : detail ? (
          <>
            {/* 标题栏 */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {editing ? '✏️ 编辑：' : '📄 '}{detail.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {detail.contextType}
                  {detail.isCustom && (
                    <span style={{
                      marginLeft: 8,
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: detail.isOverride ? 'rgba(253,203,110,0.2)' : 'rgba(116,185,255,0.2)',
                      color: detail.isOverride ? '#fdcb6e' : '#74b9ff',
                      fontSize: 10,
                    }}>
                      {detail.isOverride ? '已自定义修改' : '自定义模板'}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!editing ? (
                  <>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '6px 14px' }}
                      onClick={() => setEditing(true)}
                    >
                      ✏️ 编辑
                    </button>
                    {detail.isOverride && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '6px 14px' }}
                        onClick={handleReset}
                      >
                        🔄 重置默认
                      </button>
                    )}
                    {detail.isCustom && !detail.isOverride && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '6px 14px', color: 'var(--error)' }}
                        onClick={handleDelete}
                      >
                        🗑️ 删除
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '6px 14px' }}
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? '保存中...' : '💾 保存'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '6px 14px' }}
                      onClick={() => {
                        setEditing(false)
                        setEditData({
                          label: detail.label || '',
                          systemPrompt: detail.systemPrompt || '',
                          userPrompt: detail.userPrompt || '',
                        })
                      }}
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 内容区 */}
            <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
              {editing ? (
                <>
                  <div className="form-group">
                    <label className="form-label">模板名称</label>
                    <input
                      className="form-input"
                      value={editData.label}
                      onChange={(e) => setEditData(prev => ({ ...prev, label: e.target.value }))}
                      placeholder="给模板起个名字"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      System Prompt（系统提示词）
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        告诉 AI "你是谁、怎么干"
                      </span>
                    </label>
                    <textarea
                      className="form-input"
                      value={editData.systemPrompt}
                      onChange={(e) => setEditData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                      placeholder="系统提示词：定义 AI 的角色、规则、约束..."
                      style={{
                        minHeight: 280,
                        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                        fontSize: 13,
                        lineHeight: 1.6,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      User Prompt（用户提示词模板）
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        告诉 AI "干啥、素材在这"，支持 {'{{变量名}}'} 占位符
                      </span>
                    </label>
                    <textarea
                      className="form-input"
                      value={editData.userPrompt}
                      onChange={(e) => setEditData(prev => ({ ...prev, userPrompt: e.target.value }))}
                      placeholder="用户提示词：具体任务 + 上下文数据...&#10;支持 {{变量名}} 占位符，如 {{scriptText}}、{{step}}"
                      style={{
                        minHeight: 200,
                        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                        fontSize: 13,
                        lineHeight: 1.6,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>
                      System Prompt（系统提示词）
                    </div>
                    <pre style={{
                      background: 'var(--bg-main, #1a1a2e)',
                      padding: 16,
                      borderRadius: 'var(--radius)',
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 300,
                      overflow: 'auto',
                      margin: 0,
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      border: '1px solid var(--border)',
                    }}>
                      {detail.systemPrompt || '（空）'}
                    </pre>
                  </div>
                  <div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>
                      User Prompt（用户提示词）
                    </div>
                    <pre style={{
                      background: 'var(--bg-main, #1a1a2e)',
                      padding: 16,
                      borderRadius: 'var(--radius)',
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 250,
                      overflow: 'auto',
                      margin: 0,
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      border: '1px solid var(--border)',
                    }}>
                      {detail.userPrompt || '（空）'}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-secondary)' }}>👈 从左侧选择一个模板查看</p>
          </div>
        )}
      </div>

      {/* 新增模板弹窗 */}
      {showNewForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 12,
            padding: 28,
            width: 600,
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>
              ➕ 新增提示词模板
            </h3>

            <div className="form-group">
              <label className="form-label">模板标识（contextType）</label>
              <input
                className="form-input"
                value={newData.contextType}
                onChange={(e) => setNewData(prev => ({ ...prev, contextType: e.target.value }))}
                placeholder="如 my_custom_prompt（英文，唯一标识）"
              />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                英文标识，用于系统内部引用，创建后不可修改
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">模板名称</label>
              <input
                className="form-input"
                value={newData.label}
                onChange={(e) => setNewData(prev => ({ ...prev, label: e.target.value }))}
                placeholder="如 我的自定义剧本生成"
              />
            </div>

            <div className="form-group">
              <label className="form-label">分类</label>
              <select
                className="form-input"
                value={newData.category}
                onChange={(e) => setNewData(prev => ({ ...prev, category: e.target.value }))}
              >
                <option value="自定义">自定义</option>
                <option value="剧本创作">剧本创作</option>
                <option value="分镜创作">分镜创作</option>
                <option value="资产管理">资产管理</option>
                <option value="视频生成">视频生成</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">System Prompt</label>
              <textarea
                className="form-input"
                value={newData.systemPrompt}
                onChange={(e) => setNewData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder="系统提示词：定义 AI 的角色、规则、约束..."
                style={{
                  minHeight: 150,
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: 'vertical',
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">User Prompt</label>
              <textarea
                className="form-input"
                value={newData.userPrompt}
                onChange={(e) => setNewData(prev => ({ ...prev, userPrompt: e.target.value }))}
                placeholder="用户提示词：具体任务 + 上下文数据...&#10;支持 {{变量名}} 占位符"
                style={{
                  minHeight: 120,
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowNewForm(false)
                  setNewData({ contextType: '', label: '', category: '自定义', systemPrompt: '', userPrompt: '' })
                }}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateNew}
                disabled={saving || !newData.contextType || !newData.label}
              >
                {saving ? '创建中...' : '✨ 创建模板'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
