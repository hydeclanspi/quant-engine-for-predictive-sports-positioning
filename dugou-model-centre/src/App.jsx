import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// Components
import Sidebar from './components/Sidebar'
import ModernTopBar from './components/ModernTopBar'
import InpirationTopBar from './components/InpirationTopBar'
import BottomBar from './components/BottomBar'
import Modal from './components/Modal'
import DemoBubble from './components/DemoBubble'
import LabEditionBar from './components/LabEditionBar'
import Inspiration2609Shell from './components/Inspiration2609Shell'
import LiquidGlassBackdrop from './components/LiquidGlassBackdrop'
import SmoothGlassBackdrop from './components/SmoothGlassBackdrop'
import { isComposedGlassStyle, isDarkGlassStyle, normalizeLiquidGlassQuality, normalizeLiquidGlassStyle } from './design/liquidGlassThemes'
import { SESSION_THEME_EVENT, getEffectiveGlassTheme } from './design/themeSession'
import { isDesignPreview, getLabReturnPath, LAB_EDITION_KEY, normalizeLabEdition, readLabEdition } from './design/labEditions'
import { getInspiration2609Surface, INSPIRATION_2609_EDITION } from './design/inspiration2609'

// Pages
import NewInvestmentPage from './pages/NewInvestmentPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import SettlePage from './pages/SettlePage'
import ComboPage from './pages/ComboPage'
import ParamsPage from './pages/ParamsPage'
import TeamsPage from './pages/TeamsPage'
import AnalysisPage from './pages/AnalysisPage'
import MetricsPage from './pages/MetricsPage'
import WarReportPage from './pages/WarReportPage'

import { getSystemConfig, PAGE_AMBIENT_THEME_DEFAULTS, isInTimeMachineMode } from './lib/localData'
import { trackRouteAccess } from './lib/accessTracking'
import { useDisplayMode, PREVIEW_MODE } from './lib/displayMode'

import { initializeLayoutMode, LAYOUT_KEY, normalizeLayoutMode } from './lib/layoutMode'

const SYSTEM_CONFIG_KEY = 'dugou.system_config.v1'
const PAGE_AMBIENT_ROUTE_MAP = {
  '/': 'new',
  '/new': 'new',
  '/combo': 'combo',
  '/settle': 'settle',
  '/dashboard': 'dashboard_overview',
  '/dashboard/analysis': 'dashboard_analysis',
  '/dashboard/metrics': 'dashboard_metrics',
  '/dashboard/report': 'dashboard_report',
  '/history': 'history',
  '/history/teams': 'teams',
  '/params': 'params',
}
const VALID_AMBIENT_TONES = ['classic_white', 'soft_blue', 'soft_orange']

