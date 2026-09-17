# inspiration 2609 — 正式组合主题

用户选择后的正式主题。正常应用中选择 inspiration 即启用，Modern 保持原样，设计预览继续独立提供。

| 页面 | 材质 |
|---|---|
| New、Portfolio | Folio Lab |
| Settle | Glacier |
| Dashboard Overview / Metrics / Analysis | Prism，小圆角 |
| History Records | Prism，小圆角，原 Modern 页面宽度 |
| History Teams | 原 Modern 卡片与布局，淡橙几何底色 |
| Seasons | Prism，页面宽度与留白沿用 Modern，顶部大幻彩海报保留原样 |
| Console | 原 Modern 原色版本，完全不挂载 Lab 样式 |

顶栏直接使用原 ModernTopBar。顶栏不在 Lab 样式容器之内，保留贴顶、宽度、导航、品牌标识与原有主题切换动效；仅 Folio / Glacier / Prism 页面轻调顶栏底色。没有方案切换条压在顶栏上方。

Prism 主卡片圆角 10px，次级容器 8px，输入与按钮 6px。圆形徽标、图表节点和 Logo 不改。Folio 与 Glacier 沿用上一轮的选定材质和原业务组件。

入口：`/design/inpiration/new?edition=2609`。仍支持 `/arsenal/design/inpiration/new?edition=2609`，两者都只操作内存演示数据。原四套方案的显式 `edition` 链接继续可用。

预览顶栏的 Modern / inspiration 切换只比较当前页外观，不写入正式布局偏好。正式入口仍沿用原布局偏好保存与云同步。两种按钮使用相同材质，只区分图标与文案；原 Demo / Live 呼吸灯复用，设计预览不能解锁真实数据。Console 的新主题展示名称统一为 `inspiration 2609`，内部兼容键仍是 `inpiration`。

Portfolio 大屏第一行：备选比赛 / 智能组合包 / 分层投资建议；第二行：单组合排序 / 算法说明。窄屏自动换行，直接移动原有卡片，不复制业务状态。Settle 与 Records 恢复 Modern 的内容宽度和留白；所有滑杆保留原橙色按钮。

Portfolio 的备选比赛每次进入默认折叠（Demo / Live 一致），仍可手动展开。Inspiration 的桌面空状态上排统一底线，下排排序与算法说明等高，并为提示保留居中的纵向留白；生成方案后，上排各卡片按内容独立增长，分层建议保持适度最小高度，不被长组合明细无限拉伸。移动端不强制桌面最小高度。

这轮不修改数据模型、AI 请求、结算判定、指标计算或云同步流程。只修改演示种子的周期标题为“世界杯26周期”，不覆盖任何真实周期标题。
