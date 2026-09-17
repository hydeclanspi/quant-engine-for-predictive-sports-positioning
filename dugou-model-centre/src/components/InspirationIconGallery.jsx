import { useState } from 'react'
import InspirationIcon from './InspirationIcon'
import '../design/inspirationIcons.css'

const options = [
  { key: 'refraction', name: '折光', detail: '菱形切面 · 清晰的灵感交点' },
  { key: 'overlap', name: '交叠', detail: '错位几何 · 想法之间的连接' },
  { key: 'orbit', name: '轨迹', detail: '环绕轨道 · 自由而精确' },
  { key: 'construct', name: '构形', detail: '基本形重组 · 理性的创造力' },
]

export default function InspirationIconGallery() {
  const [selected, setSelected] = useState('refraction')
  return <div className="inspiration-icon-gallery">
    <p className="text-sm text-stone-500 mb-5">选择一个方案查看实际尺寸。这里只预览，不更改已保存的主题。</p>
    <div className="inspiration-icon-options" role="group" aria-label="Inspiration 图标方案">
      {options.map((option, index) => <button key={option.key} type="button" aria-pressed={selected === option.key} onClick={() => setSelected(option.key)}>
        <span className="inspiration-icon-number">0{index + 1}</span>
        <InspirationIcon variant={option.key} size={52} />
        <strong>{option.name}</strong>
        <span>{option.detail}</span>
      </button>)}
    </div>
    <div className="inspiration-icon-size-preview" aria-live="polite">
      <span className="text-xs text-stone-500">实际应用 · {options.find(o => o.key === selected).name}</span>
      <span className="inspiration-icon-nav-sample"><InspirationIcon variant={selected} size={13} /> Inspiration</span>
      <span className="inspiration-icon-console-sample"><InspirationIcon variant={selected} size={24} /> Inspiration</span>
    </div>
  </div>
}
