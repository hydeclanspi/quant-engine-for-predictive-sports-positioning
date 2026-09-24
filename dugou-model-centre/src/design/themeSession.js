// 评审期主题会话：主题由「路由默认」决定，任何选择只在本次会话内生效
// （不写 localStorage、不进云同步）。待评审期结束再恢复偏好记忆。
import { isLiquidGlassStyle, normalizeLiquidGlassStyle } from './liquidGlassThemes'

export const SESSION_THEME_EVENT = 'dugou:session-theme'

// 每页默认（最长路径前缀优先：/dashboard/analysis 命中 '/dashboard'）
export const PAGE_GLASS_DEFAULTS = {
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

const longestPrefixMatch = (map, path) => {
  let best = null
  Object.keys(map).forEach((prefix) => {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best.length)) {
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
