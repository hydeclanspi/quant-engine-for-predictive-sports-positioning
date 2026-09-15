export const CONCEPTS = [
  {
    id: 'helio',
    number: '01',
    name: 'HELIO',
    chinese: '日光档案',
    tag: '推荐主方向',
    line: '让每一次洞察，都有光。',
    english: 'A little clarity. A world of possibility.',
    description:
      '暖白纸面承载信息，冰蓝折射托起交互。把一季投资写成有起承转合的成长档案。',
    character: '明亮 · 灵动 · 自信',
    motif:
      '从现有钻石 Logo 提取四个切面：洞察、配置、结算、复盘。每个切面既是几何图形，也是一个章节。',
    palette: ['#F4F6F7', '#FAFBFC', '#265FE8', '#C7DDF4', '#A78658'],
    paletteNames: ['雾白画布', '瓷白内容', '日光蓝', '冰川折光', '香槟细节'],
    typography:
      '中文采用系统无衬线，英文采用现代人文无衬线；标题 32–44，正文 14–16，辅助 12，数据 26–32。',
    geometry:
      '12 栏弹性网格，28px 主卡圆角，16px 内层控件。四切面几何贯穿周期封面、组合关系与空状态。',
    glass:
      '导航、周期选择器、详情浮层使用透镜玻璃；数据卡使用高不透明度瓷白。光晕聚焦在卡边与几何物体。',
    motion:
      '220ms 控件变形、360ms 卡片展开、640ms 章节入场；鼠标靠近才产生局部折光。',
    story:
      'New 是一道灵感，Portfolio 是排列光谱，Settle 是让结果显影，Seasons 是一季的纪念册。',
    business:
      '适合从个人产品走向成熟平台：入口轻、关键数字清楚，状态反馈与证据链完整，品牌可延展到网站与产品演示。',
    tradeoff: '最均衡，也最依赖细节质量：留白、反射和玻璃层级必须统一维护。',
  },
  {
    id: 'kepler',
    number: '02',
    name: 'KEPLER',
    chinese: '轨道实验室',
    tag: '研究型品牌',
    line: '在不确定中，找到自己的轨道。',
    english: 'The quiet architecture of conviction.',
    description:
      '石墨空间、铂金透镜与细密坐标。让主观判断、模型反馈和资金轨迹组成可阅读的观测系统。',
    character: '精密 · 冷静 · 探索',
    motif:
      '四切面钻石成为观测中心，轨道环连接信心、敞口与结果。小金点只标记当前周期与活动焦点。',
    palette: ['#16191E', '#23272D', '#B4CFFF', '#D9BE8C', '#ADBBB6'],
    paletteNames: ['石墨背景', '钛灰内容', '冰蓝信号', '恒星金', '雾绿状态'],
    typography:
      '中文与导航保持无衬线；日期、坐标与小标签局部用等宽体，关键数字 28–32。',
    geometry:
      '左侧浮动导航，紧凑 12 栏仪表布局；圆轨道与 18px 圆角矩形形成一套稳定对比。',
    glass:
      '导航为烟灰玻璃，悬浮面板为铂金透镜；主内容钛灰实底，细线连接关系而不叠加大面积发光。',
    motion:
      '180ms 状态响应、300ms 面板推移、600ms 轨道定位。持续动效只用于细小活动标记。',
    story:
      'New 是观测记录，Portfolio 是轨道编组，Settle 是信号校验，Seasons 是任务航迹。',
    business:
      '适合模型能力、研究深度与专业用户：风险敞口、计算依据、同步状态始终有固定位置。',
    tradeoff:
      '专业感最强；情绪温度偏克制，长文本页面需要更高留白和更严格的深色对比。',
  },
  {
    id: 'folio',
    number: '03',
    name: 'FOLIO',
    chinese: '未来刊物',
    tag: '叙事型品牌',
    line: '把判断，写成值得回看的篇章。',
    english: 'Notes on a possible future.',
    description:
      '纸白、墨色、鸢尾蓝。用刊物的节奏组织复杂功能，让每张卡片像经过编辑的一页。',
    character: '浪漫 · 人文 · 鲜明',
    motif:
      '把钻石切面展开成折页。页角编号、边注、折光书签组成独有的品牌语言，封面拥有编辑感。',
    palette: ['#F2EFE8', '#FFFDFA', '#554AA2', '#DDD6EB', '#A47C60'],
    paletteNames: ['书页白', '棉纸内容', '鸢尾墨', '薄暮紫', '古铜标记'],
    typography:
      '英文叙事标题使用衬线体，中文和所有数据使用无衬线。正文 15–16，边注 12，数据不超过 32。',
    geometry:
      '刊头、细分割线、章节编号；主次卡片采用 7:5 / 8:4 编排，16px 圆角与折页角呼应。',
    glass: '书签、工具托盘和详情浮层使用浅紫透明玻璃；文章与数据保留温暖纸面。',
    motion:
      '240ms 标签滑动、420ms 卡片展开、580ms 折页显影；详情像侧页展开，阅读位置保持稳定。',
    story:
      'New 是手稿，Portfolio 是编排，Settle 是校样，Seasons 是每一期的封面故事。',
    business:
      '适合强调品牌辨识度和用户长期关系：复盘、笔记与数据等重，形成可持续输出的品牌内容体系。',
    tradeoff:
      '记忆点最强；复杂矩阵和高密度分析页需要明确的研究模式，避免刊物节奏拖慢查询。',
  },
]

