import ModernTopBar from './ModernTopBar'
import { Link } from 'react-router-dom'
import { Palette } from 'lucide-react'
import { INSPIRATION_2609_PREVIEW } from '../design/inspiration2609'

/**
 * Dedicated navigation seam for the next visual generation.
 * It intentionally mirrors Modern today; future redesigns belong here so the
 * stable Modern layout remains untouched.
 */
export default function InpirationTopBar({ designPreview = false }) {
  return <ModernTopBar layoutMode="inpiration" designPreview={designPreview} designLink={designPreview ? null : <Link reloadDocument className="mn-settings-link" to={INSPIRATION_2609_PREVIEW}><Palette size={13} />2609 预览</Link>} />
}
