import { ChevronLeft, ChevronRight } from 'lucide-react'
import { paginationSteps } from '../lib/pagination'

export default function TeamPagination({ page, totalPages, from, to, total, onChange }) {
  return (
    <div className="team-pagination">
      <span className="team-pagination-summary" aria-live="polite">{from}–{to}<span> / {total} 支球队</span></span>
      <nav className="team-pagination-rail" aria-label="球队分页">
        <button type="button" aria-label="上一页球队" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button>
        {paginationSteps(page, totalPages).map(step => typeof step === 'number' ? (
          <button key={step} type="button" aria-label={`第 ${step} 页球队`} aria-current={page === step ? 'page' : undefined} onClick={() => onChange(step)}>{step}</button>
        ) : <span key={step} className="team-pagination-gap" aria-hidden="true">· · ·</span>)}
        <button type="button" aria-label="下一页球队" disabled={page === totalPages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button>
      </nav>
      <span className="team-pagination-count">{String(page).padStart(2, '0')}<span> / {String(totalPages).padStart(2, '0')}</span></span>
    </div>
  )
}
