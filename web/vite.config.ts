import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// =============================================================================
// Vite Configuration for PathCollab Frontend
// =============================================================================
//
// CANONICAL PORTS (do not change without updating all config files):
//   - 3000: Frontend (this Vite dev server)
//   - 8080: Backend (Rust Axum server - proxied below)
//
// See also: docker-compose.yml, README.md, .env.example, server/src/config.rs
// =============================================================================

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy all API requests to the backend (including slides)
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
})
