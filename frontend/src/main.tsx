import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './index.css'
import App from './App.tsx'
import DiscoverPage from './features/discovery/DiscoverPage.tsx'
import TimetablePage from './features/timetable/TimetablePage.tsx'
import ForumPage from './features/forum/ForumPage.tsx'
import ForumHome from './features/forum/ForumHome.tsx'
import AuthCallback from './features/auth/AuthCallback.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<DiscoverPage />} />
          <Route path="timetable" element={<TimetablePage />} />
          <Route path="forum" element={<ForumHome />} />
          <Route path="forum/:roomId" element={<ForumPage />} />
          <Route path="auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
