---
title: JustLend 资金流向分析看板 v0.2.0 PRD
type: prd
created: 2026-06-04
updated: 2026-06-04
author: Nikki.Feng
---

# JustLend 资金流向分析看板 v0.2.0 PRD

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 产品名称 | JustLend 资金流向分析看板 |
| English Name | JustLend Capital Intelligence Dashboard |
| 版本 | v0.2.0 |
| 状态 | PRD 中 |
| 所属端 | ⚠️ 待确认：当前仓库未提供 `$App / $Portal / $Just_Network / $HEBackend / $Monitoring / $TRONIDE / $AI_Project` 端归属 |
| 默认周期 | 90D |
| 支持周期 | 90D / 30D / 7D |
| 时间口径 | UTC |
| 目标用户 | 管理层、产品团队、增长团队、运营团队、战略团队、风控团队 |

## 2. 背景与目标

JustLend 需要一个资金流向分析看板，用于在 TVL、Supply、Borrow 或大户资金发生波动时，快速判断变化原因，并避免把价格波动、短期资金调度、协议内部流转或地址画像标签误判为真实资金流失。

本期目标：

1. 帮助团队判断 JustLend 在所选周期是否跑输同类 Lending 协议。
2. 判断核心资产 Borrow Demand 是否真实下降。
3. 判断 Top20 大户是否存在未回流资金流出。
4. 判断大户流出资金的一跳强归因目的地。
5. 通过 Data Quality 告知数据覆盖、缺失和归因可信度。

## 3. 用户场景

### 3.1 管理层查看资金健康度

1. 用户打开 Overview。
2. 系统默认展示 90D 核心结论、KPI、主要异常信号和 Data Quality。
3. 用户切换 30D / 7D 查看近期变化。
4. 用户点击异常信号进入对应详情页。
5. 系统展示证据字段，避免只给结论不解释。

### 3.2 运营跟进 Top20 大户

1. 用户进入 Capital Outflow。
2. 用户查看 Top20 Lost 列表。
3. 系统按所选周期未回流资金排序。
4. 用户查看 Round Trip Detail 判断资金是否已回流。
5. 用户查看一跳归因判断资金是否有可信的一跳强归因。
6. 用户查看二跳分析判断未识别一跳地址后续 7D 内是否出现弱线索。

### 3.3 数据 / 管理员调整判断阈值

1. 用户点击 Settings / Data Config。
2. 系统要求 Dashboard 登录。
3. 管理员进入 Thresholds。
4. 管理员调整阈值并填写修改原因。
5. 系统立即影响当前视图判断，但不改写历史异常列表。

## 4. MVP 范围

### 4.1 本期包含

| 模块 | 范围 |
|---|---|
| Overview | 所选周期核心结论、主要异常信号、核心 KPI、Data Quality |
| Market Comparison | JustLend vs Aave / Morpho / Spark / Compound / Venus 的 TVL Change 中位数 |
| Borrow Demand | 按资产展示 Supply、Borrow、Utilization、APY、币本位和 USD 本位变化 |
| Capital Outflow | Top20 Current、Top20 Lost、Round Trip、目的地排行、归因明细 |
| Settings / Data Config | 阈值、内部地址、资产范围、数据源、归因规则配置 |
| CSV 导出 | 支持分析视图导出，不导出配置和审计数据 |

### 4.2 本期不包含

| 功能 | 原因 |
|---|---|
| 实时链上监控 | 本期采用 Daily Snapshot，避免实时链上扫描成本和稳定性风险 |
| Market Share | 跨链协议体量差异容易导致误读，本期只看竞品 TVL Change 中位数 |
| User Journey | 二期再做完整用户旅程 |
| Retention Cohort | 二期 |
| Fund Source Analysis | 二期 |
| 独立 Alert Center | 本期并入 Overview 主要异常信号 |
| AI 分析助手 | 三期 |
| 自动生成报告 | 三期 |

### 4.3 资产与竞品范围

| 类型 | 范围 |
|---|---|
| JustLend 资产 | USDT / USDD / TRX / sTRX / BTC / ETHB / ETH |
| 竞品协议 | Aave / Morpho / Spark / Compound / Venus |

## 5. 页面与交互

### 5.1 全局布局

