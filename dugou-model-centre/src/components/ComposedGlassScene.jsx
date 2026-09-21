// A stable light field: two continuous surfaces give the glass edges something
// to diffuse, without a perpetual animation or a WebGL context.
// The same composition is used in Console's miniature previews.
export default function ComposedGlassScene({ variant, preview = false }) {
  return (
    <div
      aria-hidden="true"
      className={`composed-glass-scene composed-glass-scene--${variant}${preview ? ' composed-glass-scene--preview' : ''}`}
    >
      <div className="composed-glass-scene__cool" />
      <div className="composed-glass-scene__warm" />
      <div className="composed-glass-scene__light" />
    </div>
  )
}
