// Scroll-only light response. One pending frame at most; no idle render loop,
// React state updates, pointer tracking or full-screen paint property changes.
export const attachGlassScrollMotion = (scroller, layer, host = window, page = document) => {
  const reduced = host.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0
  let disposed = false

  const cancel = () => {
    if (frame) host.cancelAnimationFrame(frame)
    frame = 0
  }
  const render = () => {
    frame = 0
    if (disposed) return
    const distance = Math.max(0, scroller.scrollTop)
    const height = Math.max(1, scroller.clientHeight)
    const phase = reduced.matches ? 0 : distance / height
    // Bounded at any document length. Moving back up reverses the light.
    const travel = Math.sin(phase * 1.8) * 14
    const breath = 0.76 + Math.sin(phase * 2.4) * 0.16
    layer.style.transform = `translate3d(0, ${travel.toFixed(2)}px, 0)`
    layer.style.opacity = breath.toFixed(3)
  }
  const schedule = () => {
    if (disposed || page.hidden || reduced.matches || frame) return
    frame = host.requestAnimationFrame(render)
  }
  const onPreference = () => { cancel(); render() }
  const onVisibility = () => { if (page.hidden) cancel(); else schedule() }
  render()
  scroller.addEventListener('scroll', schedule, { passive: true })
  reduced.addEventListener('change', onPreference)
  page.addEventListener('visibilitychange', onVisibility)
  host.addEventListener('resize', schedule, { passive: true })
  return () => {
    disposed = true
    cancel()
    scroller.removeEventListener('scroll', schedule)
    reduced.removeEventListener('change', onPreference)
    page.removeEventListener('visibilitychange', onVisibility)
    host.removeEventListener('resize', schedule)
  }
}
