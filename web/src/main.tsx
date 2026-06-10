import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - slide metadata rarely changes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

// NOTE: React StrictMode is intentionally NOT used. The fovea WebGPU viewer fully
// owns its <canvas>, and StrictMode's dev-only double-mount races two GPU contexts
// onto the same canvas, breaking the render loop (spinner never clears, no tiles).
// fovea's own React integration is designed to mount the canvas exactly once.
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
