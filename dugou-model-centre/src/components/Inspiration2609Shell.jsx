import { getInspiration2609Surface } from '../design/inspiration2609'

/** A presentation-only shell: the header is outside every Lab CSS scope. */
export default function Inspiration2609Shell({
  pathname,
  layoutMode,
  header,
  children,
  footer,
  modal,
  mainScrollRef,
  contentClassName,
  pageKey,
}) {
  const { material, laboratory } = getInspiration2609Surface(
    pathname,
    layoutMode,
  )
  return (
    <div
      className="flex flex-col h-screen theme-modern theme-inpiration theme-inspiration-2609"
      data-inspiration-material={material}
    >
      {header}
      <div
        className={`inspiration-2609-body flex flex-col flex-1 min-h-0${laboratory ? ' theme-modern lab-editions' : ''}`}
        data-lab-edition={laboratory ? material : undefined}
        data-lab-page={laboratory ? pageKey : undefined}
      >
        {laboratory && (
          <div className="lab-optical-field" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        <main
          ref={mainScrollRef}
          className="app-main-scroll flex-1 overflow-auto custom-scrollbar min-w-0"
        >
          <div className="app-main-flow">
            <div key={pathname} className={contentClassName}>
              {children}
            </div>
            {footer}
          </div>
        </main>
        {modal}
      </div>
    </div>
  )
}
