# inspiration 2609 — 选定组合的设计预览

用户选择后的正式设计方向，当前先提供隔离的设计预览，尚不替换使用中的主题。

| 页面 | 材质 |
|---|---|
| New、Portfolio | Folio Lab |
| Settle | Glacier |
| Dashboard Overview / Metrics / Analysis | Prism，小圆角 |
| History Records / Teams | Prism，小圆角 |
| Seasons | 原有彩色版本，完全不挂载 Lab 样式 |
| Console | 原 Modern 原色版本，完全不挂载 Lab 样式 |

顶栏直接使用原 ModernTopBar。顶栏不在 Lab 样式容器之内，保留贴顶、宽度、导航、品牌标识与原有主题切换动效；仅 Folio / Glacier / Prism 页面轻调顶栏底色。没有方案切换条压在顶栏上方。

Prism 主卡片圆角 10px，次级容器 8px，输入与按钮 6px。圆形徽标、图表节点和 Logo 不改。Folio 与 Glacier 沿用上一轮的选定材质和原业务组件。

入口：`/design/inpiration/new?edition=2609`。仍支持 `/arsenal/design/inpiration/new?edition=2609`，两者都只操作内存演示数据。原四套方案的显式 `edition` 链接继续可用。

预览顶栏的 Modern / inspiration 切换只比较当前页外观，不写入正式布局偏好；Seasons、Console 在两种外观下都保持原样。Console 的新主题展示名称统一为 `inspiration 2609`，内部兼容键仍是 `inpiration`。

这轮不修改数据模型、AI 请求、结算判定、指标计算或云同步流程。后续确认后可直接复用同一壳层接入正式主题，无需重新实现页面。
