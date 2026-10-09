import './styles.css'
import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { DesktopApiProvider, getDesktopBridge } from './desktop-api-context'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root container')

createRoot(container).render(
  <StrictMode>
    <DesktopApiProvider api={getDesktopBridge()}>
      <App />
    </DesktopApiProvider>
  </StrictMode>
)
