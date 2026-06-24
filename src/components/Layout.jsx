import React from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { zensApp } from '../lib/zensApp'

const NAV_ITEMS = [
  { path: '/', label: '首页', icon: '🏠' },
  { path: '/screenplay', label: '剧本创作', icon: '🎬' },
  { path: '/seedance', label: '分镜', icon: '🎞️' },
  { path: '/inspiration', label: '灵感', icon: '💡' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]

export default function Layout() {
  const location = useLocation()
  const [version, setVersion] = React.useState('-')

  React.useEffect(() => {
    zensApp.getAppVersion().then(v => setVersion(typeof v === 'object' ? (v.version || '-') : (v || '-'))).catch(() => {})
  }, [])

  const isHome = location.pathname === '/' || location.pathname === ''

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <nav style={{
        width: 240,
        minWidth: 240,
        background: '#1a1128',
        borderRight: '1px solid #2d2042',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #2d2042' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="logo" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, color: '#f0eef4' }}>抓耳挠腮</div>
              <div style={{ fontSize: 11, color: '#9b8fb0', letterSpacing: 2 }}>剧本制作</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, padding: '12px 12px 0' }}>
          {NAV_ITEMS.map(item => {
            const isActive = item.path === '/'
              ? isHome
              : location.pathname.startsWith(item.path)
            return (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive: navIsActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 8,
                  marginBottom: 4,
                  textDecoration: 'none',
                  color: isActive ? '#f0eef4' : '#9b8fb0',
                  background: isActive ? 'rgba(124, 92, 252, 0.15)' : 'transparent',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s',
                })}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span>{item.label}</span>
                {isActive && (
                  <div style={{
                    marginLeft: 'auto',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#7c5cfc',
                  }} />
                )}
              </NavLink>
            )
          })}
        </div>

        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid #2d2042',
          fontSize: 11,
          color: '#9b8fb0',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>v{version}</span>
          <span>{zensApp.platform === 'win32' ? '🪟' : zensApp.platform === 'darwin' ? '🍎' : '🐧'}</span>
        </div>
      </nav>

      <main style={{
        flex: 1,
        overflowY: 'auto',
        background: '#120b19',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