| 区域 | 内容 |
|---|---|
| 左侧导航 | Overview、Market Comparison、Borrow Demand、Capital Outflow、Settings / Data Config |
| 顶部操作区 | 登录状态、导出 CSV、视图周期、Data Through、Snapshot Built |
| 视图周期 | 90D / 30D / 7D |

周期切换后，Overview、Market Comparison、Borrow Demand、Capital Outflow 的 KPI、趋势、表格和异常信号必须跟随当前周期变化。

### 5.2 Overview

Overview 是管理层入口。

| 区块 | 展示内容 |
|---|---|
| 核心结论 | 一句话说明本周期主要变化和最重要异常信号 |
| KPI | TVL Change、Supply Change、Borrow Change、High Util Assets、Net Flow |
| 主要异常信号 | 跑输竞品、Borrow Demand 下降、Top20 未回流资金、单个大户撤资、目的地集中等 |
| Round Trip 摘要 | 主动提出、已回流、未回流、平均离开时长 |
| Data Quality | 数据覆盖、数据缺失、归因命中率、Unknown 占比 |

### 5.3 Market Comparison

Market Comparison 用于判断 JustLend 是否跑输同类 Lending 协议。

| 展示项 | 规则 |
|---|---|
| JustLend TVL Change | 展示所选周期变化金额和变化率 |
| 竞品 TVL 中位数 | 展示 Aave / Morpho / Spark / Compound / Venus 的 TVL Change 中位数 |
| 相对差值 | 展示 JustLend 与竞品中位数差异 |
| TVL 趋势 | 必须展示图例，说明两种颜色含义 |

### 5.4 Borrow Demand

Borrow Demand 用于判断 TVL 下降是否来自真实借款需求变化。

| 列 | 含义 |
|---|---|
| Supply Change USD | 所选周期 Supply 变化金额 |
| Borrow Change USD | 所选周期 Borrow USD 变化金额 |
| Borrow Amount Change | 币本位借款数量变化 |
| Price Change | 资产价格变化 |
| Utilization | 当前利用率 |
| Borrow APY / Supply APY | 当前 APY 及变化 |
| 判断 | 正常观察、价格影响、需求下降待确认等 |

### 5.5 Capital Outflow

二级 Tab：

```text
Top20 Current
Top20 Lost
Round Trip Detail
Destination Ranking
一跳归因
二跳分析
```

| Tab | 展示规则 |
|---|---|
| Top20 Current | 排除内部地址后，按当前 Supply USD 排名前 20 |
| Top20 Lost | 排除内部地址后，按所选周期 `unreturned_outflow_usd` 排名前 20 |
| Round Trip Detail | 展示 returned / partially_returned / not_returned |
| Destination Ranking | 只统计可进入 Overview 的 Hop 1 强归因目的地 |
| 一跳归因 | 展示 Hop 1 直接去向、标签来源、置信度和是否进入 Overview |
| 二跳分析 | 展示 Hop 1 地址后续 7D 内的 Hop 2 弱线索、时间间隔、金额匹配比例和证据 |

### 5.6 Settings / Data Config

Settings 仅管理员可进入，公开分析页不需要登录。

二级 Tab：

```text
Thresholds
Internal Address
Asset Scope
Data Sources
Attribution Rules
```

## 6. 业务规则

BR-001：全部事件时间、快照时间、页面展示时间均使用 UTC。

BR-002：页面必须同时展示 Data Through 和 Snapshot Built。Data Through 表示数据覆盖到的最后一个完整 UTC 日；Snapshot Built 表示快照生成时间。

BR-003：如果目标日数据未成功获取，系统不得发布“Snapshot Built 已更新但 Data Through 未覆盖目标日”的误导性快照。

BR-004：周期切换必须影响 Overview、Market Comparison、Borrow Demand、Capital Outflow 的 KPI、趋势、表格和异常信号。

BR-005：如果 30D / 7D 没有真实周期快照，不得用 90D 简单除法生成结论，只能展示 derived / unavailable 状态。

BR-006：Top20 Current 按排除内部地址后的当日 `supply_usd` 排名前 20。

BR-007：Top20 Lost 按排除内部地址后的所选周期 `unreturned_outflow_usd` 排名前 20。

BR-008：`supply_usd` 表示用户在 JustLend 全部 Supply 资产的 USD 总价值。

