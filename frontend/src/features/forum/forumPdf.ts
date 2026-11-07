import { apiFetch } from './forumApi.ts'

export const MAX_PDF_BYTES = 15 * 1024 * 1024

export function validatePdf(file: File): string {
  if (
    !file.name.toLowerCase().endsWith('.pdf') ||
    (file.type && file.type !== 'application/pdf')
  )
    return 'Choose a PDF file.'
  if (!file.size || file.size > MAX_PDF_BYTES)
    return 'Choose a non-empty PDF up to 15 MB.'
  if (file.name.length > 120)
    return 'Use a filename with at most 120 characters.'
  return ''
}

export async function uploadPdf(
  roomId: string,
  file: File,
  getToken: () => Promise<string>,
  signal: AbortSignal,
  onStatus: (status: string) => void,
  onUploaded: (id: string) => void,
  existingId?: string,
): Promise<string> {
  signal.throwIfAborted()
  const base = `/rooms/${encodeURIComponent(roomId)}/attachment-uploads`
  let id = existingId
  if (!id) {
    onStatus('Uploading PDF…')
    const response = await apiFetch(base, getToken, {
      method: 'POST',
      signal,
      body: JSON.stringify({ filename: file.name, size: file.size }),
    })
    const upload = (await response.json()) as {
      upload_id: string
      url: string
      headers: Record<string, string>
    }
    const sent = await fetch(upload.url, {
      method: 'PUT',
      body: file,
      headers: upload.headers,
      signal,
    })
    if (!sent.ok) throw new Error('PDF upload failed. Please retry.')
    id = upload.upload_id
    onUploaded(id)
  }
  signal.throwIfAborted()
  onStatus('Checking PDF…')
  const response = await apiFetch(
    `${base}/${encodeURIComponent(id)}`,
    getToken,
    { signal },
  )
  const result = (await response.json()) as { status: string }
  signal.throwIfAborted()
  if (result.status !== 'ready')
    throw new Error('The PDF upload is not ready. Try Send again.')
  return id
}

export async function downloadPdf(
  roomId: string,
  messageId: string,
  filename: string,
  getToken: () => Promise<string>,
  signal: AbortSignal,
) {
  const response = await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/attachment`,
    getToken,
    { signal },
  )
  const { url } = (await response.json()) as { url: string }
  signal.throwIfAborted()
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.referrerPolicy = 'no-referrer'
  link.click()
}
