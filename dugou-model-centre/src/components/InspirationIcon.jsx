/** Single-colour geometry stays legible at the top bar's 13px size. */
export default function InspirationIcon({ variant = 'refraction', size = 24, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {variant === 'refraction' && <><path d="m12 2 10 10-10 10L2 12Z" /><path d="M12 2v10H2m10 0 10 0M12 12v10" /><path d="m12 12 5-5" /></>}
    {variant === 'overlap' && <><path d="m8 3 8 8-8 8-6-8Z" /><path d="m16 5 6 8-6 8-8-8Z" /></>}
    {variant === 'orbit' && <><ellipse cx="12" cy="12" rx="11" ry="5.5" transform="rotate(-40 12 12)" /><path d="m12 7 5 5-5 5-5-5Z" /><circle cx="20" cy="5" r="1.8" fill="currentColor" stroke="none" /></>}
    {variant === 'construct' && <><path d="M3 3h7v7H3zm11 11h7v7h-7z" /><path d="m17.5 2 4.5 8h-9ZM6.5 22 2 14h9Z" /></>}
  </svg>
}