BR-009：用户资金流出只统计 Supply 侧主动 Withdraw / Redeem，不统计 Repay、Borrow、清算、关闭抵押开关或价格波动。

BR-010：Round Trip 用于判断主动 Withdraw / Redeem 后是否重新 Supply / Deposit 回 JustLend。

BR-011：Round Trip 状态必须包含 returned、partially_returned、not_returned。

BR-012：`net_outflow_usd` 只能作为辅助展示，不得单独用于判断大户流失。

BR-013：Top20 Lost 主判断使用 `unreturned_outflow_usd / beginning_supply_usd`。

BR-014：Hop 1 为 24h 强归因，允许进入 Overview 主判断。

BR-015：Hop 2 为 7D 弱归因，只能用于详情页辅助解释，不得进入 Overview 主判断。

BR-016：Unknown / 待链上归因必须保留，不得强行解释。

BR-017：JustLend market、jToken、协议合约等协议内部目的地必须跳过，不得作为外部资金流出强归因。

BR-018：目的地标签优先级为共享地址库、TronScan、Arkham、Unknown。

BR-019：Arkham 默认关闭。未配置 Arkham API key 时，不影响快照和页面展示。

BR-020：共享地址库中 `j* holder`、`j* participant` 只能作为地址画像或地址库命中说明，不得作为资金流出目的地强归因。

BR-021：`jHTX holder` 不代表流向 jHTX，也不代表 HTX 交易所。

BR-022：只发现 CEX-HTX 转入记录时，只能作为资金来源线索，不得作为当前资金流出目的地。

BR-023：Borrow Demand 判断不能只看 `borrow_usd`；只有 `borrow_usd` 和 `borrow_amount` 同步下降时，才可判断为真实 Borrow Demand 下降。

BR-024：若 `borrow_usd` 下降但 `borrow_amount` 稳定或上升，应判断为价格影响。

BR-025：阈值修改后只影响当前视图判断，不重新拉取链上数据，不改写历史异常列表。

BR-026：一跳归因只展示 Hop 1 直接去向；二跳分析单独展示 Hop 1 到 Hop 2 的弱线索，二者不得混用为同一结论。

BR-027：二跳分析即使命中 CEX、协议或 TRON Eco 标签，也只能作为弱线索，不得进入 Overview 主判断和 Destination Ranking 强归因统计。

BR-026：阈值和内部地址修改必须填写修改原因并记录修改日志。

BR-027：所有看板数据 API、CSV 导出、Settings / Data Config 和 Settings API 必须要求 Dashboard 登录。

BR-028：未登录用户只能看到登录入口，不得读取看板数据、链上路径、Top20 地址、CSV 导出、Settings、内部地址配置和阈值修改日志。

## 7. 数据口径与 Data Quality

### 7.1 数据来源

| 数据 | MVP 数据源 |
|---|---|
| JustLend 资产级存借款 | `exportLendInfo` |
| Top Account / 用户仓位 | `getDailyTopAccountDetails` 或已上传 CSV |
| 价格 | 每日 UTC 00:00 快照价；生产导出中已有参考价时可作为统一趋势价格源 |
| 竞品 TVL | DeFiLlama |
| 竞品 Borrow | ⚠️ 待确认：协议 API 或已有数据源；缺失时标 TODO |
| 地址标签 | 共享地址库、TronScan、Arkham 可选 |
| 内部地址 | Settings 页面维护 |

### 7.2 Data Quality 展示项

| 项 | 展示规则 |
|---|---|
| Data Through | 当前快照实际覆盖到的最后一个完整 UTC 日 |
| Snapshot Built | 快照生成时间 |
| 目标日数据完整性 | 展示 complete / partial / error |
| 周期起始日快照 | 展示 90D / 30D / 7D 起始日是否完整 |
| 竞品 Borrow | 缺失时展示 TODO / Data unavailable |
| DeFiLlama TVL | 缺失或延迟时展示 Data Quality |
| 价格 | 缺失或延迟时展示 Data Quality |
| Unknown / 待链上归因占比 | 保留占比，不强行解释 |
| 地址库命中率 | 展示 address book hit rate |
| TronScan 标签命中率 | 展示 TronScan tag hit rate |
| Arkham 标签命中率 | 未启用时展示 disabled |
| 协议内部目的地跳过数量 | 展示 skipped count |

