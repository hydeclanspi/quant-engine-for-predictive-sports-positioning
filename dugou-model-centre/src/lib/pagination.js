export const TEAM_PAGE_SIZE = 21

export function paginateItems(items, requestedPage, pageSize = TEAM_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(requestedPage)) || 1))
  const start = (page - 1) * pageSize
  return { page, totalPages, items: items.slice(start, start + pageSize), from: items.length ? start + 1 : 0, to: Math.min(start + pageSize, items.length) }
}

export function paginationSteps(page, totalPages) {
  const visible = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(n => totalPages <= 7 || n === 1 || n === totalPages || Math.abs(n - page) <= 1)
  return visible.flatMap((n, i) => {
    const gap = n - visible[i - 1]
    return gap === 2 ? [n - 1, n] : gap > 2 ? [`gap-${n}`, n] : [n]
  })
}
