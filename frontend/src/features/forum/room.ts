/** Keep ingestion's session ID opaque, including leading-zero lecture groups. */
export function forumPath(
  sessionId: string,
  acadYear: string,
  semester: number,
): string {
  return `/forum/${encodeURIComponent(`${sessionId}@${acadYear}@${semester}`)}`
}
