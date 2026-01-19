import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Session } from './pages/Session'

/**
 * PathCollab App - Viewer-First UX
 *
 * The viewer IS the landing page. No intermediate steps to view a slide.
 * - "/" → Viewer with default slide
 * - "/s/:id" → Viewer with specific session
 */
function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Session />} />
          <Route path="/s/:id" element={<Session />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
