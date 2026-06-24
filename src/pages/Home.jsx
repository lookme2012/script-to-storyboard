import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { zensApp } from '../lib/zensApp'

/**
 * Home 首页
 *
 * 功能：
 * 1. 显示项目列表（卡片式）
 * 2. 创建新项目弹窗
 * 3. 点击项目跳转到八步工作流
 */

const DURATION_OPTIONS = [
  { value: '30', label: '30 秒' },
  { value: '60', label: '1 分钟' },
  { value: '120', label: '2 分钟' },
  { value: '180', label: '3 分钟' },
  { value: '300', label: '5 分钟' },
  { value: '480', label: '8 分钟' },
  { value: '600', label: '10 分钟' },
]

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const [projectName, setProjectName] = useState('')
  const [concept, setConcept] = useState('')
  const [duration, setDuration] = useState('180')
  const [filePath, setFilePath] = useState('')
  const [creating, setCreating] = useState(false)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await zensApp.screenplay.listRecentProjects(50)
      setProjects(Array.isArray(result) ? result : [])
    } catch (err) {
      setError('加载项目列表失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  /**
   * 创建新项目
   * 调用 screenplay.createProject，成功后跳转到工作流页面
   */
  const handleCreate = async () => {
    if (!concept.trim()) return
    setCreating(true)
    try {
      const project = await zensApp.screenplay.createProject({
        name: projectName.trim() || undefined,
        concept: concept.trim(),
        duration: parseInt(duration, 10),
        filePath: filePath || undefined,
      })
      setShowCreateModal(false)
      setProjectName('')
      setConcept('')
      setFilePath('')
      if (project?.projectId) {
        navigate(`/screenplay/${project.projectId}`)
      } else {
        loadProjects()
      }
    } catch (err) {
      setError('创建项目失败: ' + (err.message || err))
    } finally {
      setCreating(false)
    }
  }

  /**
   * 选择文件路径
   */
  const handleSelectFile = async () => {
    try {
      const result = await zensApp.selectTextFile()
      if (!result.cancelled && result.filePath) {
        setFilePath(result.filePath)
      }
    } catch (_) {}
  }

  /**
   * 删除项目
   */
  const handleDelete = async (e, projectId) => {
    e.stopPropagation()
    if (!confirm('确定要删除这个项目吗？此操作不可撤销！')) return
    try {
      await zensApp.screenplay.deleteProject(projectId)
      loadProjects()
    } catch (err) {
      setError('删除失败: ' + (err.message || err))
    }
  }

  const formatTime = (ts) => {
    if (!ts) return '-'
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const getStepLabel = (step) => {
    if (!step || step === 0) return '未开始'
    const labels = ['', '破题', '梗概', '人物', '背景', '结构', '场次', '写作', '医生']
    return `Step ${step}: ${labels[step] || ''}`
  }

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }} className="fade-in">
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
            <img src="/logo.png" alt="logo" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', verticalAlign: 'middle', marginRight: 8 }} />抓耳挠腮剧本制作
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 14 }}>
            从概念到剧本，八步搞定 ✨
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          ➕ 创建新项目
        </button>
      </div>

      {/* 错误提示 */}
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

      {/* 加载中 */}
      {loading && (
        <div className="empty-state">
          <div className="loading-spinner" style={{ width: 32, height: 32 }} />
          <p style={{ marginTop: 12 }}>加载项目中...</p>
        </div>
      )}

      {/* 空状态 */}
      {!loading && projects.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <p style={{ fontSize: 16, marginBottom: 8 }}>还没有项目</p>
          <p style={{ fontSize: 13 }}>点击右上角「创建新项目」开始你的第一个剧本 🚀</p>
        </div>
      )}

      {/* 项目列表 */}
      {!loading && projects.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {projects.map((proj) => (
            <div
              key={proj.projectId}
              className="card"
              style={{ cursor: 'pointer', position: 'relative' }}
              onClick={() => navigate(`/screenplay/${proj.projectId}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1, marginRight: 8 }}>
                  {proj.name || proj.concept || proj.projectName || '未命名项目'}
                </h3>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => handleDelete(e, proj.projectId)}
                  style={{ color: 'var(--error)', borderColor: 'transparent', padding: '2px 6px' }}
                >
                  🗑️
                </button>
              </div>

              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-accent">
                  {getStepLabel(proj.currentStep)}
                </span>
                {proj.duration && (
                  <span className="badge" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                    ⏱ {proj.duration}s
                  </span>
                )}
              </div>

              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                更新: {formatTime(proj.updatedAt || proj.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建项目弹窗 */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">🎬 创建新项目</div>

            <div className="form-group">
              <label className="form-label">项目名称</label>
              <input
                className="form-input"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="比如：仓鼠帝国、星际迷途..."
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">概念 / 主题 *</label>
              <textarea
                className="form-input"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="描述你想创作的剧本概念，比如：一个关于时间旅行的悬疑故事..."
                rows={4}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">目标时长</label>
              <select
                className="form-input"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                {DURATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">参考文件（可选）</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="选择或输入文件路径..."
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost" onClick={handleSelectFile}>
                  📂 选择
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !concept.trim()}
              >
                {creating ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 创建中...</> : '🚀 创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
