import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import ComposedGlassScene from './ComposedGlassScene'
import { isComposedGlassStyle, isDarkGlassStyle } from '../design/liquidGlassThemes'
import { attachGlassScrollMotion } from '../lib/glassScrollMotion'

const asset = (name) => `${import.meta.env.BASE_URL}glass-backdrops/${name}.webp`

export default function SmoothGlassBackdrop({ variant, scrollRef, scrollKey }) {
  const lightRef = useRef(null)
  const hasSignature = isDarkGlassStyle(variant)
  useEffect(() => {
    const scroller = scrollRef.current
    const light = lightRef.current
    if (!scroller || !light) return undefined
    return attachGlassScrollMotion(scroller, light)
  }, [variant, scrollRef, scrollKey])

  if (typeof document === 'undefined') return null
  if (isComposedGlassStyle(variant)) {
    return createPortal(<ComposedGlassScene variant={variant} />, document.body)
  }
  return createPortal(
    <div className={`smooth-glass-backdrop smooth-glass-backdrop--${variant}`} aria-hidden="true" data-glass-renderer="static">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={asset(`${variant}-portrait`)} />
        <img className="smooth-glass-backdrop__image" src={asset(variant)} width="1600" height="1000" alt="" decoding="async" draggable="false" />
      </picture>
      {hasSignature && (
        <div ref={lightRef} className={`smooth-glass-signature smooth-glass-signature--${variant}`}>
          {variant === 'spectra' && <img src={asset('spectra-beams')} alt="" decoding="async" draggable="false" />}
        </div>
      )}
    </div>,
    document.body,
  )
}
