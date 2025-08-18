import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// If tenants were imported via file input, persist them to localStorage before app mounts
const imported = (window as unknown as { __TENANTS__?: unknown }).__TENANTS__
const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
if (!isDev && Array.isArray(imported) && imported.length) {
  try {
    localStorage.setItem('tenantData', JSON.stringify(imported))
    localStorage.setItem('tenantDataSource', 'uploaded')
  } catch {}
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
