// Visual preferences only. The preview mounts the existing product routes.
export const LAB_EDITIONS = [
  {
    id: 'prism',
    number: '01',
    name: 'PRISM',
    label: '晶透银',
    color: '#c7d7e8',
  },
  {
    id: 'glacier',
    number: '02',
    name: 'GLACIER',
    label: '冰川蓝',
    color: '#9ddcf0',
  },
  {
    id: 'folio',
    number: '03',
    name: 'FOLIO LAB',
    label: '铂金纸',
    color: '#d8d0c3',
  },
  {
    id: 'cobalt',
    number: '04',
    name: 'COBALT',
    label: '钴蓝',
    color: '#3481e6',
  },
]

export const getDesignPreviewBase = (pathname = '') =>
  String(pathname).match(/^\/(?:arsenal\/)?design\/inpiration(?=\/|$)/)?.[0] ||
  null

export const isDesignPreview = () =>
  typeof window !== 'undefined' &&
  Boolean(getDesignPreviewBase(window.location?.pathname))

export const normalizeLabEdition = (value) =>
  LAB_EDITIONS.some((edition) => edition.id === value) ? value : 'cobalt'

export const getLabReturnPath = (pathname = '') =>
  String(pathname).startsWith('/arsenal/') ? '/arsenal/new' : '/new'

export const LAB_EDITION_KEY = 'dugou:lab-edition.v2'

export const readLabEdition = (search, storage) => {
  const requested = new URLSearchParams(search).get('edition')
  if (requested) return normalizeLabEdition(requested)
  try {
    return normalizeLabEdition(storage?.getItem(LAB_EDITION_KEY))
  } catch {
    return 'cobalt'
  }
}
