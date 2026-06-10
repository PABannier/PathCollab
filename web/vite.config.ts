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
  // The fovea engine ships a wasm-bindgen module that loads its .wasm via
  // `new URL('...wasm', import.meta.url)`. Vite emits that as an asset natively;
  // we exclude the package from dep pre-bundling so the URL resolution is kept.
  optimizeDeps: {
    exclude: ['@fovea/viewer'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    // @fovea/viewer is a file: dependency symlinked to ../vendor/fovea (outside
    // web/), so its wasm-bindgen .wasm lives outside the project root. Allow the
    // dev server to serve it; without this Vite 403s the wasm and the engine
    // never initializes (the viewer hangs on "Loading slide…").
    fs: {
      allow: ['..'],
    },
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
