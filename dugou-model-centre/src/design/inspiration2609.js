export const INSPIRATION_2609_NAME = 'inspiration 2609'
export const INSPIRATION_2609_EDITION = '2609'
export const INSPIRATION_2609_PREVIEW = '/design/inpiration/new?edition=2609'

// Explicit exceptions are intentional: Seasons and Console never inherit a
// laboratory palette, even though Seasons lives beneath /dashboard.
export const INSPIRATION_2609_MATERIALS = Object.freeze({
  '/': 'folio',
  '/new': 'folio',
  '/combo': 'folio',
  '/settle': 'glacier',
  '/dashboard': 'prism',
  '/dashboard/analysis': 'prism',
  '/dashboard/metrics': 'prism',
  '/dashboard/report': 'seasons',
  '/history': 'prism',
  '/history/teams': 'prism',
  '/params': 'modern',
})

export const getInspiration2609Surface = (
  pathname,
  layoutMode = 'inpiration',
) => {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  const material =
    layoutMode === 'modern'
      ? 'modern'
      : INSPIRATION_2609_MATERIALS[path] || 'modern'
  return {
    material,
    laboratory: ['folio', 'glacier', 'prism'].includes(material),
  }
}
