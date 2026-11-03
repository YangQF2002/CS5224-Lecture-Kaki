import { useEffect, useRef, useState } from 'react'
import { getAccessToken, subscribeToSignOut } from './auth.ts'
// prettier-ignore
import { ForumApiError, needsSignIn, postMessage, type MessageOut } from './forumApi.ts'
import { uploadPdf, validatePdf } from './forumPdf.ts'
import { readDraft, saveDraft } from './roomSession.ts'
import PdfAttachment from './PdfAttachment.tsx'

const MAX_CONTENT = 500

type Props = {
  roomId: string
  disabled: boolean
  error: string
  onError: (message: string) => void
  onSignInRequired: () => void
  onSent: (message: MessageOut) => void
}

export default function ForumComposer({
  roomId,
  disabled,
  error,
  onError,
  onSignInRequired,
  onSent,
}: Props) {
  const [content, setContent] = useState(() => readDraft(roomId))
  const [pdf, setPdf] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState<string>()
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const request = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const characterCount = Array.from(content).length
  const composerDisabled = disabled || sending
  const canSend =
    !composerDisabled &&
    (!!content.trim() || !!pdf) &&
    characterCount <= MAX_CONTENT

  useEffect(() => {
    function cancel() {
      request.current?.abort()
      request.current = null
    }
    const stopSignOut = subscribeToSignOut(cancel)
    return () => {
      cancel()
      stopSignOut()
    }
  }, [])

  function selectPdf(file: File | null) {
    setPdf(file)
    setUploadId(undefined)
    if (!file && fileInput.current) fileInput.current.value = ''
  }

  async function send() {
    if (!canSend || request.current) return
    const controller = new AbortController()
    request.current = controller
    setSending(true)
    onError('')
    try {
      const attachmentId = pdf
        ? await uploadPdf(
            roomId,
            pdf,
            getAccessToken,
            controller.signal,
            (value) => {
              if (!controller.signal.aborted) setStatus(value)
            },
            (id) => {
              if (!controller.signal.aborted) setUploadId(id)
            },
            uploadId,
          )
        : undefined
      controller.signal.throwIfAborted()
      setStatus('')
      const message = await postMessage(
        roomId,
        content.trim(),
        getAccessToken,
        attachmentId,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      if (readDraft(roomId) === content) saveDraft(roomId, '')
      setContent('')
      selectPdf(null)
      onSent(message)
    } catch (reason) {
      // Leaving the room or signing out must discard late upload/POST results.
      if (request.current !== controller) return
      if (needsSignIn(reason)) onSignInRequired()
      else if (controller.signal.aborted)
        onError('PDF upload cancelled. Your draft is kept.')
      else {
        if (reason instanceof ForumApiError && reason.status === 410)
          setUploadId(undefined)
        onError(
          pdf && reason instanceof Error
            ? reason.message
            : 'Failed to send. Your draft is kept; please try again.',
        )
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setSending(false)
        setStatus('')
      }
    }
  }

  return (
    <section className="panel composer">
      <label htmlFor="forum-message">Your message</label>
      <div className="composer-input-row">
        <textarea
          id="forum-message"
          value={content}
          placeholder="Write a message…"
          onChange={(event) => {
            setContent(event.target.value)
            saveDraft(roomId, event.target.value)
            onError('')
          }}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault()
              void send()
            }
          }}
          disabled={composerDisabled}
        />
        <button
          type="button"
          className="composer-attach"
          aria-label="Attach a PDF"
          title="Attach a PDF (up to 15 MB)"
          disabled={composerDisabled}
          onClick={() => fileInput.current?.click()}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        aria-label="PDF file"
        accept=".pdf,application/pdf"
        hidden
        disabled={composerDisabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          const error = file ? validatePdf(file) : ''
          onError(error)
          selectPdf(file && !error ? file : null)
        }}
      />
      {pdf && (
        <PdfAttachment
          filename={pdf.name}
          size={pdf.size}
          action="remove"
          disabled={sending}
          onAction={() => selectPdf(null)}
        />
      )}
      <p className="forum-compose-hint">Ctrl/Cmd + Enter to send.</p>
      {status && (
        <p role="status">
          {status}{' '}
          <button
            className="secondary"
            onClick={() => request.current?.abort()}
          >
            Cancel upload
          </button>
        </p>
      )}
      <div className="composer-footer">
        <span
          className={`char-count${characterCount > MAX_CONTENT ? ' over' : ''}`}
        >
          {characterCount}/{MAX_CONTENT}
        </span>
        <button onClick={() => void send()} disabled={!canSend}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
