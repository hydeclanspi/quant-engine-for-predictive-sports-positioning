export const LAYOUT_KEY = 'dugou:layout-mode'
export const LAYOUT_MODES = ['modern', 'inpiration', 'sidebar']
export const DEFAULT_LAYOUT = 'inpiration'
const DEFAULT_REVISION_KEY = 'dugou:layout-default-inpiration.v1'

export const normalizeLayoutMode = (mode) =>
  ['temp_title', 'inspration', 'inspiration'].includes(mode)
    ? DEFAULT_LAYOUT
    : LAYOUT_MODES.includes(mode)
      ? mode
      : null

export const getPreferredLayoutMode = (configMode, storage) => {
  try {
    return (
      normalizeLayoutMode(storage?.getItem(LAYOUT_KEY)) ||
      normalizeLayoutMode(configMode) ||
      DEFAULT_LAYOUT
    )
  } catch {
    return normalizeLayoutMode(configMode) || DEFAULT_LAYOUT
  }
}

// Move existing installations to the new default once, then respect every
// explicit selection, including Modern, on subsequent visits.
export const initializeLayoutMode = (configMode, storage) => {
  try {
    if (!storage?.getItem(DEFAULT_REVISION_KEY)) {
      storage?.setItem(LAYOUT_KEY, DEFAULT_LAYOUT)
      storage?.setItem(DEFAULT_REVISION_KEY, '1')
      return DEFAULT_LAYOUT
    }
  } catch {
    return DEFAULT_LAYOUT
  }
  return getPreferredLayoutMode(configMode, storage)
}
