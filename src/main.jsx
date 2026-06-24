import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
const root = ReactDOM.createRoot(rootEl)
root.render(
  <HashRouter>
    <App />
  </HashRouter>
)
