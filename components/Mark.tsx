export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="3.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" transform="rotate(-6 7 9)" />
      <rect x="5" y="3.5" width="12" height="11" rx="1.5" fill="var(--color-lightbox)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.6" cy="7" r="1.7" fill="var(--color-grease)" />
    </svg>
  )
}
