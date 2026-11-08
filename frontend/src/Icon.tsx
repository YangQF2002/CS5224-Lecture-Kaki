const paths = {
  compass:
    'm16.2 7.8-2.8 5.6-5.6 2.8 2.8-5.6 5.6-2.8ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  calendar:
    'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 10h2m6 0h2M7 18h2m6 0h2',
  message:
    'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM8 11h8',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  search: 'm21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
  arrow: 'M7 17 17 7M7 7h10v10',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  chevron: 'm9 5 7 7-7 7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm7 5v2',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  sliders: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',
  alert:
    'm10.3 3.9-8.2 14a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01',
  menu: 'M3 6h18M3 12h18M3 18h18',
  book: 'M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z',
} as const

export type IconName = keyof typeof paths

export default function Icon({
  name,
  className,
}: {
  name: IconName
  className?: string
}) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}
