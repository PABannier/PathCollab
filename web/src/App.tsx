import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Session } from './pages/Session'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:id" element={<Session />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
