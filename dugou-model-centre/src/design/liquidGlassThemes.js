// Shared by Console, the renderer and persisted UI preferences.
// Keep existing installations on their chosen theme; the new studies are opt-in.
export const DEFAULT_LIQUID_GLASS_STYLE = 'daylight'

export const LIQUID_GLASS_THEMES = [
  { key: 'temp', label: 'temp', description: '青橙流光', preview: 'linear-gradient(135deg, #b4e7dd, #75bfdb 35%, #b2b7ed 65%, #efbf8e)' },
  { key: 'vivid', label: '流光溢彩', description: '多彩流动', preview: 'linear-gradient(135deg, #84b7ec, #b1a0ee 36%, #f4c174 68%, #84d9bd)' },
  { key: 'hongguo', label: '红果', description: '青橙色场', preview: 'linear-gradient(135deg, #d7e8d4, #74cfc2 30%, #f4f7f8 58%, #edac79)' },
  { key: 'daylight', label: '晴光', description: '银白 · 雾青 · 杏暖', composed: true },
  { key: 'moon', label: '月汐', description: '月白 · 冰蓝 · 银灰', composed: true },
  { key: 'sand', label: '暖砂', description: '暖白 · 浅砂 · 亚麻', composed: true },
]

export const isLiquidGlassStyle = (value) => LIQUID_GLASS_THEMES.some((theme) => theme.key === value)
export const normalizeLiquidGlassStyle = (value) => isLiquidGlassStyle(value) ? value : DEFAULT_LIQUID_GLASS_STYLE
export const isComposedGlassStyle = (value) => LIQUID_GLASS_THEMES.some((theme) => theme.key === value && theme.composed)
