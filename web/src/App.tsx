import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Home } from './pages/Home'
import { Session } from './pages/Session'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/s/:id" element={<Session />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
