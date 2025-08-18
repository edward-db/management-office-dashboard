import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use relative paths so the app can be hosted from any subpath (e.g., GitHub Pages)
  base: './',
})
