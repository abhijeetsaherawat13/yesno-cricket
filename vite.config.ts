import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    proxy: {
      '/api': {
        target: process.env.VITE_GATEWAY_PROXY_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_GATEWAY_PROXY_TARGET || 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
