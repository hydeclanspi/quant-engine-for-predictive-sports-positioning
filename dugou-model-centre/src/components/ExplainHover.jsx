import { usePreviewTextMask } from '../lib/labels'
import { GLOSSARY } from '../lib/glossary'

/**
 * ExplainHover — 「名词都能悬停解释」.
 *
 * Wraps any inline text so that hovering reveals a plain-language card for a
 * piece of jargon. Two ways to supply the card:
 *
 *   1. `card={…}`   — an inline object (used across ParamsPage, where the card
 *      carries live runtime fields current/baseline/status/others).
 *   2. `term="kelly"` — a key into the shared GLOSSARY (standard quant terms
 *      that are safe to spell out in demo/preview mode).
 *
 * `card` wins when both are given. If neither resolves to a card, the children
 * pass through untouched (so it's always safe to wrap).
 *
 * All text runs through usePreviewTextMask so proprietary tokens that sneak
 * into a card stay masked in preview mode; the GLOSSARY itself is deliberately
 * IP-free.
 */
export default function ExplainHover({ card, term, align = 'left', children }) {
  const maskText = usePreviewTextMask()
  const resolved = card || (term ? GLOSSARY[term] : null)
  if (!resolved) return children
  const alignClass = align === 'right' ? 'right-0' : 'left-0'
  const lines = [
    { label: '是什么', value: maskText(resolved.what) },
    { label: '描述', value: maskText(resolved.describes) },
    { label: '当前值', value: maskText(resolved.current) },
    { label: '基准值', value: maskText(resolved.baseline) },
    { label: '当前状态', value: maskText(resolved.status) },
    { label: '其它状态', value: maskText(resolved.others) },
  ].filter((line) => line.value)

  return (
    <span className="group/explain relative inline-flex">
      {children}
      <span className={`pointer-events-none absolute ${alignClass} top-full z-[240] mt-2.5 w-[300px] translate-y-1 rounded-xl border border-sky-200/85 bg-[linear-gradient(145deg,rgba(240,249,255,0.95),rgba(255,255,255,0.95)_48%,rgba(238,242,255,0.9))] p-3 text-left opacity-0 shadow-[0_16px_34px_-26px_rgba(56,189,248,0.45),inset_0_1px_0_rgba(255,255,255,0.92)] transition-all duration-180 group-hover/explain:translate-y-0 group-hover/explain:opacity-100 group-hover/explain:shadow-[0_22px_44px_-24px_rgba(56,189,248,0.5),inset_0_1px_0_rgba(255,255,255,0.92)]`}>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-600">{maskText(resolved.title)}</span>
        <span className="mt-1 block h-px w-full bg-gradient-to-r from-sky-200 via-indigo-200/80 to-transparent" />
        <span className="mt-1.5 block space-y-1.5">
          {lines.map((line) => (
            <span key={`${resolved.title}-${line.label}`} className="block text-[11px] leading-[1.45] text-stone-600">
              <span className="font-semibold text-stone-700">{line.label}：</span>
              {line.value}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
