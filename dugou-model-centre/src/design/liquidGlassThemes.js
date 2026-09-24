// Shared by Console, the renderer and persisted UI preferences.
// 默认 = 暖砂 sand（评审期：各页默认见 design/themeSession.js 的 PAGE_GLASS_DEFAULTS）
export const DEFAULT_LIQUID_GLASS_STYLE = 'sand'
// 新设备与旧配置都从流畅模式开始；只有明确选择才启用持续渲染。
export const DEFAULT_LIQUID_GLASS_QUALITY = 'smooth'
export const normalizeLiquidGlassQuality = (value) => value === 'full' ? 'full' : DEFAULT_LIQUID_GLASS_QUALITY

export const LIQUID_GLASS_THEMES = [
  { key: 'vivid', label: '流光溢彩', description: '多彩流动', preview: 'linear-gradient(135deg, #84b7ec, #b1a0ee 36%, #f4c174 68%, #84d9bd)' },
  { key: 'hongguo', label: '红果', description: '青橙色场', preview: 'linear-gradient(135deg, #d7e8d4, #74cfc2 30%, #f4f7f8 58%, #edac79)' },
  { key: 'daylight', label: '晴光', description: '银白 · 雾青 · 杏暖', composed: true },
  { key: 'moon', label: '月汐', description: '月白 · 冰蓝 · 银灰', composed: true },
  { key: 'sand', label: '暖砂', description: '暖白 · 浅砂 · 亚麻', composed: true },
  { key: 'xuanji', label: '璇玑', description: '墨玉 · 鎏金刻度', dark: true, preview: 'radial-gradient(circle at 76% 24%, #e8dfc82e, transparent 52%), radial-gradient(circle at 18% 88%, #1d4a38cc, transparent 60%), linear-gradient(150deg, #0d1713, #060d0a)' },
  { key: 'spectra', label: '光谱', description: '深空 · 棱镜色散', dark: true, preview: 'linear-gradient(115deg, transparent 42%, #a8c4ff40 46%, #ffffff70 50%, #b18cff40 54%, transparent 58%), radial-gradient(circle at 12% 20%, #16336b99, transparent 55%), linear-gradient(150deg, #0a1122, #04070f)' },
  { key: 'starward', label: '牵星', description: '午夜 · 星图导航', dark: true, preview: 'radial-gradient(1.5px 1.5px at 24% 30%, #ffffffe6, transparent 60%), radial-gradient(1px 1px at 68% 18%, #ffffffb3, transparent 60%), radial-gradient(1.2px 1.2px at 84% 42%, #ffffffcc, transparent 60%), radial-gradient(1px 1px at 42% 62%, #ffffff80, transparent 60%), linear-gradient(180deg, #040b1c, #0c2148)' },
]

export const isDarkGlassStyle = (value) => LIQUID_GLASS_THEMES.some((theme) => theme.key === value && theme.dark)

export const isLiquidGlassStyle = (value) => LIQUID_GLASS_THEMES.some((theme) => theme.key === value)
export const normalizeLiquidGlassStyle = (value) => isLiquidGlassStyle(value) ? value : DEFAULT_LIQUID_GLASS_STYLE
export const isComposedGlassStyle = (value) => LIQUID_GLASS_THEMES.some((theme) => theme.key === value && theme.composed)
