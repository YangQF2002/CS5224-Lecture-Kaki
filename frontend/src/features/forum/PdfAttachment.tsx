type Props = {
  filename: string
  size: number
  action: 'download' | 'remove'
  onAction: () => void
  disabled?: boolean
}

export default function PdfAttachment({
  filename,
  size,
  action,
  onAction,
  disabled,
}: Props) {
  const megabytes = (size / 1024 / 1024).toFixed(1)
  return (
    <div className="pdf-attachment">
      <span className="pdf-file-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M8 12h8M8 16h5" />
        </svg>
        <span>PDF</span>
      </span>
      <span className="pdf-info">
        <span className="pdf-filename" title={filename}>
          {filename}
        </span>
        <span className="pdf-size">PDF · {megabytes} MB</span>
      </span>
      <button
        type="button"
        className="pdf-action"
        aria-label={
          action === 'remove'
            ? 'Remove PDF'
            : `Download PDF: ${filename} (${megabytes} MB)`
        }
        title={action === 'remove' ? 'Remove PDF' : 'Download PDF'}
        disabled={disabled}
        onClick={onAction}
      >
        {action === 'remove' ? (
          <span aria-hidden="true">×</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M12 3v12m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
          </svg>
        )}
      </button>
    </div>
  )
}