export const DESIGN_PAGES = [
  {
    id: 'seasons',
    name: 'Seasons',
    cn: '战报',
    chapter: '04',
    title: '一季积累，渐有回响。',
    subtitle: '周期、资金与每一次判断，在这里成为一个完整的故事。',
    mapping:
      '周期封面 → 12 项指标详情 → 净值轨迹 → 联赛 / 自然周 / 金额分档 → 分页流水。保留改名、本金编辑与云同步。',
  },
  {
    id: 'new',
    name: 'New',
    cn: '新建',
    chapter: '01',
    title: '让灵感，开始成为判断。',
    subtitle: '用一句自然语言开始，再为每一个判断留下清晰的依据。',
    mapping:
      'Quick Input 放在首屏；组合与单场分层卡片；球队、Entry、Odds、Mode、Conf、TYS、FID、FSE、备注完整保留。历史 FSE 回填可见。',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    cn: '组合',
    chapter: '02',
    title: '让独立的判断，彼此呼应。',
    subtitle: '从备选比赛到组合配置，让风险、资金和偏好处在同一视野。',
    mapping:
      '备选比赛清单 + 约束面板 + 组合方案，依次表达输入、算法、结果。保留风险偏好、Kelly、矩阵约束、组合展开与方案历史。',
  },
  {
    id: 'settle',
    name: 'Settle',
    cn: '结算',
    chapter: '03',
    title: '让结果，照见来时的判断。',
    subtitle: '将比分、评分和赛后笔记收进同一张结算卡。',
    mapping:
      'General Quick Settle 折叠；每一场拥有 AI 输入、原预测、Results、命中状态、AJR / REP 和备注。收入在组合层，最终确认统一保存。',
  },
  {
    id: 'overview',
    name: 'Overview',
    cn: '总览',
    chapter: '05',
    title: '看清全局，然后从容向前。',
    subtitle: '资金蓄水池、收益与风险，构成此刻的完整坐标。',
    mapping:
      '资金蓄水池为主视觉，净值轨迹为中轴；全局 ROI、Kelly、风险摘要与注资记录形成固定层级。',
  },
  {
    id: 'metrics',
    name: 'Metrics',
    cn: '指标',
    chapter: '06',
    title: '每个数字，都能问到底。',
    subtitle: '从指标到样本，建立一条清晰可追溯的阅读路径。',
    mapping:
      '统一指标卡 + 可呼出明细，保留 Conf / Odds / Mode / Entry 矩阵、命中率、Sharpe、连胜连败与相关性分析。',
  },
  {
    id: 'analysis',
    name: 'Analysis',
    cn: '分析',
    chapter: '07',
    title: '在经验里，发现下一次洞察。',
    subtitle: '从联赛、模式和参数的交叉处，寻找值得继续验证的线索。',
    mapping:
      '优势领域、最优组合与矩阵位于研究画布，保留 Position、联赛、Mode、Conf 分组与时间近因。先看样本量，再看结果。',
  },
  {
    id: 'history',
    name: 'History',
    cn: '历史',
    chapter: '08',
    title: '每一次判断，都有来处。',
    subtitle: '日期是一条索引，比赛是一段可以重新打开的记忆。',
    mapping:
      '时间轴外壳 + 标准数据表；组合展开为单场；保留筛选、分页、编辑、删除和备注格式，密集字段通过明细侧页呈现。',
  },
  {
    id: 'teams',
    name: 'Teams',
    cn: '球队',
    chapter: '09',
    title: '熟悉一支球队，也熟悉自己。',
    subtitle: '把赛前认知和赛后反馈，积累成一张不断生长的档案。',
    mapping:
      '搜索与球队索引在前，详情包含样本历史、REP / FSE、状态与个人笔记。球队采用统一几何字母标识，避免徽章风格混杂。',
  },
  {
    id: 'console',
    name: 'Console',
    cn: '控制台',
    chapter: '10',
    title: '复杂在后台，从容在眼前。',
    subtitle: '把参数、校准与数据状态，安放在各自清晰的位置。',
    mapping:
      '核心指标 / 系统配置 / 模型分析 / 校准引擎 / 数据管理分组导航；保留主题、Logo、Git 云同步、Time Machine 和导入导出。',
  },
]

