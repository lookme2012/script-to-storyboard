import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { zensApp } from '../lib/zensApp'

const STEPS = [
  { num: 1, label: '破题', icon: '💡', desc: '生成多个 premise 选项' },
  { num: 2, label: '梗概', icon: '📖', desc: '生成故事梗概' },
  { num: 3, label: '人物', icon: '👥', desc: '生成角色设定' },
  { num: 4, label: '背景', icon: '🌍', desc: '生成背景信息' },
  { num: 5, label: '结构', icon: '🏗️', desc: '生成四幕结构' },
  { num: 6, label: '场次', icon: '🎬', desc: '生成场景列表' },
  { num: 7, label: '写作', icon: '✍️', desc: '生成剧本正文' },
  { num: 8, label: '医生', icon: '🩺', desc: '生成诊断报告' },
]

export default function Screenplay() {
  const { projectId: routeProjectId } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeStep, setActiveStep] = useState(1)

  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [selfcheckResult, setSelfcheckResult] = useState(null)
  const [selfchecking, setSelfchecking] = useState(false)
  const [userFeedback, setUserFeedback] = useState('')
  const [surgeryDecisions, setSurgeryDecisions] = useState({})
  const [editingDuration, setEditingDuration] = useState(false)

  /**
   * 加载项目数据
   */
  const loadProject = useCallback(async (preserveStep) => {
    const pid = routeProjectId
    if (!pid) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await zensApp.screenplay.getProject(pid)
      setProject(data)
      if (!preserveStep && data?.currentStep) {
        setActiveStep(Math.min(data.currentStep, 8))
      }
    } catch (err) {
      setError('加载项目失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [routeProjectId])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  /**
   * 生成当前步骤
   * 🌊 Web 模式下通过 SSE 流式接收 LLM 输出
   * 💬 支持传入 userFeedback，让用户可以给 LLM 反馈/修改指令
   */
  const handleGenerate = async (feedback) => {
    if (generating) return
    setGenerating(true)
    setStreamText('')
    setSelfcheckResult(null)
    setError(null)
    try {
      await zensApp.screenplay.generateStep(
        {
          projectId: routeProjectId,
          stepNumber: activeStep,
          userFeedback: feedback || undefined,
        },
        (chunk) => {
          setStreamText(prev => prev + chunk)
        }
      )
      setGenerating(false)
      setStreamText('')
      setUserFeedback('')
      loadProject(true)
    } catch (err) {
      setError('生成失败: ' + (err.message || err))
      setGenerating(false)
    }
  }

  /**
   * 自检当前步骤
   */
  const handleSelfcheck = async () => {
    if (selfchecking) return
    setSelfchecking(true)
    setSelfcheckResult(null)
    try {
      const result = await zensApp.screenplay.selfcheckStep(
        {
          projectId: routeProjectId,
          stepNumber: activeStep,
        },
        () => {}
      )
      setSelfcheckResult(result)
    } catch (err) {
      setError('自检失败: ' + (err.message || err))
    } finally {
      setSelfchecking(false)
    }
  }

  /**
   * 通过当前步骤，进入下一步
   * 🔄 对齐原始代码：通过后自动跳到下一步并触发生成
   */
  const handleApprove = async () => {
    try {
      const nextStep = activeStep < 8 ? activeStep + 1 : 9
      await zensApp.screenplay.approveStep({
        projectId: routeProjectId,
        stepNumber: activeStep,
        nextStep,
        surgeryDecisions: activeStep === 8 ? surgeryDecisions : undefined,
      })

      if (activeStep === 7 || activeStep === 8) {
        try {
          await zensApp.screenplay.finalizeToScriptTask({
            projectId: routeProjectId,
          })
        } catch (e) {
          console.warn('[workbench] finalize-to-script-task failed:', e)
        }
      }

      if (nextStep <= 8) {
        setActiveStep(nextStep)
        setStreamText('')
        setSelfcheckResult(null)
        loadProject(true)
      } else {
        setActiveStep(8)
        setStreamText('')
        setSelfcheckResult(null)
        loadProject(true)
      }
    } catch (err) {
      setError('通过失败: ' + (err.message || err))
    }
  }

  /**
   * 回滚到指定步骤
   */
  const handleRollback = async (targetStep) => {
    if (!confirm(`确定要回滚到 Step ${targetStep} 吗？后续步骤的数据将丢失。`)) return
    try {
      await zensApp.screenplay.rollbackTo({
        projectId: routeProjectId,
        targetStep,
      })
      setActiveStep(targetStep)
      setStreamText('')
      setSelfcheckResult(null)
      loadProject(true)
    } catch (err) {
      setError('回滚失败: ' + (err.message || err))
    }
  }

  /**
   * 选择 premise（Step 1 专用）
   */
  const handleSelectPremise = async (selectionId) => {
    try {
      await zensApp.screenplay.setStepSelection({
        projectId: routeProjectId,
        stepNumber: 1,
        selectionId,
      })
      loadProject(true)
    } catch (err) {
      setError('选择失败: ' + (err.message || err))
    }
  }

  /**
   * 更新项目时长
   * ⏱ 在工作流中随时调整目标时长，影响后续步骤规划
   */
  const handleDurationChange = async (newDur) => {
    const dur = Number(newDur)
    if (!dur) return
    setEditingDuration(false)
    try {
      await zensApp.screenplay.updateDuration({
        projectId: routeProjectId,
        duration: dur,
      })
      loadProject(true)
    } catch (err) {
      setError('更新时长失败: ' + (err.message || err))
    }
  }

  /**
   * 切换步骤时清空流式文本和自检结果
   */
  const handleStepClick = (stepNum) => {
    if (stepNum === activeStep) return
    setActiveStep(stepNum)
    setStreamText('')
    setSelfcheckResult(null)
    setError(null)
  }

  /**
   * 获取当前步骤的数据
   * 🔧 从 doneSteps 和 versions 推导步骤状态
   */
  const getStepData = () => {
    if (!project?.steps) return null
    const stepBucket = project.steps[activeStep] || project.steps[String(activeStep)] || null
    if (!stepBucket) return null
    const activeVersion = stepBucket.versions?.find(v => v.isActive) ?? stepBucket.versions?.[stepBucket.versions.length - 1]
    const isApproved = project.doneSteps?.includes(activeStep) || project.doneSteps?.includes(String(activeStep))
    return {
      ...stepBucket,
      structured: activeVersion?.structured,
      output: activeVersion?.output,
      status: isApproved ? 'approved' : (activeVersion ? 'generated' : 'empty'),
    }
  }

  const stepData = getStepData()
  const isStepDone = stepData?.status === 'approved' || stepData?.status === 'generated'
  const isStepApproved = stepData?.status === 'approved'
  const currentStepFromServer = project?.currentStep || 1

  /**
   * 获取左侧步骤列表的显示状态
   */
  const getStepStatus = (stepNum) => {
    if (!project?.steps) return 'empty'
    const bucket = project.steps[stepNum] || project.steps[String(stepNum)]
    const isApproved = project.doneSteps?.includes(stepNum) || project.doneSteps?.includes(String(stepNum))
    if (isApproved) return 'approved'
    if (bucket?.versions?.length > 0) return 'generated'
    return 'empty'
  }

  if (!routeProjectId) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">🎬</div>
        <p>请从首页选择一个项目，或创建新项目</p>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
          🏠 返回首页
        </button>
      </div>
    )
  }

  if (loading && !project) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="loading-spinner" style={{ width: 32, height: 32 }} />
        <p style={{ marginTop: 12 }}>加载项目中...</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} className="fade-in">
      {/* 顶部信息栏 */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              {project?.init?.name || project?.concept || project?.projectName || '加载中...'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              ID: {routeProjectId}
              {editingDuration ? (
                <select
                  className="form-input"
                  value={project?.init?.duration || 180}
                  onChange={(e) => handleDurationChange(e.target.value)}
                  onBlur={() => setEditingDuration(false)}
                  autoFocus
                  style={{ fontSize: 12, padding: '2px 4px', width: 110 }}
                >
                  <option value={30}>⏱ 30 秒</option>
                  <option value={60}>⏱ 1 分钟</option>
                  <option value={120}>⏱ 2 分钟</option>
                  <option value={180}>⏱ 3 分钟</option>
                  <option value={300}>⏱ 5 分钟</option>
                  <option value={480}>⏱ 8 分钟</option>
                  <option value={600}>⏱ 10 分钟</option>
                </select>
              ) : (
                <span
                  onClick={() => setEditingDuration(true)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px dashed var(--text-secondary)',
                    transition: 'color 0.2s',
                  }}
                  title="点击修改目标时长"
                >
                  ⏱ {project?.init?.duration ? `${project.init.duration}s` : '未设置'}
                </span>
              )}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← 返回
          </button>
        </div>

        {/* 步骤进度条 */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
          {STEPS.map(s => {
            const sStatus = getStepStatus(s.num)
            const isComplete = sStatus === 'approved'
            const isCurrent = s.num === activeStep
            return (
              <div
                key={s.num}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: isComplete ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.3s',
                }}
                title={`Step ${s.num}: ${s.label}`}
              />
            )
          })}
        </div>
      </div>

      {/* 主体区域：左侧步骤列表 + 右侧内容 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧步骤列表 */}
        <div style={{
          width: 220,
          minWidth: 220,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-card)',
          overflowY: 'auto',
          padding: '12px 0',
        }}>
          {STEPS.map(s => {
            const sStatus = getStepStatus(s.num)
            const isComplete = sStatus === 'approved'
            const isGenerated = sStatus === 'generated'
            const isActive = s.num === activeStep
            const isLocked = s.num > currentStepFromServer + 1 && !isComplete && !isGenerated

            return (
              <div
                key={s.num}
                onClick={() => !isLocked && handleStepClick(s.num)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.4 : 1,
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}>
                    Step {s.num}: {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {isComplete ? '✅ 已通过' : isGenerated ? '📝 已生成' : s.num < currentStepFromServer ? '⏭️ 跳过' : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 右侧内容区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
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

          {/* 当前步骤标题 */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600 }}>
              {STEPS[Math.min(activeStep, 8) - 1].icon} Step {activeStep}: {STEPS[Math.min(activeStep, 8) - 1].label}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              {STEPS[Math.min(activeStep, 8) - 1].desc}
            </p>
          </div>

          {/* 状态1: 未生成 → 显示生成按钮 */}
          {!isStepDone && !generating && !streamText && (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <div className="empty-state-icon">{STEPS[activeStep - 1].icon}</div>
              <p style={{ marginBottom: 16, fontSize: 15 }}>
                还没有生成这一步的内容
              </p>
              <button
                className="btn btn-primary"
                onClick={() => handleGenerate()}
                disabled={activeStep > currentStepFromServer + 1}
              >
                🚀 开始生成
              </button>
              {activeStep > currentStepFromServer + 1 && (
                <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>
                  ⚠️ 请先完成前面的步骤
                </p>
              )}
            </div>
          )}

          {/* 状态2: 生成中 → 显示流式输出 */}
          {generating && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                <span style={{ color: 'var(--accent)', fontSize: 13 }}>正在生成中...</span>
              </div>
              <div className="stream-output">
                {streamText || '等待输出...'}
                <span style={{ animation: 'blink 1s infinite' }}>▌</span>
              </div>
            </div>
          )}

          {/* 状态3: 已生成 → 显示结构化内容 + 操作按钮 + 交互输入框 */}
          {isStepDone && !generating && (
            <div>
              <StepContent
                stepNumber={activeStep}
                stepData={stepData}
                project={project}
                onSelectPremise={handleSelectPremise}
                surgeryDecisions={surgeryDecisions}
                onSurgeryDecision={(sid, decision) => {
                  setSurgeryDecisions(prev => ({ ...prev, [sid]: decision }))
                }}
              />

              {selfcheckResult && (
                <SelfcheckDisplay result={selfcheckResult} />
              )}

              {/* 操作按钮 */}
              <div style={{
                display: 'flex',
                gap: 8,
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}>
                <button
                  className="btn btn-ghost"
                  onClick={handleSelfcheck}
                  disabled={selfchecking}
                >
                  {selfchecking ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> 自检中...</> : '🔍 自检'}
                </button>

                {!isStepApproved && activeStep <= 8 && (
                  <button className="btn btn-success" onClick={handleApprove}>
                    ✅ 通过并进入下一步
                  </button>
                )}

                <button className="btn btn-ghost" onClick={() => handleGenerate()} disabled={generating}>
                  🔄 重新生成
                </button>

                {activeStep > 1 && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => handleRollback(activeStep)}>
                    ⏪ 回滚到此步
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 💬 交互输入框：始终显示（生成中也可用），让用户随时给 AI 下指令 */}
          {!generating && (
            <div style={{
              marginTop: 16,
              padding: 16,
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                💬 给 AI 下指令（修改建议、补充要求等）
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  value={userFeedback}
                  onChange={(e) => setUserFeedback(e.target.value)}
                  placeholder="比如：把主角改成女性、增加一个反转结局、节奏再紧凑一点..."
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && userFeedback.trim()) {
                      e.preventDefault()
                      handleGenerate(userFeedback.trim())
                    }
                  }}
                  disabled={generating}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => handleGenerate(userFeedback.trim())}
                  disabled={generating || !userFeedback.trim()}
                >
                  🚀 发送
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
 * StepContent - 根据步骤号渲染不同的结构化内容
 */
function StepContent({ stepNumber, stepData, project, onSelectPremise, surgeryDecisions, onSurgeryDecision }) {
  const structured = stepData?.structured || stepData?.output || stepData?.raw

  if (!structured) {
    return (
      <div className="card" style={{ color: 'var(--text-secondary)' }}>
        暂无结构化数据（原始输出可能还在解析中）
      </div>
    )
  }

  switch (stepNumber) {
    case 1:
      return <Step1Content structured={structured} project={project} onSelect={onSelectPremise} />
    case 2:
      return <StepTextContent structured={structured} label="梗概" />
    case 3:
      return <Step3Content structured={structured} />
    case 4:
      return <StepTextContent structured={structured} label="背景" />
    case 5:
      return <Step5Content structured={structured} />
    case 6:
      return <Step6Content structured={structured} />
    case 7:
      return <Step7Content structured={structured} />
    case 8:
      return <Step8Content structured={structured} surgeryDecisions={surgeryDecisions} onSurgeryDecision={onSurgeryDecision} />
    default:
      return <StepTextContent structured={structured} label={`Step ${stepNumber}`} />
  }
}

/**
 * Step 1 破题 - 显示多个 premise 选项
 */
function Step1Content({ structured, project, onSelect }) {
  const premises = structured?.premises || structured?.options || []
  const selectedId = project?.selections?.['1'] || project?.selections?.[1]

  if (premises.length === 0) {
    return <StepTextContent structured={structured} label="破题" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>
        💡 选择一个你喜欢的 premise，然后点击"通过"进入下一步
      </p>
      {premises.map((p, i) => {
        const id = p.id || `premise_${i}`
        const isSelected = selectedId === id || (!selectedId && i === 0)
        return (
          <div
            key={id}
            className="card"
            style={{
              cursor: 'pointer',
              borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
              background: isSelected ? 'var(--accent-dim)' : 'var(--bg-card)',
            }}
            onClick={() => onSelect?.(id)}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: isSelected ? '6px solid var(--accent)' : '2px solid var(--border)',
                flexShrink: 0,
                marginTop: 2,
                transition: 'all 0.2s',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Premise {i + 1}
                  {isSelected && <span className="badge badge-accent" style={{ marginLeft: 8 }}>已选</span>}
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {p.title && <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>{p.title}</div>}
                  {p.description || p.text || p.content || JSON.stringify(p, null, 2)}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Step 3 人物 - 显示详细角色卡片 🎴
 * 🎨 外貌特征放在最上面最显眼的位置，因为这是后续 AI 文生图/视频生成的关键
 */
function Step3Content({ structured }) {
  const characters = structured?.characters || structured?.roles || []

  if (characters.length === 0) {
    return <StepTextContent structured={structured} label="人物" />
  }

  // 排序：主角在前 → 配角 → 反派
  const roleOrder = { '主角': 1, '配角': 2, '反派': 3 }
  const sorted = [...characters].sort((a, b) => (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sorted.map((c) => (
        <CharacterCard key={c.id || c.name} character={c} />
      ))}
    </div>
  )
}

/**
 * 单张角色卡片 🃏
 * 布局顺序：外貌（最重要！）→ 内在 → 背景 → 语言
 */
function CharacterCard({ character: c }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const roleColorMap = {
    '主角': { bg: 'var(--accent-dim)', text: 'var(--accent)', border: 'var(--accent)', icon: '🌟' },
    '配角': { bg: 'var(--bg-primary)', text: 'var(--text-secondary)', border: 'var(--border)', icon: '👤' },
    '反派': { bg: 'var(--error-dim)', text: 'var(--error)', border: 'var(--error)', icon: '💀' },
  }
  const roleStyle = roleColorMap[c.role] || roleColorMap['配角']

  const hasAppearance = c.gender || c.age || c.height || c.build || c.face || c.hair || c.clothing || c.specialMark || c.appearanceSummary
  const hasInner = c.personality || c.contradiction || c.want || c.need || c.arc
  const hasBackground = c.background
  const hasLinguistics = c.linguistics?.catchphrase || c.linguistics?.gesture || c.linguistics?.voice || (c.linguistics?.freqWords?.length > 0)

  const copyAppearance = () => {
    if (c.appearanceSummary) {
      navigator.clipboard.writeText(c.appearanceSummary).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="card" style={{ borderLeft: `4px solid ${roleStyle.border}`, overflow: 'hidden' }}>
      {/* 头部：名字 + 角色标签 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: roleStyle.bg, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0,
        }}>
          {roleStyle.icon}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name || '未命名'}</h4>
            <span className="badge" style={{
              background: roleStyle.bg, color: roleStyle.text,
              fontWeight: 600, fontSize: 12,
            }}>
              {roleStyle.icon} {c.role || '未知'}
            </span>
            {c.gender && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.gender === '男' ? '♂️' : '♀️'} {c.gender}</span>}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 3, flexWrap: 'wrap' }}>
            {c.age && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🎂 {c.age}</span>}
            {c.height && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>📏 {c.height}</span>}
            {c.build && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>💪 {c.build}</span>}
          </div>
        </div>
      </div>

      {/* 🎨 外貌特征（最重要！放最前面） */}
      {hasAppearance && (
        <div style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(59,130,246,0.05) 100%)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--accent)',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
            🎨 外貌特征（文生图关键）
          </div>

          {/* 文生图摘要 - 高亮展示 */}
          {c.appearanceSummary && (
            <div style={{
              padding: '10px 14px',
              background: 'var(--accent-dim)',
              borderRadius: 'var(--radius)',
              border: '1px dashed var(--accent)',
              marginBottom: 10,
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                  🖼️ 文生图 Prompt
                </span>
                <button
                  onClick={copyAppearance}
                  style={{
                    padding: '2px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--accent)',
                    background: copied ? 'var(--success)' : 'transparent',
                    color: copied ? '#fff' : 'var(--accent)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {copied ? '✅ 已复制' : '📋 复制'}
                </button>
              </div>
              <p style={{
                margin: 0, fontSize: 13, color: 'var(--text-primary)',
                lineHeight: 1.7, fontStyle: 'italic',
              }}>
                {c.appearanceSummary}
              </p>
            </div>
          )}

          {/* 外貌字段明细 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {c.face && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0, fontWeight: 500 }}>面容</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{c.face}</span>
              </div>
            )}
            {c.hair && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0, fontWeight: 500 }}>发型</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.hair}</span>
              </div>
            )}
            {c.clothing && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0, fontWeight: 500 }}>衣着</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.clothing}</span>
              </div>
            )}
            {c.specialMark && c.specialMark !== '无' && c.specialMark !== '无明显特征' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0, fontWeight: 500 }}>标志</span>
                <span style={{ fontSize: 13, color: 'var(--warning)' }}>⚠️ {c.specialMark}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🧠 内在特质 */}
      {hasInner && (
        <div style={{ marginBottom: 10 }}>
          {c.personality && (
            <div style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>🧠 性格：</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.personality}</span>
            </div>
          )}
          {c.contradiction && (
            <div style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>⚡ 矛盾：</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.contradiction}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 2 }}>
            {c.want && (
              <div>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>想要 → </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.want}</span>
              </div>
            )}
            {c.need && (
              <div>
                <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>需要 → </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.need}</span>
              </div>
            )}
          </div>
          {c.arc && (
            <div style={{ marginTop: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>📈 弧光：</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.arc}</span>
            </div>
          )}
        </div>
      )}

      {/* 📖 背景故事（可折叠） */}
      {hasBackground && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setExpanded(!expanded)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>📖 背景故事</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              ▶
            </span>
          </div>
          {expanded && (
            <p style={{
              margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)',
              lineHeight: 1.7, padding: '8px 12px',
              background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              {c.background}
            </p>
          )}
        </div>
      )}

      {/* 🗣️ 语言特征 */}
      {hasLinguistics && (
        <div style={{
          padding: '10px 14px',
          background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
            🗣️ 语言特征
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {c.linguistics?.catchphrase && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>口头禅</span>
                <span style={{ fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>"{c.linguistics.catchphrase}"</span>
              </div>
            )}
            {c.linguistics?.gesture && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>动作</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.linguistics.gesture}</span>
              </div>
            )}
            {c.linguistics?.voice && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>声音</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.linguistics.voice}</span>
              </div>
            )}
            {c.linguistics?.freqWords?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>高频词</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {c.linguistics.freqWords.map((w, j) => (
                    <span key={j} style={{
                      padding: '1px 8px', borderRadius: 'var(--radius)',
                      background: 'var(--accent-dim)', color: 'var(--accent)',
                      fontSize: 11, fontWeight: 500,
                    }}>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 兜底 */}
      {!hasAppearance && !hasInner && !hasBackground && !hasLinguistics && c.description && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {c.description}
        </p>
      )}
    </div>
  )
}

/**
 * Step 5 结构 - 显示四幕结构
 */
function Step5Content({ structured }) {
  const acts = structured?.acts || structured?.structure || []

  if (acts.length === 0) {
    return <StepTextContent structured={structured} label="结构" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {acts.map((act, i) => (
        <div key={i} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              padding: '2px 10px',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              fontWeight: 600,
            }}>
              第{['一', '二', '三', '四'][i] || i + 1}幕
            </span>
            <h4 style={{ margin: 0, fontSize: 15 }}>{act.title || act.name || `Act ${i + 1}`}</h4>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            {act.description || act.content || act.summary || ''}
          </p>
          {act.percentage && (
            <div style={{ marginTop: 8 }}>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${act.percentage}%` }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{act.percentage}%</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Step 6 场次 - 显示场景列表
 */
function Step6Content({ structured }) {
  const scenes = structured?.scenes || structured?.sceneList || []

  if (scenes.length === 0) {
    return <StepTextContent structured={structured} label="场次" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {scenes.map((scene, i) => (
        <div key={i} className="card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              padding: '2px 8px',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              fontWeight: 600,
              minWidth: 60,
              textAlign: 'center',
            }}>
              场{i + 1}
            </span>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{scene.title || scene.name || `场景 ${i + 1}`}</span>
              {scene.location && (
                <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 8 }}>📍 {scene.location}</span>
              )}
            </div>
            {scene.duration && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏱ {scene.duration}s</span>
            )}
          </div>
          {scene.description && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 0 70px', lineHeight: 1.5 }}>
              {scene.description}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Step 7 写作 - 显示剧本正文
 */
function Step7Content({ structured }) {
  const body = structured?.body || structured?.content || structured?.script || structured?.text || ''

  if (!body) {
    return <StepTextContent structured={structured} label="剧本正文" />
  }

  return (
    <div className="stream-output" style={{ maxHeight: 600 }}>
      {body}
    </div>
  )
}

/**
 * Step 8 医生 - 显示诊断报告
 * 🩺 完整渲染: 总分/结论 + 维度评分 + 问题列表 + 手术建议 + 修改路径
 */
function Step8Content({ structured, surgeryDecisions = {}, onSurgeryDecision }) {
  const totalScore = structured?.totalScore ?? structured?.score ?? null
  const verdict = structured?.verdict || structured?.conclusion || ''
  const dimensions = structured?.dimensions || []
  const issues = structured?.issues || structured?.diagnoses || []
  const surgery = structured?.surgery || []
  const revisionPath = structured?.revisionPath || []

  const verdictColor = verdict.includes('通过') ? 'var(--success)'
    : verdict.includes('重写') ? 'var(--error)'
    : 'var(--warning)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 🏆 总分 + 结论 */}
      {(totalScore !== null || verdict) && (
        <div className="card" style={{
          background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--accent-dim) 100%)',
          borderColor: 'var(--accent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {totalScore !== null && (
              <div style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                border: `3px solid ${totalScore >= 80 ? 'var(--success)' : totalScore >= 60 ? 'var(--warning)' : 'var(--error)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: totalScore >= 80 ? 'var(--success)' : totalScore >= 60 ? 'var(--warning)' : 'var(--error)',
                  lineHeight: 1,
                }}>
                  {totalScore}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>分</span>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 16 }}>📋 诊断结论</h4>
              {verdict && (
                <span style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: 'var(--radius)',
                  background: verdictColor,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                }}>
                  {verdict}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 📊 维度评分 */}
      {dimensions.length > 0 && (
        <div className="card">
          <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>📊 维度评分</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dimensions.map((dim, i) => {
              const score = dim.score ?? 0
              const barColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--error)'
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{dim.name || `维度 ${i + 1}`}</span>
                    <span style={{ fontSize: 13, color: barColor, fontWeight: 600 }}>{score}</span>
                  </div>
                  <div style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--border)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(score, 100)}%`,
                      background: barColor,
                      borderRadius: 3,
                      transition: 'width 0.5s',
                    }} />
                  </div>
                  {dim.comment && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                      {dim.comment}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ⚠️ 问题列表 */}
      {issues.length > 0 && (
        <div className="card">
          <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>⚠️ 发现的问题 ({issues.length})</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {issues.map((issue, i) => {
              const isObj = typeof issue === 'object' && issue !== null
              const title = isObj ? (issue.title || issue.name || `问题 ${i + 1}`) : String(issue)
              const severity = isObj ? (issue.severity || issue.level || 'warn') : 'warn'
              const description = isObj ? issue.description : ''
              const suggestion = isObj ? issue.suggestion : ''
              const colorMap = { error: 'var(--error)', warn: 'var(--warning)', warning: 'var(--warning)', info: 'var(--accent)', pass: 'var(--success)' }
              const bgMap = { error: 'var(--error-dim)', warn: 'var(--warning-dim)', warning: 'var(--warning-dim)', info: 'var(--accent-dim)', pass: 'var(--success-dim)' }
              return (
                <div key={i} style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-primary)',
                  borderLeft: `3px solid ${colorMap[severity] || 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 8px',
                      borderRadius: 'var(--radius)',
                      background: bgMap[severity] || 'var(--bg-primary)',
                      color: colorMap[severity] || 'var(--text-secondary)',
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {severity.toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{title}</span>
                  </div>
                  {description && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>
                      {description}
                    </p>
                  )}
                  {suggestion && (
                    <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
                      💡 建议: {suggestion}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 🔪 手术建议 */}
      {surgery.length > 0 && (
        <div className="card">
          <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>
            🔪 手术建议 ({surgery.length})
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>
              💡 每条手术可单独采纳或拒绝
            </span>
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {surgery.map((s, i) => {
              const sid = s.id || String(i)
              const decision = surgeryDecisions[sid]
              const isAccepted = decision === 'accept'
              const isRejected = decision === 'reject'
              return (
                <div key={sid} style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--radius)',
                  background: isAccepted ? 'var(--success-dim)' : isRejected ? 'var(--bg-primary)' : 'var(--bg-primary)',
                  border: isAccepted ? '2px solid var(--success)' : isRejected ? '1px solid var(--border)' : '1px solid var(--border)',
                  opacity: isRejected ? 0.55 : 1,
                  transition: 'all 0.25s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{
                      background: 'var(--error-dim)',
                      color: 'var(--error)',
                      padding: '2px 10px',
                      borderRadius: 'var(--radius)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}>
                      手术 {i + 1}
                    </span>
                    {isAccepted && (
                      <span style={{
                        background: 'var(--success)',
                        color: '#fff',
                        padding: '2px 10px',
                        borderRadius: 'var(--radius)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        ✅ 已采纳
                      </span>
                    )}
                    {isRejected && (
                      <span style={{
                        background: 'var(--text-secondary)',
                        color: '#fff',
                        padding: '2px 10px',
                        borderRadius: 'var(--radius)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        ❌ 已拒绝
                      </span>
                    )}

                    {/* 采纳/拒绝按钮 */}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSurgeryDecision?.(sid, 'accept') }}
                        style={{
                          padding: '4px 14px',
                          borderRadius: 'var(--radius)',
                          border: isAccepted ? '2px solid var(--success)' : '1px solid var(--success)',
                          background: isAccepted ? 'var(--success)' : 'transparent',
                          color: isAccepted ? '#fff' : 'var(--success)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          transition: 'all 0.15s',
                        }}
                      >
                        ✅ 采纳
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSurgeryDecision?.(sid, 'reject') }}
                        style={{
                          padding: '4px 14px',
                          borderRadius: 'var(--radius)',
                          border: isRejected ? '2px solid var(--text-secondary)' : '1px solid var(--text-secondary)',
                          background: isRejected ? 'var(--text-secondary)' : 'transparent',
                          color: isRejected ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          transition: 'all 0.15s',
                        }}
                      >
                        ❌ 拒绝
                      </button>
                    </div>
                  </div>
                  {s.original && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>📝 原文：</span>
                      <div style={{
                        marginTop: 4,
                        padding: '8px 12px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius)',
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.6,
                        borderLeft: '2px solid var(--error)',
                      }}>
                        {s.original}
                      </div>
                    </div>
                  )}
                  {s.diagnosis && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>🔍 诊断：</span>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 4 }}>{s.diagnosis}</span>
                    </div>
                  )}
                  {s.rewrite && (
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✨ 重写建议：</span>
                      <div style={{
                        marginTop: 4,
                        padding: '8px 12px',
                        background: isAccepted ? 'var(--success-dim)' : 'var(--bg-card)',
                        borderRadius: 'var(--radius)',
                        fontSize: 13,
                        color: 'var(--success)',
                        lineHeight: 1.6,
                        borderLeft: isAccepted ? '2px solid var(--success)' : '2px solid var(--success)',
                        transition: 'all 0.25s',
                      }}>
                        {s.rewrite}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 🛤️ 修改路径 */}
      {revisionPath.length > 0 && (
        <div className="card">
          <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>🛤️ 修改路径</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {revisionPath.map((step, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 'var(--radius)',
                background: 'var(--bg-primary)',
              }}>
                <span style={{
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, paddingTop: 2 }}>
                  {typeof step === 'object' ? (step.title || step.text || step.description || JSON.stringify(step)) : String(step)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🔄 如果什么都没有，fallback 到通用展示 */}
      {!totalScore && !verdict && dimensions.length === 0 && issues.length === 0 && surgery.length === 0 && revisionPath.length === 0 && (
        <StepTextContent structured={structured} label="诊断报告" />
      )}
    </div>
  )
}

/**
 * 通用文本内容展示组件
 */
function StepTextContent({ structured, label }) {
  const text = typeof structured === 'string'
    ? structured
    : structured?.text || structured?.content || structured?.description || structured?.summary || ''
  const raw = !text ? JSON.stringify(structured, null, 2) : ''

  return (
    <div>
      {text && (
        <div className="card">
          <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>{label}</h4>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {text}
          </div>
        </div>
      )}
      {raw && (
        <div className="stream-output" style={{ fontSize: 12 }}>
          {raw}
        </div>
      )}
    </div>
  )
}

/**
 * 自检结果展示组件
 */
function SelfcheckDisplay({ result }) {
  const checks = result?.checks || result?.items || []
  const overall = result?.overall || result?.status || ''

  if (checks.length === 0 && !overall) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ color: 'var(--text-secondary)' }}>自检完成，无详细结果</p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 15, marginBottom: 10 }}>🔍 自检结果 {overall && (
        <span className={`badge badge-${overall === 'pass' ? 'success' : overall === 'warn' || overall === 'warning' ? 'warning' : 'error'}`}>
          {overall.toUpperCase()}
        </span>
      )}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {checks.map((check, i) => {
          const status = check.status || check.level || 'warn'
          const iconMap = { pass: '✅', warn: '⚠️', warning: '⚠️', fail: '❌', error: '❌' }
          const colorMap = { pass: 'var(--success)', warn: 'var(--warning)', warning: 'var(--warning)', fail: 'var(--error)', error: 'var(--error)' }
          return (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}>
              <span>{iconMap[status] || '❓'}</span>
              <div style={{ flex: 1 }}>
                <span style={{ color: colorMap[status] || 'var(--text-secondary)', fontWeight: 500, fontSize: 13 }}>
                  {check.name || check.title || `检查项 ${i + 1}`}
                </span>
                {check.message && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '2px 0 0', lineHeight: 1.5 }}>
                    {check.message}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
