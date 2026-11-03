import { useId, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { roomFromLink, roomPath } from './roomCatalogue.ts'

export default function ForumLayout({
  children,
  onReopen,
}: {
  children: ReactNode
  onReopen?: () => void
}) {
  const navigate = useNavigate()
  const { roomId } = useParams<{ roomId: string }>()
  const inputId = useId()
  const [sharedLink, setSharedLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [linkStatus, setLinkStatus] = useState('')

  return (
    <main className="forum-page forum-layout">
      <div className="forum-content">{children}</div>
      <aside
        className="panel forum-shared-link"
        aria-labelledby={`${inputId}-heading`}
      >
        <h2 id={`${inputId}-heading`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="m10 13 4-4m-6 7-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m2 1 1-1a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0" />
          </svg>
          Have a shared discussion link?
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setLinkStatus('')
            const id = roomFromLink(sharedLink)
            if (!id) {
              setLinkError('Enter a valid Forum discussion link or room ID.')
              return
            }
            if (id === roomId) {
              if (onReopen) onReopen()
              else setLinkStatus('This discussion is already open.')
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
              return
            }
            navigate(roomPath(id))
          }}
        >
          <label htmlFor={inputId}>
            Discussion link or room ID
            <input
              id={inputId}
              value={sharedLink}
              placeholder="Paste a discussion link…"
              autoComplete="off"
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setSharedLink(event.target.value)
                setLinkError('')
                setLinkStatus('')
              }}
              required
            />
          </label>
          <button type="submit">Open discussion</button>
          {linkStatus && <p role="status">{linkStatus}</p>}
          {linkError && (
            <p id={`${inputId}-error`} role="alert">
              {linkError}
            </p>
          )}
        </form>
      </aside>
    </main>
  )
}
