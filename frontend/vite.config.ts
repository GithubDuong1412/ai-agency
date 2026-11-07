import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // AGENCY_API=http://127.0.0.1:8001 để chạy dev với server demo
      '/api': { target: process.env.AGENCY_API || 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