## 8. UI 文案规格

| 场景 | 中文文案 | English Copy |
|---|---|---|
| 页面标题 - Overview | 总览 | Overview |
| 页面副标题 - Overview | 所选周期资金变化、主要异常信号和大户回流摘要。 | Capital changes, key signals, and whale return summary for the selected period. |
| 页面标题 - Market Comparison | 竞品对比 | Market Comparison |
| 页面副标题 - Market Comparison | JustLend 与所选竞品 TVL Change 中位数对比。 | JustLend vs selected competitor median TVL Change. |
| 页面标题 - Borrow Demand | 借贷需求分析 | Borrow Demand |
| 页面副标题 - Borrow Demand | 同时查看 Borrow USD 和 Borrow Amount，区分真实需求下降与价格影响。 | Compare Borrow USD and Borrow Amount to separate demand decline from price impact. |
| 页面标题 - Capital Outflow | 大户资金流出 | Capital Outflow |
| 页面副标题 - Capital Outflow | 查看 Top20 Current、Top20 Lost、Round Trip 和资金去向归因。 | Review Top20 Current, Top20 Lost, Round Trip, and destination attribution. |
| 页面标题 - Settings | 数据与口径配置 | Settings / Data Config |
| 待链上归因 | 待链上归因 | Pending chain attribution |
| 地址画像命中 | 地址库用户 | Address book user |
| 已回流 | 已回流 | Returned |
| 无流出 | 无流出 | No outflow |
| 导出按钮 | 导出 CSV | Export CSV |
| Dashboard 登录 | 请输入看板账号和密码 | Enter dashboard username and password |
| 未登录 | 看板数据、链上路径和 CSV 导出需要登录后查看。 | Dashboard data, chain paths, and CSV export require login. |
| 竞品 TVL 中位数说明 | Aave、Morpho、Spark、Compound、Venus 在所选周期内 TVL Change 的中位数，不是 Market Share。 | Median TVL Change of Aave, Morpho, Spark, Compound, and Venus in the selected period; not Market Share. |
| 相对差值说明 | 相对差值 = JustLend TVL Change - 竞品 TVL Change 中位数。 | Relative difference = JustLend TVL Change - competitor median TVL Change. |
| Data Through 说明 | 当前快照实际覆盖到的最后一个完整 UTC 日。 | Last complete UTC date covered by the current snapshot. |
| Snapshot Built 说明 | 本次快照生成时间。 | Snapshot generation time. |

## 9. 异常场景

| 场景 | 触发条件 | 系统行为 | UI 表现 |
|---|---|---|---|
| 目标日数据缺失 | 每日任务未获取到前一完整 UTC 日数据 | 保留上一版可用快照 | Data Quality 显示 error，不更新 Data Through |
| 30D / 7D 无真实快照 | 缺少对应周期数据 | 不用 90D 简单除法生成结论 | 显示 derived / unavailable |
| 链上路径未命中 | Hop 1 / Hop 2 未找到可解释去向 | 保留 Unknown | 表格展示“待链上归因” |
| Hop 1 命中 jToken / market | 目的地为协议内部地址 | 跳过外部归因 | 不进入 Destination Ranking |
| 只命中 `j* holder / participant` | 地址库仅提供用户画像标签 | 降级为地址库用户 | 主展示“地址库用户”，详情保留原始角色 |
| 只发现 CEX-HTX 转入记录 | 该地址曾从 CEX-HTX 收款 | 不作为流出目的地 | 不展示为“流向 HTX” |
| Borrow 数据缺失 | 竞品 Borrow 源不可用 | Borrow 中位数不参与计算 | 显示 TODO / Data unavailable |
| Arkham 未启用 | 未配置 Arkham API key 或开关关闭 | 不请求 Arkham | Data Quality 显示 Arkham disabled |
| 未登录访问看板数据 | 未登录请求数据 API 或 CSV | 返回 401 | 前端显示 Dashboard 登录提示 |
| 未登录访问 Settings | 未登录访问 Settings | 阻止查看和修改 | 显示 Dashboard 登录提示 |
| CSV 导出无数据 | 当前视图数据为空 | 导出空结果或提示无数据 | 按页面状态展示空态 |

## 10. 埋点与指标

