// 评审期主题会话：主题由「路由默认」决定，任何选择只在本次会话内生效
// （不写 localStorage、不进云同步）。待评审期结束再恢复偏好记忆。
import { isLiquidGlassStyle, normalizeLiquidGlassStyle } from './liquidGlassThemes'

export const SESSION_THEME_EVENT = 'dugou:session-theme'

// 每页默认（最长路径前缀优先：/dashboard/analysis 命中 '/dashboard'）
// 根路径 '/' 渲染的也是 New 页（App 路由 path="/" → NewInvestmentPage），
// 所以必须给它同样的月汐默认，否则从根进入会掉到全局兜底「暖砂」（金色）。
// 2026-09-25 修复：new 页"点开来是金色背景"的复现根因即此。
export const PAGE_GLASS_DEFAULTS = {
  '/': 'moon',
  '/new': 'moon',
  '/combo': 'sand',
  '/settle': 'hongguo',
  '/dashboard': 'moon',
  '/history': 'daylight',
  '/history/teams': 'moon',
  '/params': 'hongguo',
}
export const DEFAULT_GLASS_THEME = 'sand'

const sessionState = { pages: Object.create(null) }

const emit = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_THEME_EVENT))
  }
}

const normalizePath = (pathname = '') => {
  const clean = String(pathname).split('?')[0].replace(/\/+$/, '')
  return clean || '/'
}

// 前缀匹配同时容忍「应用挂载在子路径」的形态：owner 入口 /arsenal、设计预览
// /__design/x 等情况下 pathname 可能仍带前缀（/arsenal/new）。按路径尾段匹配，
// 保证 /arsenal/new 这类地址也能命中 '/new' 的页面默认，而不是掉进全局兜底。
const matchesRoutePrefix = (path, prefix) =>
  path === prefix || path.startsWith(`${prefix}/`) || path.endsWith(prefix) || path.includes(`${prefix}/`)

const longestPrefixMatch = (map, path) => {
  let best = null
  Object.keys(map).forEach((prefix) => {
    if (matchesRoutePrefix(path, prefix) && (!best || prefix.length > best.length)) {
      best = prefix
    }
  })
  return best
}

export const getPageGlassDefault = (pathname) => {
  const path = normalizePath(pathname)
  const hit = longestPrefixMatch(PAGE_GLASS_DEFAULTS, path)
  return hit ? PAGE_GLASS_DEFAULTS[hit] : DEFAULT_GLASS_THEME
}

export const getSessionGlassTheme = (pathname) => {
  const hit = longestPrefixMatch(sessionState.pages, normalizePath(pathname))
  return hit ? sessionState.pages[hit] : null
}

export const getEffectiveGlassTheme = (pathname) =>
  normalizeLiquidGlassStyle(getSessionGlassTheme(pathname) || getPageGlassDefault(pathname))

export const setSessionGlassTheme = (pathname, style) => {
  const path = normalizePath(pathname)
  // 未知主题不落到全局默认，而是回到该页默认
  sessionState.pages[path] = isLiquidGlassStyle(style) ? normalizeLiquidGlassStyle(style) : getPageGlassDefault(path)
  emit()
}

export const clearSessionGlassThemes = () => {
  sessionState.pages = Object.create(null)
  emit()
}
