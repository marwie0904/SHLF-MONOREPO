import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TracesPage from './pages/TracesPage'
import TraceDetailPage from './pages/TraceDetailPage'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<TracesPage />} />
        <Route path="trace/:system/:traceId" element={<TraceDetailPage />} />
      </Route>
    </Routes>
  )
}

export default App
