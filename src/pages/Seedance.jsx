import React, { useState, useEffect, useCallback, useRef } from 'react'
import { zensApp } from '../lib/zensApp'

/**
 * Seedance V5 分镜页面
 *
 * 把剧本变成分镜的流程：
 * - Phase A-D: 分析阶段（段号索引 + 结构 + 情绪地图 + 单元分配）
 * - Phase E-F-G: 单元生成（COPY区 + NOTE区 + 自检）
 *
 * 支持并行生成，默认1路，最大12路
 */

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 6, 8, 12]

const UNIT_STATUS_MAP = {
  pending: { label: '待生成', color: 'var(--text-secondary)', bg: 'var(--bg-primary)', icon: '⏳' },
  generating: { label: '生成中', color: 'var(--accent)', bg: 'var(--accent-dim)', icon: '⚡' },
  generated: { label: '已生成', color: 'var(--success)', bg: 'var(--success-dim)', icon: '✅' },
  done: { label: '已生成', color: 'var(--success)', bg: 'var(--success-dim)', icon: '✅' },
  failed: { label: '失败', color: 'var(--error)', bg: 'var(--error-dim)', icon: '❌' },
  selfchecked: { label: '已自检', color: 'var(--warning)', bg: 'var(--warning-dim)', icon: '🔍' },
}

