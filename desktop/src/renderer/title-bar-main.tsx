import './title-bar/title-bar.css'
import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TitleBar } from './title-bar/title-bar'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root container')

const api = window.telerTitleBar
if (!api) throw new Error('Teler title bar bridge is unavailable')

createRoot(container).render(
  <StrictMode>
    <TitleBar api={api} />
  </StrictMode>
)
