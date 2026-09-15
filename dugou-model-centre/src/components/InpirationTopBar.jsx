import ModernTopBar from './ModernTopBar'
import { Link } from 'react-router-dom'
import { Palette } from 'lucide-react'

/**
 * Dedicated navigation seam for the next visual generation.
 * It intentionally mirrors Modern today; future redesigns belong here so the
 * stable Modern layout remains untouched.
 */
export default function InpirationTopBar() {
  return <ModernTopBar layoutMode="inpiration" designLink={<Link className="mn-settings-link" to="/design/inpiration"><Palette size={13} />设计提案</Link>} />
}
