import { Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <h1 className="header-title">SHLF Trace Dashboard</h1>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
