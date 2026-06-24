import React, { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CATEGORIES,
  getAllInspirations,
  getInspirationsByCategory,
  searchInspirations,
  getInspirationCountByCategory,
  DIFFICULTY_MAP,
} from '../data/inspirations'
import { zensApp } from '../lib/zensApp'

/**
 * Inspiration 灵感页面
 *
 * 灵感工坊——浏览各种题材的剧本灵感，找到打动你的故事核，
 * 一键「使用此灵感」就能跳到剧本创作页面开始创作！
 *
 * 支持按13个影视分类筛选、关键词搜索、收藏灵感
 */
export default function Inspiration() {
  const navigate = useNavigate()

  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [detailItem, setDetailItem] = useState(null)
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('inspiration_favorites') || '[]')
    } catch {
      return []
    }
  })

  const [inspDuration, setInspDuration] = useState(180)

  const categoryCounts = useMemo(() => getInspirationCountByCategory(), [])

  const filteredItems = useMemo(() => {
    let items = getInspirationsByCategory(activeCategory)
    if (searchQuery.trim()) {
      items = items.filter(
        item =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    }
    return items
  }, [activeCategory, searchQuery])

  const toggleFavorite = useCallback(
    id => {
      setFavorites(prev => {
        const next = prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
        localStorage.setItem('inspiration_favorites', JSON.stringify(next))
        return next
      })
    },
    [],
  )

  const handleUseInspiration = useCallback(
    async (item, customDuration) => {
      const dur = customDuration ?? inspDuration
      setDetailItem(null)
      try {
        const project = await zensApp.screenplay.createProject({
          name: item.title,
          concept: item.summary,
          duration: dur,
        })
        if (project?.projectId) {
          navigate(`/screenplay/${project.projectId}`)
        }
      } catch (err) {
        alert('创建项目失败: ' + (err.message || err))
      }
    },
    [navigate, inspDuration],
  )

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter' && searchQuery.trim()) {
        const first = filteredItems[0]
        if (first) setDetailItem(first)
      }
    },
    [searchQuery, filteredItems],
  )

  const activeCategoryData = CATEGORIES.find(c => c.key === activeCategory)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }} className="fade-in">
      {/* 顶部标题 */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
          💡 灵感工坊
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 13 }}>
          87个故事核，随便翻翻，总有一个让你「卧槽这个我想拍！」🔥
        </p>
      </div>

      {/* 搜索栏 */}
      <div style={{ marginBottom: 16, position: 'relative' }}>
        <input
          className="form-input"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="🔍  搜索灵感标题、描述或标签..."
          style={{
            paddingLeft: 40,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 14,
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 16,
            pointerEvents: 'none',
            opacity: searchQuery ? 1 : 0.4,
          }}
        >
          🔍
        </span>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
              fontSize: 16,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* 分类Tab栏 */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 8,
          marginBottom: 20,
          scrollbarWidth: 'thin',
        }}
      >
        {CATEGORIES.map(cat => {
          const isActive = cat.key === activeCategory
          const count = categoryCounts[cat.key] || 0
          return (
            <button
              key={cat.key}
              onClick={() => {
                setActiveCategory(cat.key)
                setSearchQuery('')
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '8px 14px',
                borderRadius: 20,
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#f0eef4' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent)' : 'var(--bg-card)',
                border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                transition: 'all 0.15s',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 14 }}>{cat.icon}</span>
              <span>{cat.label}</span>
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.7,
                  marginLeft: 2,
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* 当前分类信息 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        <span>
          {activeCategoryData?.icon} {activeCategoryData?.label}
          {searchQuery ? ` · 搜索「${searchQuery}」` : ''}
          {' · '}
          共 {filteredItems.length} 条
        </span>
        {favorites.length > 0 && (
          <button
            onClick={() => {
              setActiveCategory('all')
              setSearchQuery('')
              setActiveCategory('__fav__')
            }}
            style={{ color: 'var(--warning)', fontSize: 13 }}
          >
            ⭐ 我的收藏 ({favorites.length})
          </button>
        )}
      </div>

      {/* 收藏筛选标记 */}
      {activeCategory === '__fav__' && (
        <div
          style={{
            background: 'var(--warning-dim)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius)',
            padding: '10px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--warning)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          ⭐ 正在显示收藏的灵感 · 共 {filteredItems.length} 条
          <button
            onClick={() => setActiveCategory('all')}
            style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 12 }}
          >
            返回全部
          </button>
        </div>
      )}

      {/* 卡片网格 */}
      {filteredItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <p style={{ fontSize: 15, marginBottom: 6 }}>没有找到匹配的灵感</p>
          <p style={{ fontSize: 13 }}>试试换个关键词或切换分类~</p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 14,
          }}
        >
          {filteredItems.map(item => {
            const diff = DIFFICULTY_MAP[item.difficulty] || DIFFICULTY_MAP[1]
            const isFav = favorites.includes(item.id)
            const catInfo = CATEGORIES.find(c => c.key === item.category)
            return (
              <div
                key={item.id}
                className="card"
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.2s',
                  border: isFav ? '1px solid rgba(251,191,36,0.3)' : '1px solid var(--border)',
                }}
                onClick={() => setDetailItem(item)}
              >
                {/* 卡片头部：分类 + 收藏 + 难度 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-primary)',
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}
                  >
                    {catInfo?.icon} {catInfo?.label}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: diff.color }}>{diff.stars}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        toggleFavorite(item.id)
                      }}
                      style={{
                        fontSize: 16,
                        transition: 'transform 0.2s',
                        transform: isFav ? 'scale(1.2)' : 'scale(1)',
                      }}
                      title={isFav ? '取消收藏' : '收藏'}
                    >
                      {isFav ? '⭐' : '☆'}
                    </button>
                  </div>
                </div>

                {/* 标题 */}
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: '0 0 8px',
                    lineHeight: 1.4,
                    color: 'var(--text-primary)',
                  }}
                >
                  {item.title}
                </h3>

                {/* 描述摘要 */}
                <p
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    margin: '0 0 12px',
                    flex: 1,
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.summary}
                </p>

                {/* 标签 */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.tags.map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10.5,
                        padding: '1px 8px',
                        borderRadius: 10,
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                        border: '1px solid rgba(124,92,252,0.2)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 底部操作 */}
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={e => {
                      e.stopPropagation()
                      handleUseInspiration(item)
                    }}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    🚀 使用此灵感
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={e => {
                      e.stopPropagation()
                      setDetailItem(item)
                    }}
                    style={{ fontSize: 12 }}
                  >
                    📖 查看详情
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailItem && (() => {
        const diff = DIFFICULTY_MAP[detailItem.difficulty] || DIFFICULTY_MAP[1]
        const catInfo = CATEGORIES.find(c => c.key === detailItem.category)
        const isFav = favorites.includes(detailItem.id)
        return (
          <div className="modal-overlay" onClick={() => setDetailItem(null)}>
            <div
              className="modal-content"
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 560 }}
            >
              {/* 顶部标签 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 12,
                      padding: '4px 10px',
                      borderRadius: 12,
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                    }}
                  >
                    {catInfo?.icon} {catInfo?.label}
                  </span>
                  <span style={{ fontSize: 12, color: diff.color }}>
                    {diff.stars} {diff.label}
                  </span>
                </div>
                <button
                  onClick={() => {
                    toggleFavorite(detailItem.id)
                  }}
                  style={{ fontSize: 20, transition: 'transform 0.2s' }}
                >
                  {isFav ? '⭐' : '☆'}
                </button>
              </div>

              {/* 标题 */}
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 16px', lineHeight: 1.4 }}>
                {detailItem.title}
              </h2>

              {/* 开场建议 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    marginBottom: 8,
                  }}
                >
                  🎬 建议开场
                </div>
                <div
                  style={{
                    background: 'var(--accent-dim)',
                    borderRadius: 'var(--radius)',
                    padding: '12px 16px',
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(124,92,252,0.2)',
                    fontStyle: 'italic',
                  }}
                >
                  {detailItem.openingHook}
                </div>
              </div>

              {/* 完整故事提案 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    marginBottom: 8,
                  }}
                >
                  📖 故事提案
                </div>
                <div
                  style={{
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius)',
                    padding: '16px 18px',
                    fontSize: 14,
                    lineHeight: 1.9,
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {detailItem.detail}
                </div>
              </div>

              {/* 标签 */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                {detailItem.tags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 12,
                      padding: '3px 10px',
                      borderRadius: 12,
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      border: '1px solid rgba(124,92,252,0.2)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* 时长选择 */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  ⏱ 目标时长
                </label>
                <select
                  className="form-input"
                  value={inspDuration}
                  onChange={e => setInspDuration(Number(e.target.value))}
                  style={{ width: '100%' }}
                >
                  <option value={30}>30 秒</option>
                  <option value={60}>1 分钟</option>
                  <option value={120}>2 分钟</option>
                  <option value={180}>3 分钟</option>
                  <option value={300}>5 分钟</option>
                  <option value={480}>8 分钟</option>
                  <option value={600}>10 分钟</option>
                </select>
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleUseInspiration(detailItem)}
                  style={{ flex: 1 }}
                >
                  🚀 使用此灵感，开始创作！
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setDetailItem(null)}
                >
                  关闭
                </button>
              </div>

              {/* 小提示 */}
              <p
                style={{
                  marginTop: 14,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                💡 点击左侧导航栏的「剧本创作」可以看到你刚创建的项目
              </p>
            </div>
          </div>
        )
      })()}

      {/* 底部提示 */}
      {filteredItems.length > 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 0 16px',
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          以上灵感由 AI 生成，仅供创意参考 🎲 · 共计 87 条灵感等你发现~
        </div>
      )}
    </div>
  )
}