export default function Seedance() {
  const [tasks, setTasks] = useState([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [analysis, setAnalysis] = useState(null)
  const [units, setUnits] = useState([])
  const [concurrency, setConcurrency] = useState(1)

  const [analyzing, setAnalyzing] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [progress, setProgress] = useState(null)
  const [analysisStream, setAnalysisStream] = useState('')
  const [showUnitHint, setShowUnitHint] = useState(true)

  // 🚀 快速分镜模式
  const [quickMode, setQuickMode] = useState(false)
  const [quickConcept, setQuickConcept] = useState('')
  const [quickDescription, setQuickDescription] = useState('')
  const [quickDuration, setQuickDuration] = useState('180')
  const [quickGenre, setQuickGenre] = useState('')

  // 🎬 FloobyNooby 15步流水线状态
  const [refineLoading, setRefineLoading] = useState(false)
  const [refineResult, setRefineResult] = useState(null)
  const [refineStream, setRefineStream] = useState('')
  const [keyPanelsLoading, setKeyPanelsLoading] = useState(false)
  const [keyPanelsResult, setKeyPanelsResult] = useState(null)
  const [keyPanelsStream, setKeyPanelsStream] = useState('')
  const [finalLoading, setFinalLoading] = useState(false)
  const [finalResult, setFinalResult] = useState(null)
  const [finalStream, setFinalStream] = useState('')

  const progressCleanup = useRef(null)
  const analysisChunkCleanup = useRef(null)
  const unitChunkCleanup = useRef(null)

  /**
   * 加载剧本任务列表
   * 📋 从 projects 表获取数据，每个 project 只取最新的那个 script_task（避免一个项目显示多次）
   */
  const loadTasks = useCallback(async () => {
    try {
      const result = await zensApp.getProjects()
      const projectList = Array.isArray(result) ? result : []
      const scriptTasks = []
      for (const proj of projectList) {
        const tasks = proj.tasks || []
        const scriptOnly = tasks
          .filter(t => t.moduleType === 'script')
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        if (scriptOnly.length > 0) {
          const latest = scriptOnly[0]
          scriptTasks.push({
            taskId: latest.taskId,
            projectName: proj.projectName || proj.name || '未命名',
            stage: latest.stage,
            reviewScore: latest.reviewScore,
          })
        }
      }
      setTasks(scriptTasks)
      if (scriptTasks.length > 0 && !selectedTaskId) {
        setSelectedTaskId(scriptTasks[0].taskId)
      }
    } catch (_) {}
  }, [selectedTaskId])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  /**
   * 注册进度监听
   */
  useEffect(() => {
    const cleanup1 = zensApp.seedance.onProgress((p) => {
      setProgress(p)
      if (p?.done) {
        setGeneratingAll(false)
      }
    })
    const cleanup2 = zensApp.seedance.onAnalysisChunk((p) => {
      if (p?.chunk) {
        setAnalysisStream(prev => prev + p.chunk)
      }
      if (p?.done) {
        setAnalyzing(false)
      }
    })
    const cleanup3 = zensApp.seedance.onUnitChunk((p) => {
      if (p?.unitIndex !== undefined) {
        setUnits(prev => prev.map(u =>
          u.unitIndex === p.unitIndex
            ? { ...u, status: 'generating', streamText: (u.streamText || '') + (p.chunk || '') }
            : u
        ))
      }
    })
    progressCleanup.current = cleanup1
    analysisChunkCleanup.current = cleanup2
    unitChunkCleanup.current = cleanup3
    return () => {
      progressCleanup.current?.()
      analysisChunkCleanup.current?.()
      unitChunkCleanup.current?.()
    }
  }, [])

  /**
   * 运行 Phase A-D 分析
   * 🌊 Web 模式下通过 SSE 流式接收 LLM 输出
   */
  const handleAnalyze = async () => {
    if (!selectedTaskId || analyzing) return
    setAnalyzing(true)
    setAnalysisStream('')
    setError(null)
    setAnalysis(null)
    try {
      const result = await zensApp.seedance.runPhaseAD(
        { taskId: selectedTaskId },
        (chunk) => {
          setAnalysisStream(prev => prev + chunk)
        }
      )
      setAnalysis(result)
      // 更新 selectedTaskId 以确保后续加载分析用正确的 ID
      if (result?.taskId) setSelectedTaskId(result.taskId)
    } catch (err) {
      setError('分析失败: ' + (err.message || err))
    } finally {
      setAnalyzing(false)
    }
  }

  /**
   * 🚀 快速分镜：从概念直接生成完整分镜方案
   * 跳过八步工作流，一个按钮直达分镜分析
   */
  const handleQuickStoryboard = async () => {
    if (!quickConcept.trim() || analyzing) return
    setAnalyzing(true)
    setAnalysisStream('')
    setError(null)
    setAnalysis(null)
    setSelectedTaskId('')
    setQuickMode(false)
    try {
      const result = await zensApp.seedance.quickStoryboard(
        {
          concept: quickConcept.trim(),
          description: quickDescription.trim(),
          duration: `${quickDuration}秒`,
          genre: quickGenre.trim(),
        },
        (chunk) => {
          setAnalysisStream(prev => prev + chunk)
        }
      )
      setAnalysis(result.analysis || result)
      // 保存 taskId 以便后续生成单元
      if (result?.taskId) {
        setSelectedTaskId(result.taskId)
      }
      // 清空表单
      setQuickConcept('')
      setQuickDescription('')
      setQuickGenre('')
    } catch (err) {
      setError('快速分镜失败: ' + (err.message || err))
    } finally {
      setAnalyzing(false)
    }
  }

  /**
   * 加载已有分析结果
   */
  const handleLoadAnalysis = async () => {
    if (!selectedTaskId) return
    setLoading(true)
    try {
      const result = await zensApp.seedance.getAnalysis({ taskId: selectedTaskId })
      setAnalysis(result)
      const unitList = await zensApp.seedance.listUnits({ taskId: selectedTaskId })
      setUnits(Array.isArray(unitList) ? unitList : [])
    } catch (err) {
      setError('加载失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }

  /**
   * 生成全部单元
   */
  const handleGenerateAll = async () => {
    if (!selectedTaskId || generatingAll) return
    setGeneratingAll(true)
    setProgress(null)
    setError(null)
    try {
      await zensApp.seedance.runAll({
        taskId: selectedTaskId,
        concurrency,
      })
      const unitList = await zensApp.seedance.listUnits({ taskId: selectedTaskId })
      setUnits(Array.isArray(unitList) ? unitList : [])
    } catch (err) {
      setError('生成失败: ' + (err.message || err))
    } finally {
      setGeneratingAll(false)
    }
  }

  /**
   * 生成单个单元
   */
  const handleGenerateUnit = async (unitIndex) => {
    setError(null)
    try {
      await zensApp.seedance.runUnit({ taskId: selectedTaskId, unitIndex })
      const unitList = await zensApp.seedance.listUnits({ taskId: selectedTaskId })
      setUnits(Array.isArray(unitList) ? unitList : [])
    } catch (err) {
      setError('单元生成失败: ' + (err.message || err))
    }
  }

  /**
   * 删除当前任务的全部分析数据
   * 🗑️ 清除 Phase A-D 分析结果 + Phase E-F-G 单元数据
   */
  const handleDeleteAnalysis = async () => {
    if (!selectedTaskId) return
    if (!window.confirm('确定要删除当前任务的全部 V5 分镜数据吗？\n\n包括：Phase A-D 分析结果 + 所有已生成的分镜单元\n\n删除后需要重新运行分析和生成。')) return
    setLoading(true)
    setError(null)
    try {
      await zensApp.seedance.deleteAnalysis({ taskId: selectedTaskId })
      setAnalysis(null)
      setUnits([])
      setAnalysisStream('')
    } catch (err) {
      setError('删除失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }

  /**
   * 🎯 FloobyNooby Steps 5-9 精炼
   * 将分析结果传给 LLM 做深度精炼：粗缩略图→Animatic审查→结构修订→镜头语言精炼→二轮缩略图
   */
  const handleRefine = async () => {
    if (!analysis || refineLoading) return
    setRefineLoading(true)
    setRefineStream('')
    setRefineResult(null)
    setError(null)
    setKeyPanelsResult(null)
    setFinalResult(null)
    try {
      const result = await zensApp.seedance.refine(
        { analysis },
        (chunk) => { setRefineStream(prev => prev + chunk) }
      )
      setRefineResult(result)
    } catch (err) {
      setError('精炼失败: ' + (err.message || err))
    } finally {
      setRefineLoading(false)
    }
  }

  /**
   * 🔑 FloobyNooby Steps 10-12 关键面板+逐镜板
   * 锁定关键面板→粗动画计划→关键场次逐镜板
   */
  const handleKeyPanels = async () => {
    if (!analysis || keyPanelsLoading) return
    setKeyPanelsLoading(true)
    setKeyPanelsStream('')
    setKeyPanelsResult(null)
    setError(null)
    setFinalResult(null)
    try {
      const result = await zensApp.seedance.keyPanels(
        { analysis },
        (chunk) => { setKeyPanelsStream(prev => prev + chunk) }
      )
      setKeyPanelsResult(result)
    } catch (err) {
      setError('关键面板生成失败: ' + (err.message || err))
    } finally {
      setKeyPanelsLoading(false)
    }
  }

  /**
   * 📬 FloobyNooby Steps 13-15 最终交付
   * 全片粗板包→清洁规则→最终交付
   */
  const handleFinal = async () => {
    if (!analysis || finalLoading) return
    setFinalLoading(true)
    setFinalStream('')
    setFinalResult(null)
    setError(null)
    try {
      const result = await zensApp.seedance.final(
        { analysis },
        (chunk) => { setFinalStream(prev => prev + chunk) }
      )
      setFinalResult(result)
    } catch (err) {
      setError('最终交付生成失败: ' + (err.message || err))
    } finally {
      setFinalLoading(false)
    }
  }

  /**
   * 当选择任务变化时，自动加载分析
   */
  useEffect(() => {
    if (selectedTaskId) {
      handleLoadAnalysis()
    }
  }, [selectedTaskId])

  const completedCount = units.filter(u => u.status === 'generated' || u.status === 'selfchecked').length
  const totalCount = units.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }} className="fade-in">
      {/* 顶部：任务选择 + 操作按钮 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
          🎞️ 分镜
        </h2>

        {/* 🚀 快速模式切换 */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <button
            className={`btn ${!quickMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setQuickMode(false); setError(null) }}
            style={{ fontSize: 13 }}
          >
            📋 标准模式
          </button>
          <button
            className={`btn ${quickMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setQuickMode(true); setError(null) }}
            style={{ fontSize: 13 }}
          >
            🚀 快速模式
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
            {quickMode ? '输入主题+描述，一键生成完整分镜' : '从八步工作流导入剧本，逐单元生成分镜'}
          </span>
        </div>

        {/* 快速模式：概念输入表单 */}
        {quickMode && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(59,130,246,0.08) 100%)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)',
            padding: '20px 24px',
            marginBottom: 16,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  🎬 项目主题 <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="例如：一个程序员发现他的代码正在改变现实世界..."
                  value={quickConcept}
                  onChange={(e) => setQuickConcept(e.target.value)}
                  style={{ width: '100%' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && quickConcept.trim()) handleQuickStoryboard()
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  🎭 题材/类型
                </label>
                <input
                  className="form-input"
                  placeholder="例如：科幻、悬疑、爱情、喜剧..."
                  value={quickGenre}
                  onChange={(e) => setQuickGenre(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                📝 详细描述（你想拍什么？人物、情节、风格、氛围...）
              </label>
              <textarea
                className="form-input"
                placeholder="例如：主角叫陈远，曾是NASA天体物理学家，因一场失败的火星任务被送进精神病院。他坚信自己的计算没错，在病房的床单上演算轨道..."
                value={quickDescription}
                onChange={(e) => setQuickDescription(e.target.value)}
                style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  ⏱ 目标时长
                </label>
                <select
                  className="form-input"
                  value={quickDuration}
                  onChange={(e) => setQuickDuration(e.target.value)}
                  style={{ width: 130 }}
                >
                  <option value="30">30 秒</option>
                  <option value="60">1 分钟</option>
                  <option value="120">2 分钟</option>
                  <option value="180">3 分钟</option>
                  <option value="300">5 分钟</option>
                  <option value="480">8 分钟</option>
                  <option value="600">10 分钟</option>
                </select>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleQuickStoryboard}
                disabled={!quickConcept.trim() || analyzing}
                style={{ alignSelf: 'flex-end', fontSize: 15, padding: '10px 28px' }}
              >
                {analyzing ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 生成中...</> : '🚀 一键生成分镜'}
              </button>
            </div>
          </div>
        )}

        {/* 标准模式：任务选择 */}
        {!quickMode && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            style={{ minWidth: 240 }}
          >
            <option value="">选择关联的剧本任务...</option>
            {tasks.map(t => (
              <option key={t.taskId} value={t.taskId}>
                {t.projectName} {t.stage ? `(${t.stage})` : ''}
              </option>
            ))}
          </select>

          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={!selectedTaskId || analyzing}
          >
            {analyzing ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 分析中...</> : '🔬 分析'}
          </button>

          <button className="btn btn-ghost" onClick={handleLoadAnalysis} disabled={!selectedTaskId}>
            📂 加载已有
          </button>

          <button
            className="btn btn-ghost"
            onClick={handleDeleteAnalysis}
            disabled={!selectedTaskId}
            style={{ color: 'var(--error)' }}
          >
            🗑️ 删除
          </button>
        </div>
        )}
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

      {/* 分析流式输出 */}
      {analyzing && analysisStream && (
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 14, marginBottom: 8, color: 'var(--accent)' }}>📡 分析流式输出</h4>
          <div className="stream-output">
            {analysisStream}
            <span style={{ animation: 'blink 1s infinite' }}>▌</span>
          </div>
        </div>
      )}

      {/* Phase A-D 分析结果 */}
      {analysis && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            📊 Phase A-D 分析结果
          </h3>
          <AnalysisDisplay analysis={analysis} />
        </div>
      )}

      {/* 🎬 FloobyNooby 15步流水线：深度精炼 → 关键面板 → 最终交付 */}
      {analysis && (
        <FloobyNoobyPipeline
          analysis={analysis}
          refineLoading={refineLoading} refineResult={refineResult} refineStream={refineStream}
          keyPanelsLoading={keyPanelsLoading} keyPanelsResult={keyPanelsResult} keyPanelsStream={keyPanelsStream}
          finalLoading={finalLoading} finalResult={finalResult} finalStream={finalStream}
          onRefine={handleRefine}
          onKeyPanels={handleKeyPanels}
          onFinal={handleFinal}
        />
      )}

      {/* 🔔 分析完成但还没生成单元 → 醒目引导 */}
      {analysis && units.length === 0 && !generatingAll && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(59,130,246,0.1) 100%)',
          border: '2px dashed var(--accent)',
          borderRadius: 'var(--radius)',
          padding: '24px 28px',
          marginBottom: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>👇</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
            👆 上面的只是「分析摘要」，还不是分镜稿！
          </h3>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.6 }}>
            每个单元目前只有 <strong style={{ color: 'var(--warning)' }}>25字概要</strong>，
            真正的分镜内容（画面描述、镜头语言、摄影机运动等12个详细字段）需要通过 Phase E-F-G 生成。
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            简单说：分析 = 切蛋糕 🍰，生成 = 给每块蛋糕裱花 🎂
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>并发数:</span>
            <select
              className="form-input"
              value={concurrency}
              onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
              style={{ width: 70, padding: '4px 8px', fontSize: 12 }}
            >
              {CONCURRENCY_OPTIONS.map(n => (
                <option key={n} value={n}>{n}路</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={handleGenerateAll}
              disabled={generatingAll || !selectedTaskId}
              style={{ fontSize: 16, padding: '10px 32px' }}
            >
              🚀 生成所有单元（共 {analysis?.units?.length || analysis?.UNIT?.length || '?'} 个）
            </button>
          </div>
        </div>
      )}

      {/* Phase E-F-G 单元列表 */}
      {units.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>
              🧩 Phase E-F-G 单元 ({completedCount}/{totalCount})
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>并发数:</span>
              <select
                className="form-input"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                style={{ width: 70, padding: '4px 8px', fontSize: 12 }}
              >
                {CONCURRENCY_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}路</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleGenerateAll}
                disabled={generatingAll || !selectedTaskId}
              >
                {generatingAll ? <><span className="loading-spinner" style={{ width: 12, height: 12 }} /> 生成中...</> : '🚀 生成全部'}
              </button>
            </div>
          </div>

          {/* 💡 单元使用说明 */}
          {showUnitHint ? (
            <div style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(139,92,246,0.12) 100%)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
              marginBottom: 16,
              position: 'relative',
            }}>
              <button
                onClick={() => setShowUnitHint(false)}
                style={{
                  position: 'absolute', top: 8, right: 12,
                  background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 16, lineHeight: 1,
                }}
                title="关闭"
              >
                ✕
              </button>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: 'var(--accent)' }}>
                💡 这 {totalCount} 个单元怎么用？
              </h4>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, paddingRight: 24 }}>
                <p style={{ margin: '0 0 8px' }}>
                  🔗 <strong>全部 {totalCount} 个单元一起用！</strong>它们是按时间线<strong style={{ color: 'var(--accent)' }}>串联</strong>的，共同构成完整分镜稿：
                </p>
                <div style={{
                  background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px',
                  marginBottom: 8, fontFamily: 'monospace', fontSize: 12,
                  color: 'var(--text-secondary)',
                }}>
                  {units.map((u, i) => (
                    <span key={u.unitIndex ?? i}>
                      {i > 0 && ' → '}
                      U{u.unitIndex ?? i}({u.durationSec || u.duration || '?'}s)
                    </span>
                  ))}
                </div>
                <p style={{ margin: '0 0 4px' }}>
                  🎬 <strong>使用步骤</strong>：
                </p>
                <ol style={{ margin: '4px 0 0', paddingLeft: 20, color: 'var(--text-secondary)' }}>
                  <li>展开每个单元 → 切换到 <strong style={{ color: 'var(--accent)' }}>📝 COPY区</strong> 标签</li>
                  <li>点击「📋 复制 COPY区」→ 粘贴到 AI 生视频工具（Sora/Veo/即梦等）</li>
                  <li>生成的视频按 <strong>U1 → U2 → U3 → ...</strong> 顺序拼接</li>
                  <li>你就得到了按剧本时间线排列的完整分镜视频 🎉</li>
                </ol>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'right', marginBottom: 12 }}>
              <button
                onClick={() => setShowUnitHint(true)}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--accent)',
                  cursor: 'pointer', fontSize: 12, textDecoration: 'underline',
                }}
              >
                💡 显示使用说明
              </button>
            </div>
          )}

          {/* 进度条 */}
          {(generatingAll || progressPercent > 0) && (
            <div style={{ marginBottom: 16 }}>
              <div className="progress-bar" style={{ height: 8 }}>
                <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {progress?.message || `${completedCount} / ${totalCount} 完成`}
                </span>
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>{progressPercent}%</span>
              </div>
            </div>
          )}

          {/* 单元卡片列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {units.map((unit, i) => (
              <UnitCard
                key={unit.unitIndex ?? i}
                unit={unit}
                onGenerate={handleGenerateUnit}
                generating={generatingAll}
              />
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!analysis && units.length === 0 && !analyzing && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">🎞️</div>
          <p>选择一个剧本任务，然后点击"分析"开始</p>
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

/**
 * 分析结果展示组件
 * 显示 Phase A-D 的段号索引、结构类型、情绪地图、单元分配表
 */
/**
 * 分析结果展示组件
 * 显示 Phase A-D 的段号索引、结构类型、情绪地图、单元分配表
 *
 * 🎬 使用流程：
 * 1. 看「段号索引」→ 了解剧本被切成哪些段落，每段有什么人物和内容
 * 2. 看「单元分配表」→ 了解哪些段落组成一个分镜单元，每个单元的类型和时长
 * 3. 点击单元行展开 → 看到该单元包含的段落原文，确认分配合理
 * 4. 确认无误后点「生成全部」→ 逐单元生成 COPY区 + NOTE区 分镜内容
 */
function AnalysisDisplay({ analysis }) {
  const paragraphIndex = analysis?.paragraphIndex || analysis?.paragraphs || analysis?.PARA || []
  const peaks = analysis?.emotionMap?.peaks || analysis?.peaks || analysis?.PEAK || []
  const buffers = analysis?.emotionMap?.buffers || analysis?.buffers || analysis?.BUFFER || []
  const subtexts = analysis?.emotionMap?.subtexts || analysis?.subtexts || analysis?.SUBTEXT || []
  const unitAssignments = analysis?.units || analysis?.UNIT || []
  // 🆕 FloobyNooby 4阶段结构分析
  const dramaticStructure = analysis?.dramaticStructure || {}
  const sequences = analysis?.sequences || analysis?.SEQUENCE || []
  const cameraStrategies = analysis?.cameraStrategies || analysis?.CAMERA_STRATEGY || []
  const sceneCores = analysis?.sceneCores || analysis?.SCENE_CORE || []

  const [expandedParas, setExpandedParas] = useState({})
  const [expandedUnits, setExpandedUnits] = useState({})
  const [showStructure, setShowStructure] = useState(true)

  const togglePara = (id) => {
    setExpandedParas(prev => ({ ...prev, [id]: !prev[id] }))
  }
  const toggleUnit = (idx) => {
    setExpandedUnits(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  const paraMap = new Map()
  for (const p of paragraphIndex) {
    paraMap.set(p.id, p)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 结构类型 + 总览 */}
      {analysis?.structureType && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            🏗️ 结构: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{analysis.structureType}</span>
          </span>
          {analysis.totalSec > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              ⏱ 总时长: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{analysis.totalSec}s</span>
            </span>
          )}
          {analysis.totalUnits > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              🧩 总单元: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{analysis.totalUnits}</span>
            </span>
          )}
          {paragraphIndex.length > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              ✂️ 切段: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{paragraphIndex.length}段</span>
            </span>
          )}
        </div>
      )}

      {/* 🎬 FloobyNooby 结构分析（DRAMA_STRUCTURE + SEQUENCE + CAMERA_STRATEGY + SCENE_CORE）*/}
      {(Object.keys(dramaticStructure).length > 0 || sequences.length > 0 || cameraStrategies.length > 0 || sceneCores.length > 0) && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => setShowStructure(!showStructure)}
          >
            <h4 style={{ fontSize: 14, margin: 0 }}>🎬 FloobyNooby 结构分析</h4>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {showStructure ? '▲ 收起' : '▼ 展开'}
            </span>
          </div>

          {showStructure && (
            <div style={{ marginTop: 10 }}>
              {/* 阶段一：戏剧结构诊断 */}
              {Object.keys(dramaticStructure).length > 0 && (
                <div style={{
                  marginBottom: 10, padding: '10px 14px',
                  background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
                    🎭 戏剧结构诊断
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4px 12px' }}>
                    {dramaticStructure.protagonist && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>主角：</span>
                        <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{dramaticStructure.protagonist}</span>
                      </div>
                    )}
                    {dramaticStructure.desire && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>欲望：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.desire}</span>
                      </div>
                    )}
                    {dramaticStructure.opposition && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>对抗：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.opposition}</span>
                      </div>
                    )}
                    {dramaticStructure.turningPointA && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>转折A：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.turningPointA}</span>
                      </div>
                    )}
                    {dramaticStructure.turningPointB && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>转折B(不可逆)：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.turningPointB}</span>
                      </div>
                    )}
                    {dramaticStructure.climax && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>真正高潮：</span>
                        <span style={{ color: 'var(--error)', fontWeight: 600 }}>{dramaticStructure.climax}</span>
                      </div>
                    )}
                    {dramaticStructure.ending && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>结局落点：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.ending}</span>
                      </div>
                    )}
                    {dramaticStructure.falseClimaxRisk && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>⚠️ 假高潮风险：</span>
                        <span style={{ color: 'var(--warning)' }}>{dramaticStructure.falseClimaxRisk}</span>
                      </div>
                    )}
                    {dramaticStructure.objectStakes && dramaticStructure.objectStakes !== '无' && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>🔑 物件赌注：</span>
                        <span style={{ color: 'var(--warning)' }}>{dramaticStructure.objectStakes}</span>
                      </div>
                    )}
                    {dramaticStructure.publicToPrivateGate && (
                      <div style={{ fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>公→私门：</span>
                        <span style={{ color: 'var(--text-primary)' }}>{dramaticStructure.publicToPrivateGate}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 阶段一：戏剧段落序列地图 */}
              {sequences.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
                    🧩 戏剧段落序列 ({sequences.length}段)
                  </div>
                  {sequences.map((seq, i) => (
                    <div key={i} style={{
                      marginBottom: 4, padding: '6px 10px',
                      background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
                      borderLeft: '3px solid var(--warning)',
                      fontSize: 12,
                    }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{seq.id || `序列${i + 1}`}</span>
                        {seq.name && <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{seq.name}</span>}
                      </div>
                      {seq.dramaticCore && (
                        <div style={{ marginTop: 2, color: 'var(--text-primary)' }}>
                          💡 {seq.dramaticCore}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
                        {seq.whatChangesByEnd && (
                          <span style={{ color: 'var(--text-secondary)' }}>变化: {seq.whatChangesByEnd}</span>
                        )}
                        {seq.audiencePosition && (
                          <span style={{ color: 'var(--text-secondary)' }}>视角: {seq.audiencePosition}</span>
                        )}
                        {seq.primaryPressure && (
                          <span style={{ color: 'var(--text-secondary)' }}>压力: {seq.primaryPressure}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 阶段二：镜头策略 */}
              {cameraStrategies.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
                    🎥 镜头策略 ({cameraStrategies.length}条)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {cameraStrategies.map((cs, i) => (
                      <div key={i} style={{
                        padding: '6px 10px', background: 'var(--bg-primary)',
                        borderRadius: 'var(--radius)', borderLeft: '3px solid var(--accent)',
                        fontSize: 12,
                      }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>
                          {cs.id || `策略${i + 1}`}
                        </span>
                        {cs.openingSize && <span style={{ marginRight: 10, color: 'var(--text-secondary)' }}>开镜: {cs.openingSize}</span>}
                        {cs.pressureDirection && <span style={{ marginRight: 10, color: 'var(--text-secondary)' }}>压力: {cs.pressureDirection}</span>}
                        {cs.reactionOwner && <span style={{ marginRight: 10, color: 'var(--text-secondary)' }}>反应权: {cs.reactionOwner}</span>}
                        {cs.climaxPlacement && <span style={{ marginRight: 10, color: 'var(--text-secondary)' }}>高潮: {cs.climaxPlacement}</span>}
                        {cs.forbidden && (
                          <div style={{ marginTop: 2, color: 'var(--error)', fontSize: 11 }}>
                            🚫 禁止: {cs.forbidden}
                          </div>
                        )}
                        {cs.infoPattern && (
                          <div style={{ marginTop: 2, color: 'var(--text-secondary)', fontSize: 11 }}>
                            信息顺序: {cs.infoPattern}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 阶段三：场景戏核 + 镜头流 */}
              {sceneCores.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
                    🎬 场景戏核 + 镜头流 ({sceneCores.length}场)
                  </div>
                  {sceneCores.map((sc, i) => (
                    <div key={i} style={{
                      marginBottom: 4, padding: '8px 10px',
                      background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
                      borderLeft: '3px solid var(--success)',
                      fontSize: 12,
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{sc.id || `场景${i + 1}`}</span>
                        {sc.sceneName && <span style={{ color: 'var(--success)', fontWeight: 600 }}>{sc.sceneName}</span>}
                      </div>
                      {sc.dramaticCore && (
                        <div style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
                          💡 戏核：{sc.dramaticCore}
                        </div>
                      )}
                      {sc.shotFlow && (
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                          📐 镜头流：{sc.shotFlow}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 3 }}>
                        {sc.firstCloseUp && <span style={{ color: 'var(--warning)' }}>🔍 首特写: {sc.firstCloseUp}</span>}
                        {sc.climaxDuty && <span style={{ color: 'var(--error)' }}>🎯 高潮: {sc.climaxDuty}</span>}
                        {sc.reactionOwner && <span style={{ color: 'var(--text-secondary)' }}>👀 反应权: {sc.reactionOwner}</span>}
                        {sc.audiencePosition && <span style={{ color: 'var(--text-secondary)' }}>🎪 观众站位: {sc.audiencePosition}</span>}
                        {sc.continuityAnchor && <span style={{ color: 'var(--text-secondary)' }}>⚓ 连续性: {sc.continuityAnchor}</span>}
                      </div>
                      {sc.commonMistake && (
                        <div style={{ marginTop: 3, color: 'var(--error)', fontSize: 11 }}>
                          ⚠️ 易犯错误：{sc.commonMistake}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 段号索引 - 可展开卡片 */}
      {paragraphIndex.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, margin: 0 }}>📑 段号索引 ({paragraphIndex.length}段)</h4>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const all = {}
                const expand = Object.keys(expandedParas).length < paragraphIndex.length / 2
                for (const p of paragraphIndex) all[p.id] = expand
                setExpandedParas(all)
              }}
              style={{ fontSize: 11 }}
            >
              {Object.keys(expandedParas).length < paragraphIndex.length / 2 ? '📖 全部展开' : '📕 全部收起'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 500, overflowY: 'auto' }}>
            {paragraphIndex.map((p, i) => {
              const facts = p.facts || {}
              const isExpanded = expandedParas[p.id]
              return (
                <div
                  key={p.id || i}
                  onClick={() => togglePara(p.id)}
                  style={{
                    padding: isExpanded ? '8px 10px' : '6px 10px',
                    borderRadius: 'var(--radius)',
                    background: isExpanded ? 'var(--bg-hover)' : 'var(--bg-primary)',
                    fontSize: 12,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    border: isExpanded ? '1px solid var(--border)' : '1px solid transparent',
                  }}
                >
                  {/* 收起状态：单行预览 */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      color: p._llmOnly ? 'var(--warning)' : 'var(--accent)',
                      fontWeight: 600,
                      minWidth: 50,
                      fontFamily: 'monospace',
                    }}>
                      {p.id || `§${i + 1}`}
                    </span>
                    <span style={{
                      color: 'var(--text-secondary)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: isExpanded ? 'normal' : 'nowrap',
                    }}>
                      {p.text
                        ? (isExpanded ? p.text : p.text.slice(0, 100).replace(/\n/g, ' ') + (p.text.length > 100 ? '...' : ''))
                        : (facts.character || facts.action || '-')
                      }
                    </span>
                    {p._llmOnly && (
                      <span style={{
                        color: 'var(--warning)',
                        fontSize: 10,
                        whiteSpace: 'nowrap',
                        background: 'var(--warning-dim)',
                        padding: '1px 5px',
                        borderRadius: 10,
                      }}>
                        LLM标注
                      </span>
                    )}
                    {facts.character && (
                      <span style={{
                        color: 'var(--warning)',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        background: 'var(--warning-dim)',
                        padding: '1px 6px',
                        borderRadius: 10,
                      }}>
                        {facts.character}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-secondary)', fontSize: 10, minWidth: 24, textAlign: 'center' }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>

                  {/* 展开状态：完整段落 + facts 详情 */}
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      <div style={{
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        lineHeight: 1.8,
                        whiteSpace: 'pre-wrap',
                        marginBottom: 8,
                      }}>
                        {p.text}
                      </div>
                      {Object.keys(facts).length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {facts.character && (
                            <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                              👤 {facts.character}
                            </span>
                          )}
                          {facts.action && (
                            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                              🎬 {facts.action}
                            </span>
                          )}
                          {facts.emotion && (
                            <span style={{ fontSize: 11, color: 'var(--error)' }}>
                              💭 {facts.emotion}
                            </span>
                          )}
                          {facts.scene && (
                            <span style={{ fontSize: 11, color: 'var(--success)' }}>
                              🏠 {facts.scene}
                            </span>
                          )}
                          {facts.prop && (
                            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                              🔧 {facts.prop}
                            </span>
                          )}
                          {facts.dialogue && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              💬 {facts.dialogue}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 情绪地图 */}
      {(peaks.length > 0 || buffers.length > 0 || subtexts.length > 0) && (
        <div className="card">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>🎭 情绪地图</h4>
          {peaks.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginRight: 8 }}>🔺 高潮:</span>
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {peaks.map((p, i) => (
                  <span key={`peak-${i}`} className="badge badge-error" style={{ fontSize: 11 }}>
                    {p.sectionId} {p.kind}
                  </span>
                ))}
              </div>
            </div>
          )}
          {buffers.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginRight: 8 }}>🔻 缓冲:</span>
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {buffers.map((b, i) => (
                  <span key={`buffer-${i}`} className="badge badge-success" style={{ fontSize: 11 }}>
                    {b.sectionId} {b.reason}
                  </span>
                ))}
              </div>
            </div>
          )}
          {subtexts.length > 0 && (
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginRight: 8 }}>💬 潜台词:</span>
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {subtexts.map((s, i) => (
                  <span key={`subtext-${i}`} className="badge badge-warning" style={{ fontSize: 11 }}>
                    {s.sectionId} {s.description}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 单元分配表 - 可展开查看段落原文 */}
      {unitAssignments.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, margin: 0 }}>📋 单元分配表 ({unitAssignments.length}个单元)</h4>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const all = {}
                const expand = Object.keys(expandedUnits).length < unitAssignments.length / 2
                for (const u of unitAssignments) {
                  all[u.index ?? u.unitIndex] = expand
                }
                setExpandedUnits(all)
              }}
              style={{ fontSize: 11 }}
            >
              {Object.keys(expandedUnits).length < unitAssignments.length / 2 ? '📖 全部展开' : '📕 全部收起'}
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', width: 50 }}>单元</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', width: 90 }}>段落</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', width: 70 }}>类型</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', width: 55 }}>时长</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)' }}>摘要</th>
                </tr>
              </thead>
              <tbody>
                {unitAssignments.map((u, i) => {
                  const idx = u.index ?? u.unitIndex ?? i
                  const isExpanded = expandedUnits[idx]
                  const refs = u.sectionRefs
                    ? (Array.isArray(u.sectionRefs) ? u.sectionRefs : String(u.sectionRefs).split(/[,，\s]+/).filter(Boolean))
                    : []
                  const paras = refs.length > 0 ? refs.join(', ') : (u.paragraphRange || u.paras || '-')
                  const stype = u.sceneType || u.structureType || u.type || '-'
                  const dur = u.durationSec ?? u.duration
                  return (
                    <React.Fragment key={i}>
                      <tr
                        onClick={() => toggleUnit(idx)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: isExpanded ? 'var(--bg-hover)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                      >
                        <td style={{ padding: '6px 8px', color: 'var(--accent)', fontWeight: 600 }}>
                          U{idx}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                          {paras}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <span className="badge badge-accent" style={{ fontSize: 10 }}>
                            {stype}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                          {dur ? `${dur}s` : '-'}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontSize: 11 }}>
                          {u.summary
                            ? (u.summary.length > 60 ? u.summary.slice(0, 60) + '...' : u.summary)
                            : '-'
                          }
                        </td>
                      </tr>
                      {isExpanded && refs.length > 0 && (
                        <tr>
                          <td colSpan={5} style={{
                            padding: '10px 12px',
                            background: 'var(--bg-primary)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                              📎 本单元包含以下 {refs.length} 段原文：
                            </div>
                            {refs.map((ref) => {
                              const para = paraMap.get(ref.trim())
                              if (!para) {
                                return (
                                  <div key={ref} style={{
                                    padding: '4px 8px',
                                    marginBottom: 4,
                                    fontSize: 11,
                                    color: 'var(--text-secondary)',
                                  }}>
                                    {ref} (段落数据未找到)
                                  </div>
                                )
                              }
                              const hasFacts = para.facts && Object.keys(para.facts).length > 0
                              const hasText = para.text && para.text.length > 0
                              if (hasText) {
                                return (
                                  <div key={ref} style={{
                                    padding: '6px 8px',
                                    marginBottom: 4,
                                    background: 'var(--bg-hover)',
                                    borderRadius: 'var(--radius)',
                                    fontSize: 12,
                                    lineHeight: 1.7,
                                    whiteSpace: 'pre-wrap',
                                    color: 'var(--text-primary)',
                                  }}>
                                    <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>
                                      {para.id}
                                    </span>
                                    {para.text}
                                  </div>
                                )
                              }
                              // LLM 标注的段落（无原文，但有 facts）
                              return (
                                <div key={ref} style={{
                                  padding: '5px 8px',
                                  marginBottom: 4,
                                  background: 'var(--bg-hover)',
                                  borderRadius: 'var(--radius)',
                                  fontSize: 11,
                                  borderLeft: '3px solid var(--warning)',
                                }}>
                                  <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>
                                    {para.id}
                                  </span>
                                  {hasFacts ? (
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                      {para.facts.character && <span style={{ marginRight: 8 }}>👤 {para.facts.character}</span>}
                                      {para.facts.action && <span style={{ marginRight: 8 }}>🎬 {para.facts.action}</span>}
                                      {para.facts.emotion && <span style={{ marginRight: 8 }}>💭 {para.facts.emotion}</span>}
                                      {para.facts.scene && <span style={{ marginRight: 8 }}>🏠 {para.facts.scene}</span>}
                                      {para.facts.dialogue && <span style={{ marginRight: 8 }}>💬 {para.facts.dialogue}</span>}
                                      {para.facts.prop && <span style={{ marginRight: 8 }}>🔧 {para.facts.prop}</span>}
                                      {para._llmOnly && <span style={{ color: 'var(--warning)', fontSize: 10 }}>(LLM标注·无原文匹配)</span>}
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                      {para._llmOnly ? '(LLM标注·无原文匹配)' : '(无内容)'}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                            {u.plannedEntryState && (
                              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent)' }}>
                                🎬 起幅：{u.plannedEntryState}
                              </div>
                            )}
                            {u.plannedExitState && (
                              <div style={{ fontSize: 11, color: 'var(--warning)' }}>
                                🎬 落幅：{u.plannedExitState}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 原始 JSON（兜底） */}
      {paragraphIndex.length === 0 && unitAssignments.length === 0 && (
        <div className="stream-output" style={{ fontSize: 12 }}>
          {JSON.stringify(analysis, null, 2)}
        </div>
      )}
    </div>
  )
}

/**
 * 🎬 FloobyNooby 15步流水线组件
 *
 * 将分析结果（Steps 1-4）继续推进到完整的专业分镜交付：
 * 🎯 Steps 5-9 精炼 → 🔑 Steps 10-12 关键面板+逐镜板 → 📬 Steps 13-15 最终交付
 *
 * 📖 使用流程：
 * 1. 先在快速模式输入主题+描述 → 一键生成分镜分析（Steps 1-4）
 * 2. 分析结果出来后，依次点击每个阶段的按钮
 * 3. 每个阶段都用 SSE 流式展示 LLM 的深度思考
 * 4. 三个阶段全部跑完 → 一份可交付给制作团队的完整分镜总稿
 */
function FloobyNoobyPipeline({
  analysis,
  refineLoading, refineResult, refineStream,
  keyPanelsLoading, keyPanelsResult, keyPanelsStream,
  finalLoading, finalResult, finalStream,
  onRefine, onKeyPanels, onFinal,
}) {
  const hasRefine = refineResult && refineResult.text
  const hasKeyPanels = keyPanelsResult && keyPanelsResult.text
  const hasFinal = finalResult && finalResult.text

  const pipelineStages = [
    {
      key: 'refine',
      title: '🎯 Steps 5-9 精炼',
      desc: '粗缩略图→Animatic审查→结构修订→镜头语言精炼→二轮缩略图',
      loading: refineLoading,
      result: refineResult,
      stream: refineStream,
      hasResult: hasRefine,
      onRun: onRefine,
      outputBlocks: ['DIAGNOSTIC', 'REVISION', 'REFINED_CORE', 'ROUGH_BOARD'],
      color: 'var(--warning)',
    },
    {
      key: 'keyPanels',
      title: '🔑 Steps 10-12 关键面板+逐镜板',
      desc: '锁定关键面板→粗动画计划→关键场次逐镜板',
      loading: keyPanelsLoading,
      result: keyPanelsResult,
      stream: keyPanelsStream,
      hasResult: hasKeyPanels,
      onRun: onKeyPanels,
      outputBlocks: ['KEY_PANEL', 'ANIMATIC_PLAN', 'SHOT_BOARD'],
      color: 'var(--error)',
    },
    {
      key: 'final',
      title: '📬 Steps 13-15 最终交付',
      desc: '全片粗板包→清洁规则→最终交付',
      loading: finalLoading,
      result: finalResult,
      stream: finalStream,
      hasResult: hasFinal,
      onRun: onFinal,
      outputBlocks: ['FULL_BOARD', 'CLEAN_RULES', 'FINAL_DELIVERY'],
      color: 'var(--success)',
    },
  ]

  const sectionStyle = (color) => ({
    background: `linear-gradient(135deg, ${color}10 0%, ${color}08 100%)`,
    border: `1px solid ${color}40`,
    borderRadius: 'var(--radius)',
    padding: '16px 20px',
    transition: 'all 0.3s',
    position: 'relative',
  })

  const badgeStyle = (color, done) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: done ? color : 'transparent',
    border: `2px solid ${color}`,
    color: done ? '#fff' : color,
    fontSize: 12,
    fontWeight: 700,
    transition: 'all 0.3s',
  })

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '10px 0', borderBottom: '2px solid var(--accent)',
      }}>
        <span style={{ fontSize: 20 }}>🎬</span>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
          FloobyNooby 15步流水线
        </h3>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Steps 1-4 已完成 ↑ | 继续推进 →
        </span>
      </div>

      {/* 流水线进度条 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20,
        padding: '12px 20px', background: 'var(--bg-primary)',
        borderRadius: 'var(--radius)',
      }}>
        {pipelineStages.map((stage, i) => (
          <React.Fragment key={stage.key}>
            {i > 0 && (
              <div style={{
                flex: 1, height: 3, margin: '0 4px',
                background: stage.hasResult || pipelineStages[i-1].hasResult
                  ? stage.color
                  : 'var(--border)',
                borderRadius: 2,
                transition: 'background 0.5s',
              }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={badgeStyle(stage.color, stage.hasResult)}>
                {stage.hasResult ? '✓' : (i + 2)}
              </span>
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: stage.hasResult ? stage.color : 'var(--text-secondary)' }}>
                  {stage.title.split(' ').slice(0, 1).join('')}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Steps {[5,10,13][i]}-{[9,12,15][i]}
                </div>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* 三个阶段 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {pipelineStages.map((stage) => (
          <div key={stage.key} style={sectionStyle(stage.color)}>
            {/* 标题栏 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>
                {stage.loading ? '⚡' : stage.hasResult ? '✅' : '⏳'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {stage.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {stage.desc}
                </div>
              </div>
              {!stage.hasResult && !stage.loading && (
                <button
                  className="btn btn-primary"
                  onClick={stage.onRun}
                  style={{ fontSize: 13, padding: '6px 16px', whiteSpace: 'nowrap' }}
                >
                  执行 →
                </button>
              )}
              {stage.loading && (
                <span style={{ fontSize: 12, color: stage.color }}>
                  <span className="loading-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 4 }} />
                  生成中...
                </span>
              )}
              {stage.hasResult && (
                <span style={{ fontSize: 12, color: 'var(--success)' }}>已完成</span>
              )}
            </div>

            {/* 流式输出 */}
            {stage.loading && stage.stream && (
              <div style={{
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius)',
                padding: '12px 16px',
                fontSize: 13,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                maxHeight: 500,
                overflowY: 'auto',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}>
                {stage.stream}
                <span style={{ animation: 'blink 1s infinite', color: stage.color }}>▌</span>
              </div>
            )}

            {/* 完成结果 */}
            {stage.hasResult && (
              <div>
                {/* 输出块概览 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {stage.outputBlocks.map(block => (
                    <span key={block} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      background: `${stage.color}20`, color: stage.color,
                      fontFamily: 'monospace',
                    }}>
                      {block}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                    {stage.result.text?.length || 0} 字
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={stage.onRun}
                  style={{ fontSize: 11 }}
                >
                  🔄 重新生成
                </button>
                {/* 可折叠详细内容 */}
                <details style={{ marginTop: 8 }}>
                  <summary style={{
                    cursor: 'pointer', fontSize: 12, color: 'var(--accent)',
                    userSelect: 'none',
                  }}>
                    📄 查看完整输出
                  </summary>
                  <div style={{
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius)',
                    padding: '12px 16px',
                    marginTop: 8,
                    fontSize: 13,
                    lineHeight: 1.8,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 600,
                    overflowY: 'auto',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                  }}>
                    {stage.result.text}
                  </div>
                </details>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 全部完成后的汇总提示 */}
      {hasRefine && hasKeyPanels && hasFinal && (
        <div style={{
          marginTop: 16, padding: '16px 20px',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(59,130,246,0.1) 100%)',
          border: '2px solid var(--success)',
          borderRadius: 'var(--radius)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>🎉</div>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>
            FloobyNooby 15步流水线全部完成！
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            现在你拥有一份完整的专业分镜交付包：<br/>
            戏剧结构诊断 + 段落序列地图 + 镜头策略 + 场景戏核 + 精炼审查 + 关键面板 + 逐镜板 + 清洁规则
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            展开上方三个阶段查看完整输出，或继续下方生成分镜单元（COPY区+NOTE区）
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * 单元卡片组件
 * 展示 COPY区（喂给 AI 生图的提示词）+ NOTE区（导演备注）+ 自检报告
 *
 * 🎬 怎么用：
 * - COPY区 = 可以直接复制粘贴到 AI 生图/生视频工具里的 16 字段提示词
 * - NOTE区 = 导演/摄影参考的技术备注，辅助理解镜头意图
 * - 自检 = Phase G 自动检查结果，确认镜头间接力链/时长校验通过
 */
/**
 * 把 COPY区 内容压缩成即梦优化版（≤2000 字）
 *
 * 原理：完整的 COPY区 有 8 个字段（景别/画面/动作/机位/声音/cut/色彩/MustShow），
 * 但即梦等 AI 生图工具只需要视觉描述。这个函数：
 * 1. 去掉 ═══ 标记、G区自检、NOTE区
 * 2. 每镜只保留 3 个核心视觉字段：画面/构图 + Must-Show元素 + 色彩与光线
 * 3. 如果还是超 2000 字，按优先级渐进压缩
 *
 * @param {string} content - 原始 COPY区 内容
 * @param {number} maxLen - 目标最大字符数，默认 2000
 * @returns {{ text: string, wasCompressed: boolean, originalLen: number, compressedLen: number }}
 */
function compressCopyForJimeng(content, maxLen = 2000) {
  if (!content) return { text: '', wasCompressed: false, originalLen: 0, compressedLen: 0 }

  const originalLen = content.length

  // 如果本来就短，不需要压缩
  if (originalLen <= maxLen) {
    return { text: content, wasCompressed: false, originalLen, compressedLen: originalLen }
  }

  // 第1步：去掉分隔标记和 G区/NOTE区
  let cleaned = content
    .replace(/═══\s*COPY\s*区\s*START\s*═══/gi, '')
    .replace(/═══\s*COPY\s*区\s*END.*?(?:═══|$)/gi, '')
    .replace(/═══\s*NOTE\s*区\s*END\s*═══/gi, '')
    .replace(/G区自检[^]*$/i, '')       // 砍掉 G区自检（从"G区自检"到末尾）
    .replace(/\n{3,}/g, '\n\n')          // 压缩多余空行
    .trim()

  if (cleaned.length <= maxLen) return { text: cleaned, wasCompressed: true, originalLen, compressedLen: cleaned.length }

  // 第2步：拆出每个分镜，只保留核心视觉字段
  const shotRegex = /【分镜\s*[\d/]+\s*\|\s*[\d.]+\s*s\s*\|\s*类型:\s*[^】]+】/g
  const titles = cleaned.match(shotRegex) || []
  const bodies = cleaned.split(shotRegex).slice(1) // 第一个元素是标题前的内容，忽略

  // 从一段分镜文本中提取指定字段的值
  const extractField = (text, fieldNames) => {
    for (const name of fieldNames) {
      const re = new RegExp(`${name}[：:]\\s*([\\s\\S]*?)(?=\\n\\S+[：:]|\\n【分镜|$)`, 'i')
      const m = text.match(re)
      if (m) return { label: name, value: m[1].trim() }
    }
    return null
  }

  // 字段优先级（对即梦生图最重要的排前面）
  const fieldPriority = [
    ['画面', '画面/构图'],
    ['Must-Show', 'Must-Show元素'],
    ['景别'],
    ['动作'],
  ]

  // 构建精简版
  const buildCompact = (includeFields) => {
    let result = ''
    for (let i = 0; i < titles.length; i++) {
      result += titles[i] + '\n'
      const body = bodies[i] || ''
      for (const names of includeFields) {
        const f = extractField(body, names)
        if (f) result += f.label + ': ' + f.value + '\n'
      }
      result += '\n'
    }
    return result.trim()
  }

  // 渐进压缩策略：从完整视觉字段 → 逐步削减
  let compact = buildCompact(fieldPriority)
  if (compact.length <= maxLen) return { text: compact, wasCompressed: true, originalLen, compressedLen: compact.length }

  // 策略A：先砍掉 动作 字段
  compact = buildCompact([fieldPriority[0], fieldPriority[1], fieldPriority[2]])
  if (compact.length <= maxLen) return { text: compact, wasCompressed: true, originalLen, compressedLen: compact.length }

  // 策略B：再砍掉 景别，只留画面+Must-Show
  compact = buildCompact([fieldPriority[0], fieldPriority[1]])
  if (compact.length <= maxLen) return { text: compact, wasCompressed: true, originalLen, compressedLen: compact.length }

  // 策略C：只留画面描述
  compact = buildCompact([fieldPriority[0]])
  if (compact.length <= maxLen) return { text: compact, wasCompressed: true, originalLen, compressedLen: compact.length }

  // 策略C：按比例截断每行的画面描述
  const lines = compact.split('\n')
  const ratio = (maxLen / compact.length) * 0.92 // 留 8% 余量
  compact = lines.map(line => {
    if (line.length <= 60) return line // 短行不动
    const maxLineLen = Math.max(60, Math.floor(line.length * ratio))
    return line.length > maxLineLen ? line.slice(0, maxLineLen - 3) + '...' : line
  }).join('\n')

  return { text: compact, wasCompressed: true, originalLen, compressedLen: compact.length }
}

function UnitCard({ unit, onGenerate, generating }) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('copy')
  const [copied, setCopied] = useState(false)
  const [compressedCopied, setCompressedCopied] = useState(false)
  const statusInfo = UNIT_STATUS_MAP[unit.status] || UNIT_STATUS_MAP.pending

  // 兼容多种字段名
  const copyContent = unit.copyArea || unit.copy || unit.copyRegion || ''
  const noteObj = unit.noteArea || unit.note || unit.noteRegion || null
  const noteContent = typeof noteObj === 'object' ? noteObj.traceback || noteObj.note || '' : (noteObj || '')
  const selfCheck = typeof noteObj === 'object' ? noteObj.selfCheckReport : null

  // 字符数统计 + 即梦精简版
  const charCount = copyContent.length
  const compression = compressCopyForJimeng(copyContent)
  const JIMENG_LIMIT = 2000

  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(copyContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = copyContent
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyCompressed = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(compression.text)
      setCompressedCopied(true)
      setTimeout(() => setCompressedCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = compression.text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCompressedCopied(true)
      setTimeout(() => setCompressedCopied(false), 2000)
    }
  }

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      {/* 标题栏 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: 16 }}>{statusInfo.icon}</span>
        <span style={{
          fontWeight: 600,
          color: 'var(--accent)',
          minWidth: 50,
        }}>
          U{unit.unitIndex ?? unit.index ?? '?'}
        </span>
        <span className="badge" style={{ background: statusInfo.bg, color: statusInfo.color }}>
          {statusInfo.label}
        </span>
        {(unit.sceneType || unit.structureType) && (
          <span className="badge badge-accent">{unit.sceneType || unit.structureType}</span>
        )}
        {(unit.durationSec || unit.duration) && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏱ {unit.durationSec || unit.duration}s</span>
        )}
        {(unit.subShotCount || unit.shotCount) > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🎬 {unit.subShotCount || unit.shotCount}镜</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          {expanded ? '▲ 收起' : '▼ 展开'}
        </span>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {/* 标签切换 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {[
              { key: 'copy', label: '📝 COPY区', hint: '→ AI生图/生视频工具' },
              { key: 'note', label: '💡 NOTE区', hint: '→ 导演技术参考' },
              { key: 'usage', label: '📖 使用说明', hint: '' },
            ].map(tab => (
              <button
                key={tab.key}
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveTab(tab.key)
                }}
                style={{
                  borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 0,
                  padding: '6px 12px',
                  fontSize: 12,
                  color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 操作按钮栏 + 字符数统计 */}
          {copyContent && activeTab === 'copy' && (
            <div style={{ marginBottom: 8 }}>
              {/* 按钮行 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={handleCopy}>
                  {copied ? '✅ 已复制' : '📋 复制完整版'}
                </button>
                {compression.wasCompressed && (
                  <button
                    className="btn btn-sm"
                    onClick={handleCopyCompressed}
                    style={{
                      background: 'linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(236,72,153,0.15) 100%)',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                    }}
                  >
                    {compressedCopied ? '✅ 已复制' : '⚡ 复制精简版（≤2000字）'}
                  </button>
                )}
              </div>
              {/* 字符数统计行 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 11, flexWrap: 'wrap' }}>
                <span style={{
                  color: charCount <= JIMENG_LIMIT ? 'var(--success)'
                    : charCount <= JIMENG_LIMIT * 1.5 ? 'var(--warning)'
                    : 'var(--error)',
                  fontWeight: 600,
                }}>
                  完整版：{charCount} 字
                  {charCount > JIMENG_LIMIT && (
                    <span> ⚠️ 超即梦限制 {charCount - JIMENG_LIMIT} 字</span>
                  )}
                  {charCount <= JIMENG_LIMIT && ' ✅ 可直接用'}
                </span>
                {compression.wasCompressed && (
                  <span style={{
                    color: compression.compressedLen <= JIMENG_LIMIT ? 'var(--success)' : 'var(--warning)',
                    fontWeight: 600,
                  }}>
                    精简版：{compression.compressedLen} 字
                    {compression.compressedLen <= JIMENG_LIMIT ? ' ✅' : ' ⚠️'}
                    {' '}(压缩 {(100 - Math.round(compression.compressedLen / charCount * 100))}%)
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)' }}>
                  💡 即梦限制 {JIMENG_LIMIT} 字 | 🚫 请勿使用版权内容 | 精简版一键适配即梦
                </span>
              </div>
            </div>
          )}

          {/* COPY区 */}
          {activeTab === 'copy' && (
            copyContent ? (
              <div
                className="stream-output"
                style={{
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                  maxHeight: 600,
                  overflowY: 'auto',
                  padding: 12,
                  fontFamily: 'monospace',
                }}
              >
                {copyContent}
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '12px 0' }}>
                {unit.status === 'generating'
                  ? '⚡ 正在生成中...'
                  : '📭 暂无 COPY区内容，请先生成此单元'}
              </div>
            )
          )}

          {/* NOTE区 */}
          {activeTab === 'note' && (
            <div>
              {noteContent ? (
                <div
                  className="stream-output"
                  style={{
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.8,
                    maxHeight: 400,
                    overflowY: 'auto',
                    padding: 12,
                  }}
                >
                  {noteContent}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '12px 0' }}>
                  暂无 NOTE区内容
                </div>
              )}

              {/* 自检报告 */}
              {selfCheck && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600, marginBottom: 6 }}>🔍 Phase G 自检</div>
                  <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {typeof selfCheck === 'object'
                      ? Object.entries(selfCheck).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                            <span style={{ color: 'var(--accent)', fontWeight: 600, minWidth: 120 }}>{k}:</span>
                            <span style={{ color: 'var(--text-secondary)' }}>
                              {typeof v === 'string' ? v : JSON.stringify(v)}
                            </span>
                          </div>
                        ))
                      : <span style={{ color: 'var(--text-secondary)' }}>{String(selfCheck)}</span>
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 使用说明 */}
          {activeTab === 'usage' && (
            <div style={{ fontSize: 13, lineHeight: 2, color: 'var(--text-primary)' }}>
              <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--accent-dim)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--accent)' }}>
                <strong>🎬 这个页面帮你把剧本拆成可直接用于 AI 生图/生视频的提示词</strong>
              </div>

              <div style={{ marginBottom: 10 }}>
                <h4 style={{ fontSize: 14, marginBottom: 4 }}>📝 COPY区 是什么？</h4>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  COPY区是 <strong style={{ color: 'var(--accent)' }}>16 字段的完整分镜提示词</strong>，每镜都有：<br/>
                  相机位置、构图锚点、起幅/落幅、过门方式、S+画质描述、Must-Show 目标物、微表情等。<br/>
                  <strong>👉 直接复制粘贴到即梦/Sora/Veo 等 AI 视频工具里就能生成画面！</strong>
                </p>
              </div>

              <div style={{ marginBottom: 10 }}>
                <h4 style={{ fontSize: 14, marginBottom: 4 }}>💡 NOTE区 是什么？</h4>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  NOTE区是导演/摄影的技术参考：灯光方案、镜头运动节奏、场景调色方向等。<br/>
                  给拍摄团队或自己参考，不直接喂给 AI 工具。
                </p>
              </div>

              <div style={{ marginBottom: 10 }}>
                <h4 style={{ fontSize: 14, marginBottom: 4 }}>🔄 工作流程</h4>
                <ol style={{ color: 'var(--text-secondary)', paddingLeft: 20, margin: 0 }}>
                  <li>先确认「📊 Phase A-D 分析结果」里的单元分配合理</li>
                  <li>点击「🚀 生成全部」逐单元生成 COPY区 + NOTE区</li>
                  <li>展开已生成的单元 → 切换到 <strong>📝 COPY区</strong> 标签</li>
                  <li>点击「📋 复制 COPY区」复制提示词</li>
                  <li>粘贴到即梦/Sora/Veo 等 AI 视频生成工具</li>
                  <li>得到的视频导入剪辑软件，按单元顺序拼接</li>
                </ol>
              </div>

              <div style={{ marginBottom: 10 }}>
                <h4 style={{ fontSize: 14, marginBottom: 4 }}>⏱ 时长怎么用？</h4>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  每个单元有总时长（如 13秒），COPY区里每镜有独立时长（如 5s+3s+5s=13s）。<br/>
                  喂给 AI 工具时，每个镜头的生成时长就是 COPY区第0字段标的秒数。
                </p>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {(unit.status === 'pending' || unit.status === 'failed') && (
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onGenerate(unit.unitIndex ?? unit.index)
                }}
                disabled={generating}
              >
                🔄 生成此单元
              </button>
            )}
            {(unit.status === 'generated' || unit.status === 'done' || unit.status === 'selfchecked') && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onGenerate(unit.unitIndex ?? unit.index)
                }}
                disabled={generating}
              >
                🔄 重新生成
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
