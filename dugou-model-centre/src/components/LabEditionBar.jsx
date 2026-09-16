import { ArrowLeft, Check } from 'lucide-react'
import { LAB_EDITIONS, getLabReturnPath } from '../design/labEditions'
import {
  INSPIRATION_2609_EDITION,
  INSPIRATION_2609_NAME,
} from '../design/inspiration2609'

export default function LabEditionBar({ edition, onChange }) {
  return (
    <div className="lab-edition-bar">
      <a
        className="lab-return"
        href={getLabReturnPath(window.location.pathname)}
      >
        <ArrowLeft size={14} />
        <span>返回应用</span>
      </a>
      <div
        className="lab-edition-picker"
        role="group"
        aria-label="实验室视觉方案"
      >
        {LAB_EDITIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === edition}
            onClick={() => onChange(option.id)}
            title={`${option.name} · ${option.label}`}
          >
            <i
              className="lab-edition-swatch"
              style={{ '--swatch': option.color }}
            >
              {option.id === edition && <Check size={10} strokeWidth={2.3} />}
            </i>
            <span className="lab-edition-number">{option.number}</span>
            <span className="lab-edition-name">{option.name}</span>
            <span className="lab-edition-label">{option.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="lab-return"
        onClick={() => onChange(INSPIRATION_2609_EDITION)}
      >
        {INSPIRATION_2609_NAME} →
      </button>
    </div>
  )
}