function App() {
  const designPreview = isDesignPreview()
  const navigate = useNavigate()
  const [labEdition, setLabEdition] = useState(() => {
    try { return readLabEdition(window.location.search, window.sessionStorage) }
    catch { return readLabEdition(window.location.search, null) }
  })
  const inspiration2609Preview = designPreview && labEdition === INSPIRATION_2609_EDITION
  const [layoutMode, setLayoutMode] = useState(() => {
    if (designPreview) return 'inpiration'
    return initializeLayoutMode(getSystemConfig().layoutMode, localStorage)
  })
  // Both themes share a stable component tree so switching never clears drafts.
  const inspiration2609Active = inspiration2609Preview || (!designPreview && ['inpiration', 'modern'].includes(layoutMode))
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modalData, setModalData] = useState(null)
  const [systemConfigSnapshot, setSystemConfigSnapshot] = useState(() => getSystemConfig())
  const [readOnlyWarning, setReadOnlyWarning] = useState(() => isInTimeMachineMode() ? '时光穿越中，仅浏览历史快照' : '')
  const mainScrollRef = useRef(null)
  const location = useLocation()
  const displayMode = useDisplayMode()
  // 液态玻璃背景层：默认开启，systemConfig.liquidGlassEnabled === false 时关闭
  // URL 逃生开关：?glass=hongguo / ?glass=off —— 即使已保存的主题导致页面卡死也能强行进入
  const glassOverride = (() => {
    if (typeof window === 'undefined') return null
    try {
      return new URLSearchParams(window.location.search).get('glass')
    } catch {
      return null
    }
  })()
  const liquidGlassEnabled = glassOverride === 'off' ? false : systemConfigSnapshot?.liquidGlassEnabled !== false
  // 评审期：主题由「路由默认 + 本次会话内选择」决定，不读偏好记忆（localStorage/云同步）；
  // URL 逃生开关 ?glass= 仍最高优先。
  const [liquidGlassStyle, setLiquidGlassStyleState] = useState(() =>
    glassOverride && glassOverride !== 'off'
      ? normalizeLiquidGlassStyle(glassOverride)
      : getEffectiveGlassTheme(location.pathname))
  useEffect(() => {
    const apply = () => {
      setLiquidGlassStyleState(
        glassOverride && glassOverride !== 'off'
          ? normalizeLiquidGlassStyle(glassOverride)
          : getEffectiveGlassTheme(location.pathname),
      )
    }
    apply()
    window.addEventListener(SESSION_THEME_EVENT, apply)
    return () => window.removeEventListener(SESSION_THEME_EVENT, apply)
  }, [glassOverride, location.pathname])
  const liquidGlassQuality = normalizeLiquidGlassQuality(systemConfigSnapshot?.liquidGlassQuality)
  const liquidGlass = liquidGlassEnabled ? (
    liquidGlassQuality === 'full'
      ? <LiquidGlassBackdrop variant={liquidGlassStyle} />
      : <SmoothGlassBackdrop variant={liquidGlassStyle} scrollRef={mainScrollRef} scrollKey={`${layoutMode}:${location.pathname}`} />
  ) : null

  // Listen for layout mode changes from ParamsPage
  useEffect(() => {
    const onLayoutChange = (e) => {
      const mode = e.detail?.mode
      const normalizedMode = normalizeLayoutMode(mode)
      if (designPreview) {
        if (inspiration2609Preview && e.detail?.preview && ['modern', 'inpiration'].includes(normalizedMode)) {
          setLayoutMode(normalizedMode)
        }
        return
      }
      if (normalizedMode) {
        setLayoutMode(normalizedMode)
        localStorage.setItem(LAYOUT_KEY, normalizedMode)
      }
    }
    window.addEventListener('dugou:layout-changed', onLayoutChange)
    return () => window.removeEventListener('dugou:layout-changed', onLayoutChange)
  }, [designPreview, inspiration2609Preview])

  // Theme changes do not remount any business page: unsaved form state stays put.
  useEffect(() => {
    if (!designPreview) return
    const params = new URLSearchParams(location.search)
    const requested = params.get('edition')
    if (requested) {
      const next = normalizeLabEdition(requested)
      setLabEdition(next)
      try { window.sessionStorage.setItem(LAB_EDITION_KEY, next) } catch { /* optional preference */ }
      if (requested === next) return
      params.set('edition', next)
    } else params.set('edition', labEdition)
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true })
  }, [designPreview, labEdition, location.pathname, location.search, location.hash, navigate])

  const changeLabEdition = (edition) => {
    const params = new URLSearchParams(location.search)
    params.set('edition', normalizeLabEdition(edition))
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true })
  }

  useEffect(() => {
    const onDataChanged = (event) => {
      const key = event?.detail?.key
      if (!key || key === SYSTEM_CONFIG_KEY) {
        setSystemConfigSnapshot(getSystemConfig())
      }
    }
    const onTmChanged = (event) => {
      const isActive = event?.detail?.active
      setReadOnlyWarning(isActive ? '时光穿越中，仅浏览历史快照' : '')
    }
    window.addEventListener('dugou:data-changed', onDataChanged)
    window.addEventListener('dugou:time-machine-changed', onTmChanged)
    return () => {
      window.removeEventListener('dugou:data-changed', onDataChanged)
      window.removeEventListener('dugou:time-machine-changed', onTmChanged)
    }
  }, [])

  // Glow card mouse tracking effect
  useEffect(() => {
    // Smooth mode keeps the static edge highlight without scanning every card
    // and reading layout on each pointer event.
    if (liquidGlassQuality === 'smooth') return undefined
    let frame = 0
    let pointer = null
    const update = () => {
      frame = 0
      if (!pointer) return
      const cards = document.querySelectorAll('.glow-card')
      // Batch layout reads before style writes to avoid read/write thrashing.
      const visible = Array.from(cards, (card) => ({ card, rect: card.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0)
      visible.forEach(({ card, rect }) => {
        const x = ((pointer.x - rect.left) / rect.width) * 100
        const y = ((pointer.y - rect.top) / rect.height) * 100
        card.style.setProperty('--mouse-x', `${x}%`)
        card.style.setProperty('--mouse-y', `${y}%`)
      })
    }
    const handleMouseMove = (event) => {
      pointer = { x: event.clientX, y: event.clientY }
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [liquidGlassQuality])

  // Scroll to top on route change
  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0
    }
  }, [location.pathname])

  useEffect(() => {
    if (designPreview) return
    trackRouteAccess(location.pathname)
  }, [designPreview, location.pathname])

  // 液态玻璃开关联动 <html> class：CSS 覆写全部挂在 .liquid-glass-on 下，关闭时零视觉差异
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('liquid-glass-on', liquidGlassEnabled)
    root.classList.toggle('liquid-glass-composed', liquidGlassEnabled && isComposedGlassStyle(liquidGlassStyle))
    root.classList.toggle('liquid-glass-dark', liquidGlassEnabled && isDarkGlassStyle(liquidGlassStyle))
    root.classList.toggle('liquid-glass-smooth', liquidGlassQuality === 'smooth')
    root.dataset.liquidGlassQuality = liquidGlassQuality
    if (liquidGlassEnabled) root.dataset.liquidGlassStyle = liquidGlassStyle
    else delete root.dataset.liquidGlassStyle
    // 浏览器外框一体化：深色旗舰主题时 theme-color 跟随深底
    const meta = document.querySelector('meta[name="theme-color"]')
    const darkBar = { xuanji: '#060d0a', spectra: '#04070f', starward: '#040b1c' }[liquidGlassStyle]
    if (meta) meta.setAttribute('content', liquidGlassEnabled && darkBar ? darkBar : '#fbbf24')
    return () => {
      root.classList.remove('liquid-glass-on', 'liquid-glass-composed', 'liquid-glass-dark', 'liquid-glass-smooth')
      delete root.dataset.liquidGlassStyle
      delete root.dataset.liquidGlassQuality
      if (meta) meta.setAttribute('content', '#fbbf24')
    }
  }, [liquidGlassEnabled, liquidGlassStyle, liquidGlassQuality])

  // 顶栏液态玻璃 morph：滚动容器下滚超过阈值后，<html> 加 .lg-scrolled 触发形态切换
  useEffect(() => {
    if (!liquidGlassEnabled) {
      document.documentElement.classList.remove('lg-scrolled')
      return undefined
    }
    const el = mainScrollRef.current
    if (!el) return undefined
    let rafId = 0
    const apply = () => {
      rafId = 0
      document.documentElement.classList.toggle('lg-scrolled', el.scrollTop > 24)
    }
    const onScroll = () => {
      if (!rafId) rafId = window.requestAnimationFrame(apply)
    }
    apply()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (rafId) window.cancelAnimationFrame(rafId)
      document.documentElement.classList.remove('lg-scrolled')
    }
  }, [liquidGlassEnabled, inspiration2609Active, layoutMode])

  const openModal = (data) => setModalData(data)
  const closeModal = () => setModalData(null)
  const ambientPageKey = PAGE_AMBIENT_ROUTE_MAP[location.pathname] || 'new'
  const ambientThemes = systemConfigSnapshot?.pageAmbientThemes || PAGE_AMBIENT_THEME_DEFAULTS
  const ambientToneCandidate = ambientThemes[ambientPageKey] || PAGE_AMBIENT_THEME_DEFAULTS[ambientPageKey] || 'classic_white'
  const ambientTone = VALID_AMBIENT_TONES.includes(ambientToneCandidate) ? ambientToneCandidate : 'classic_white'
  const surface2609 = getInspiration2609Surface(location.pathname, layoutMode)
  const usesLabMaterial = inspiration2609Active ? surface2609.laboratory : designPreview
  const usesOpticalCanvas = usesLabMaterial || (inspiration2609Active && surface2609.material === 'peach')
  const ambientClassName = usesOpticalCanvas ? '' : `app-ambient-scope app-ambient-tone-${ambientTone}`
  const mainContentClassName = `page-enter app-main-content ${location.pathname === '/dashboard/report' ? 'app-main-content--seasons' : ''} ${ambientClassName}`

  // Demo nudge — bottom-right glass bubble, preview mode + homepage only.
  const isHomeRoute = location.pathname === '/' || location.pathname === '/new'
  const demoBubble = !designPreview && displayMode === PREVIEW_MODE && isHomeRoute ? <DemoBubble /> : null

  const pageRoutes = (
    <Routes>
      <Route path="/" element={<NewInvestmentPage openModal={openModal} />} />
      <Route path="/new" element={<NewInvestmentPage openModal={openModal} />} />
      <Route path="/combo" element={<ComboPage openModal={openModal} inspirationLayout={inspiration2609Active && layoutMode === 'inpiration'} />} />
      <Route path="/settle" element={<SettlePage openModal={openModal} />} />
      <Route path="/dashboard" element={<DashboardPage openModal={openModal} />} />
      <Route path="/dashboard/analysis" element={<AnalysisPage openModal={openModal} />} />
      <Route path="/dashboard/metrics" element={<MetricsPage openModal={openModal} />} />
      <Route path="/dashboard/report" element={<WarReportPage openModal={openModal} />} />
      <Route path="/history" element={<HistoryPage openModal={openModal} />} />
      <Route path="/history/teams" element={<TeamsPage openModal={openModal} />} />
      <Route path="/params" element={<ParamsPage openModal={openModal} previewLayoutMode={inspiration2609Preview ? layoutMode : undefined} />} />
    </Routes>
  )

  // Approved theme, shared by live routes and the isolated design preview.
  // The existing top bar is outside the Lab scope, including at mobile sizes.
  if (inspiration2609Active) {
    return (
      <>
        {liquidGlass}
        <Inspiration2609Shell
        pathname={location.pathname}
        layoutMode={layoutMode}
        pageKey={ambientPageKey}
        mainScrollRef={mainScrollRef}
        contentClassName={mainContentClassName}
        header={<ModernTopBar
          layoutMode={layoutMode}
          designPreview={designPreview}
          onPreviewLayoutChange={designPreview ? setLayoutMode : null}
          designLink={designPreview ? <a className="mn-settings-link inspiration-preview-return" href={getLabReturnPath(window.location.pathname)} title="返回应用 · 当前为 inspiration 2609 设计预览">
            <ArrowLeft size={13} /><span>返回应用</span>
          </a> : null}
        />}
        footer={<BottomBar />}
        modal={<>{modalData && <Modal data={modalData} onClose={closeModal} />}{demoBubble}</>}
      >
        {pageRoutes}
      </Inspiration2609Shell>
      </>
    )
  }

  /* ── Modern layout — Vercel/Linear design language ── */
  if (layoutMode === 'modern') {
    return (
      <div className="flex flex-col h-screen theme-modern" style={{ background: '#f7f8fa' }}>
        {liquidGlass}
        <ModernTopBar layoutMode="modern" />
        <main
          ref={mainScrollRef}
          className="app-main-scroll flex-1 overflow-auto custom-scrollbar min-w-0"
        >
          <div className="app-main-flow">
            <div key={location.pathname} className={mainContentClassName}>
              {pageRoutes}
            </div>
            <BottomBar />
          </div>
        </main>
        {modalData && <Modal data={modalData} onClose={closeModal} />}
        {demoBubble}
      </div>
    )
  }

  /* ── inpiration — isolated workspace for the next UI/theme generation ── */
  if (layoutMode === 'inpiration') {
    return (
      <div className={`flex flex-col h-screen theme-modern theme-inpiration${designPreview ? ' lab-editions' : ''}`} data-lab-edition={designPreview ? labEdition : undefined} data-lab-page={designPreview ? ambientPageKey : undefined} style={designPreview ? undefined : { background: '#f7f8fa' }}>
        {liquidGlass}
        {designPreview && <LabEditionBar edition={labEdition} onChange={changeLabEdition} />}
        {designPreview && <div className="lab-optical-field" aria-hidden="true"><i /><i /><i /></div>}
        <InpirationTopBar designPreview={designPreview} />
        <main
          ref={mainScrollRef}
          className="app-main-scroll flex-1 overflow-auto custom-scrollbar min-w-0"
        >
          <div className="app-main-flow">
            <div key={location.pathname} className={mainContentClassName}>
              {pageRoutes}
            </div>
            <BottomBar />
          </div>
        </main>
        {modalData && <Modal data={modalData} onClose={closeModal} />}
        {demoBubble}
      </div>
    )
  }

  /* ── Sidebar layout (legacy) ── */
  return (
    <div className="flex h-screen bg-stone-100/50">
      {liquidGlass}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        ref={mainScrollRef}
        className="app-main-scroll flex-1 overflow-auto custom-scrollbar min-w-0"
      >
        <div className="app-main-flow">
          <div key={location.pathname} className={mainContentClassName}>
            {pageRoutes}
          </div>
          <BottomBar />
        </div>
      </main>
      {modalData && <Modal data={modalData} onClose={closeModal} />}
    </div>
  )
}

export default App