const profits = [
  40, -100, 65, 50, -100, 95, 60, -100, 105, 45, -100, 70, 55, -100, 124, 80,
  -100, 155, 115, -100, 175, 110, -100,
]
profits.push(444 - profits.reduce((sum, value) => sum + value, 0))
const pairs = [
  ['皇马', '皇社'],
  ['热刺', '埃弗顿'],
  ['阿森纳', '利物浦'],
  ['巴萨', '皇马'],
  ['纽卡', '西汉姆'],
  ['拜仁', '多特'],
]
export const SAMPLE_ROWS = profits.map((profit, i) => ({
  id: i + 1,
  date: `09/${String(1 + Math.floor(i / 2)).padStart(2, '0')}`,
  home: pairs[i % 6][0],
  away: pairs[i % 6][1],
  stake: 100,
  profit,
  revenue: 100 + profit,
  roi: profit,
  hit: profit > 0,
  league: ['西甲', '英超', '英超', '西甲', '英超', '德甲'][i % 6],
}))
export const EQUITY = SAMPLE_ROWS.reduce(
  (values, row) => [...values, values.at(-1) + row.profit],
  [1000],
)
let peak = EQUITY[0],
  trough = EQUITY[0],
  maxDrawdown = 0,
  maxRunup = 0
EQUITY.forEach((value) => {
  peak = Math.max(peak, value)
  trough = Math.min(trough, value)
  maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100)
  maxRunup = Math.max(maxRunup, value - trough)
})
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}
const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length
const percentage = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
const allRois = SAMPLE_ROWS.map((row) => row.roi)
const winningRois = SAMPLE_ROWS.filter((row) => row.hit).map((row) => row.roi)
const streak = (hit) => {
  let current = 0,
    longest = 0
  SAMPLE_ROWS.forEach((row) => {
    current = row.hit === hit ? current + 1 : 0
    longest = Math.max(current, longest)
  })
  return longest
}
const best = Math.max(...profits)
export const DEMO_METRICS = [
  ['周期本金', '¥1,000', '开局划拨 · 可编辑'],
  [
    '命中率',
    `${((SAMPLE_ROWS.filter((r) => r.hit).length / 24) * 100).toFixed(1)}%`,
    '按投资单统计',
  ],
  ['投入总额', '¥2,400', '已结算 24 笔'],
  ['收入总额', '¥2,844', '净利润 +¥444'],
  ['最大回撤', `${maxDrawdown.toFixed(1)}%`, '按净值峰谷计算'],
  ['最大升幅', `¥${maxRunup}`, '低点至后续高点'],
  ['最长连胜', `${streak(true)} 笔`, `最长连败 ${streak(false)} 笔`],
  ['单笔最佳', `+¥${best}`, `单笔 ROI +${best}%`],
  ['中位数 ROI', percentage(median(allRois)), '所有已结算单'],
  ['中位数盈利 ROI', percentage(median(winningRois)), '只计盈利单'],
  ['平均 ROI', percentage(mean(allRois)), '单笔 ROI 算术均值'],
  ['平均盈利 ROI', percentage(mean(winningRois)), '只计盈利单'],
]
