import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { completeSignIn } from './auth.ts'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void completeSignIn(location.href).then(
      (path) => {
        if (!cancelled) void navigate(path, { replace: true })
      },
      (reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Sign-in failed.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [navigate])
  return (
    <main className="forum-page">
      <h1>Sign in</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <Link to="/forum">Return to Forum</Link>
        </>
      ) : (
        <p>Completing sign-in…</p>
      )}
    </main>
  )
}
