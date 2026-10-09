import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const renderer = (path: string) => fileURLToPath(new URL(`./src/renderer/${path}`, import.meta.url))

// The settings window and the main window's top bar are served from the app
// bundle through the privileged `teler-desktop://app/` protocol, so every
// asset path stays relative.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: {
      input: { index: renderer('index.html'), 'title-bar': renderer('title-bar.html') },
    },
    // Packaged builds load local files only; keep source maps out of them.
    sourcemap: false,
    // One local bundle loaded from disk: chunk size has no network cost here.
    chunkSizeWarningLimit: 1024,
  },
})
