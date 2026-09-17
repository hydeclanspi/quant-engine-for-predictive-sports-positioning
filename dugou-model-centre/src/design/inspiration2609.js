export const INSPIRATION_2609_NAME = 'Inspiration'
export const INSPIRATION_2609_EDITION = '2609'
export const INSPIRATION_2609_PREVIEW = '/design/inpiration/new?edition=2609'

// Teams retains Modern cards with a peach optical canvas. Console stays Modern.
export const INSPIRATION_2609_MATERIALS = Object.freeze({
  '/': 'folio',
  '/new': 'folio',
  '/combo': 'folio',
  '/settle': 'glacier',
  '/dashboard': 'prism',
  '/dashboard/analysis': 'prism',
  '/dashboard/metrics': 'prism',
  '/dashboard/report': 'prism',
  '/history': 'prism',
  '/history/teams': 'peach',
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
