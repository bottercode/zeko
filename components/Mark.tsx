/** Zeko's mark: a tile with a Z cut into it, and the red light on its corner. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
      <path d="M8 8h8l-8 8h8" fill="none" stroke="var(--color-lightbox)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17.2" cy="6.8" r="1.9" fill="var(--color-grease)" />
    </svg>
  )
}