### 10.1 使用埋点

| 事件名 | 触发时机 | 关键属性 |
|---|---|---|
| `capital_dashboard_view` | 用户打开任一页面 | page、period、data_through |
| `capital_period_change` | 用户切换 90D / 30D / 7D | from_period、to_period、page |
| `capital_signal_click` | 用户点击主要异常信号 | signal_type、period、confidence |
| `capital_outflow_tab_click` | 用户切换 Capital Outflow Tab | tab、period |
| `capital_csv_export` | 用户导出 CSV | dataset、period、row_count |
| `capital_admin_login` | 管理员登录 | success、reason |
| `capital_threshold_update` | 管理员修改阈值 | threshold_key、old_value、new_value、reason |

### 10.2 产品效果指标

| 指标 | 说明 |
|---|---|
| 看板日活查看人数 | 观察目标用户是否使用看板 |
| 周期切换使用率 | 判断 30D / 7D 是否有实际使用价值 |
| 异常信号点击率 | 判断 Overview 信号是否有效引导分析 |
| CSV 导出次数 | 判断线下复盘和汇报需求 |
| Settings 修改次数 | 判断阈值配置是否被实际使用 |
| Data Quality error 天数 | 衡量生产数据链路稳定性 |
| 待链上归因占比 | 衡量链上归因覆盖能力 |

## 11. 验收标准

| 验收项 | 标准 |
|---|---|
| UTC 口径 | 所有事件、快照、页面 Data Through / Snapshot Built 均使用 UTC |
| 周期切换 | 90D / 30D / 7D 切换后，所有分析页面核心数据跟随变化 |
| 真实周期数据 | 不允许用 90D 简单除法生成 30D / 7D 结论 |
| Data Through | 目标日缺失时不更新误导性快照 |
| Top20 Current | 排除内部地址后展示 20 条 |
| Top20 Lost | 按所选周期 `unreturned_outflow_usd` 排名 |
| Round Trip | 展示 returned / partially_returned / not_returned |
| `net_outflow_usd` | 只辅助展示，不作为流失主判断 |
| Borrow Demand | 同时展示 `borrow_usd` 和 `borrow_amount` |
| Overview 归因 | 只使用 Hop 1 强归因 |
| Hop 2 | 只在详情页辅助展示 |
| Unknown | 保留 Unknown / 待链上归因占比 |
| 协议内部地址 | jToken / market 不得作为外部资金流出强归因 |
| 地址画像标签 | `j* holder / participant` 不得作为外部目的地强归因 |
| Data Quality | 展示地址库、TronScan、Arkham 命中率和协议内部目的地跳过数量 |
| 权限 | 看板数据、CSV 导出和 Settings 均需要 Dashboard 登录 |
| CSV 导出 | 支持分析视图导出，不导出 Settings 和审计数据 |
| UI 文案 | 本 PRD「UI 文案规格」中英文文案均可在页面或 tooltip 中对应 |

## 12. ⚠️ 待确认项与变更记录

### 12.1 ⚠️ 待确认项

| 待确认项 | 原因 |
|---|---|
| ⚠️ 所属端 | 当前仓库未提供 `$App / $Portal / $Just_Network / $HEBackend / $Monitoring / $TRONIDE / $AI_Project` 端归属 |
| ⚠️ Borrow 数据源 | 竞品 Borrow 中位数是否能接入协议 API 或已有数据源 |
| ⚠️ Arkham 是否启用 | 是否采购或配置 Arkham API key；默认关闭 |
| ⚠️ 链上归因额度 | TronScan / TronGrid 调用额度决定 Top20 Lost 查找上限 |
| ⚠️ 地址库维护责任人 | 共享地址库更新频率、第三方标签比对流程和责任人 |
| ⚠️ CoinMarketCap 映射 | USDT / USDD / TRX / sTRX / BTC / ETHB / ETH asset id 需定期复核 |
| ⚠️ JustLend market 映射 | 资产、jToken、market 地址需定期复核，避免内部地址误判 |

### 12.2 变更记录

| 日期 | 变更 |
|---|---|
| 2026-06-04 | 按 `justlend-kb-skill-staging` 真实规则重构 PRD：补 frontmatter、BR 编号、UI 中英文文案、异常场景、埋点指标、验收标准和待确认项 |
