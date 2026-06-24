import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Screenplay from './pages/Screenplay'
import Seedance from './pages/Seedance'
import Inspiration from './pages/Inspiration'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="screenplay" element={<Screenplay />} />
        <Route path="screenplay/:projectId" element={<Screenplay />} />
        <Route path="seedance" element={<Seedance />} />
        <Route path="inspiration" element={<Inspiration />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
