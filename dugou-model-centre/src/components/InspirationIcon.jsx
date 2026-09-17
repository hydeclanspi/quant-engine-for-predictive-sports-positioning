/** Single-colour geometry stays legible at the top bar's 13px size. */
export default function InspirationIcon({ size = 24, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="m8 3 8 8-8 8-6-8Z" />
    <path d="m16 5 6 8-6 8-8-8Z" />
  </svg>
}
