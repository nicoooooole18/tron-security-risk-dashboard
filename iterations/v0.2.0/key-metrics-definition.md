---
title: JustLend 资金流向看板关键指标说明
type: checklist
updated: 2026-06-05
created: 2026-06-05
---

# JustLend 资金流向看板关键指标说明

本文档用于统一 JustLend Capital Intelligence Dashboard v0.2.0 的指标定义、计算口径、判定规则和不参与判断的边界。页面默认使用 UTC 日期，快照每日在 UTC 00:00 后汇总最近一个完整 UTC 日数据。

## 1. 指标使用原则

BR-001：所有指标必须跟随页面选择周期变化。当前支持 7D、30D、90D。

BR-002：所有金额类指标默认使用 USD 口径。资产数量类指标保留币本位口径，用于区分价格影响和真实数量变化。

BR-003：价格口径使用每日 UTC 00:00 快照价。同一趋势窗口内必须使用同一价格源。

BR-004：内部地址默认从 Top20、资金流向、异常信号和归因统计中排除。

BR-005：`net_outflow_usd` 只作为辅助展示，不得单独用于判断大户流失。

BR-006：Unknown、待链上归因、一跳地址未识别、疑似用户钱包、黑洞/销毁地址必须保留原始状态，不得强行解释为外部流失目的地。

BR-007：阈值配置页修改阈值后，只影响当前视图的异常判断，不重拉链上数据，不改写历史原始指标。

## 2. 周期与快照指标

| 指标 | 定义 | 判定 / 使用规则 |
|---|---|---|
| Data Through | 当前快照覆盖到的最后一个完整 UTC 日期 | 如果目标日数据未覆盖，不得只更新 Snapshot Built |
| Snapshot Built | 当前快照生成时间 | 仅表示快照生成时间，不表示数据一定覆盖到当天 |
| UTC Window | 当前视图周期起止日期 | 7D / 30D / 90D 切换后，KPI、表格和异常信号必须同步变化 |
| Period Start Value | 周期起始日指标值 | 用于计算周期变化金额和变化率 |
| Period End Value | 周期结束日指标值 | 通常等于 Data Through 当日值 |

## 3. Overview KPI

| KPI | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| TVL Change | JustLend 所选资产范围内 TVL 的周期变化 | `period_end_tvl_usd - period_start_tvl_usd`；变化率为变化额 / 起始值 | 只反映 JustLend 体量变化，不单独解释原因 |
| Supply Change | JustLend 所选资产范围内 Supply USD 的周期变化 | `period_end_supply_usd - period_start_supply_usd` | 需结合 Borrow Demand 和 Capital Outflow 判断 |
| Borrow Change | JustLend 所选资产范围内 Borrow USD 的周期变化 | `period_end_borrow_usd - period_start_borrow_usd` | 借款需求判断必须同时查看 Borrow USD 和 Borrow Amount |
| High Util Assets | 高利用率资产数量 | 所选 7 个 MVP 资产中，当前或周期起始利用率超过 60% 的资产数量 | 展示为 `N / 7`，用于识别高利用率压力，不展示加权平均利用率 |
| Net Flow | Top20 资金净流出辅助指标 | 以 Top20 资金变化聚合展示 | 辅助展示，不得单独判断大户流失 |

## 4. Market Comparison 指标

| 指标 | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| JustLend TVL Change | JustLend 在所选周期内 TVL 变化 | 周期结束 TVL - 周期起始 TVL | 展示变化金额和变化率 |
| 竞品 TVL 中位数 | Aave、Morpho、Spark、Compound、Venus 在所选周期内 TVL Change 的中位数 | 取 5 个竞品 TVL Change 的中位数 | 不是 Market Share，不表示全市场份额 |
| 相对差值 | JustLend 与竞品 TVL 中位数的差距 | `JustLend TVL Change - 竞品 TVL Change 中位数` | 正数表示 JustLend 跑赢竞品中位数，负数表示跑输 |
| 竞品 Borrow 中位数 | 竞品 Borrow 变化中位数 | ⚠️ 待确认：协议 API 或已有数据源 | MVP 标 TODO，不参与判定 |

### 4.1 Market Comparison 异常规则

| 异常信号 | 默认阈值 | 判定规则 |
|---|---:|---|
| 跑输竞品中位数 | `> 5 pct_point` | 当 JustLend TVL Change 变化率低于竞品 TVL Change 中位数超过 5 个百分点时触发 |

## 5. Borrow Demand 指标

| 指标 | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| Supply USD | 当前资产 Supply 的 USD 价值 | 当前币本位 Supply × 当前快照价 | 会受价格波动影响 |
| Supply Change USD | 所选周期 Supply USD 变化金额 | 周期结束 Supply USD - 周期起始 Supply USD | 用于观察资金规模变化 |
| Borrow USD | 当前资产 Borrow 的 USD 价值 | 当前币本位 Borrow × 当前快照价 | 会受价格波动影响 |
| Borrow Change USD | 所选周期 Borrow USD 变化金额 | 周期结束 Borrow USD - 周期起始 Borrow USD | 不能单独判断真实需求下降 |
| Borrow Amount Change | 币本位借款数量变化 | 周期结束 Borrow Amount - 周期起始 Borrow Amount | 用于剔除价格影响 |
| Price Change | 资产价格变化 | 周期结束快照价 - 周期起始快照价 | 用于解释 USD 指标波动 |
| Utilization | 当前池子利用率 | `borrow_usd / supply_usd` | 不做全市场加权平均，单资产展示 |
| Borrow APY | 当前借款年化利率 | 来自 JustLend 数据源 | 用于辅助判断需求和资金成本 |
| Supply APY | 当前存款年化收益率 | 来自 JustLend 数据源 | 用于辅助判断资金吸引力 |

### 5.1 Borrow Demand 判定规则

| 判断标签 | 触发条件 | 含义 |
|---|---|---|
| 正常观察 | Borrow USD 与 Borrow Amount 未同步明显下降 | 暂无明确真实需求下降信号 |
| 价格影响 | Borrow USD 下降，但 Borrow Amount 稳定或上升 | USD 下降主要可能来自价格变化 |
| 需求下降待确认 | Borrow USD 与 Borrow Amount 同步下降，且超过阈值 | 需要结合 APY、Utilization 和市场情况复核 |

| 异常信号 | 默认阈值 | 判定规则 |
|---|---:|---|
| 核心资产 Borrow 下降 | `< -10%` | Borrow USD Change < -10%，且 Borrow Amount 同步下降时才可作为真实需求下降信号 |

## 6. Capital Outflow 指标

### 6.1 Top20 Current

| 指标 | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| Top20 Current | 当前 Supply USD 排名前 20 的用户地址 | 排除内部地址后，按当前 `supply_usd` 排序取前 20 | 只表示当前大户结构 |
| Supply | 当前用户在 JustLend 全部 Supply 资产的 USD 总价值 | 用户各资产 Supply USD 求和 | 不包含 Borrow 侧 |
| Borrow | 当前用户在 JustLend 全部 Borrow 资产的 USD 总价值 | 用户各资产 Borrow USD 求和 | 用于判断用户净头寸 |
| Net Position | 用户净头寸 | `supply_usd - borrow_usd` | 辅助判断用户风险和资金规模 |
| Primary Asset | 用户主要 Supply 资产 | 用户 Supply USD 最大的资产 | 用于辅助运营跟进 |

### 6.2 Top20 Lost

| 指标 | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| Top20 Lost | 所选周期未回流资金流出排名前 20 的用户 | 排除内部地址后，按 `unreturned_outflow_usd` 降序取前 20 | 只分析 Top20 大户 |
| Beginning Supply | 周期起始日用户 Supply USD | 该用户在周期起始日的全资产 Supply USD | 用于计算未回流占比 |
| Gross Withdraw | 周期内主动 Withdraw / Redeem 总额 | 按资产币本位 Supply Amount 下降计算，再折算 USD | 不把价格下跌计为流出 |
| Returned | 周期内已回流金额 | 已重新 Supply / Deposit 回 JustLend 的金额 | 用于判断是否只是短期资金调度 |
| Unreturned | 周期结束仍未回流金额 | `gross_withdraw_usd - returned_outflow_usd` | Top20 Lost 主排序指标 |
| Return Rate | 回流率 | `returned_outflow_usd / gross_withdraw_usd` | 越低表示未回流风险越高 |
| Price Effect USD | 价格影响金额 | Supply USD 下降中由价格变化造成的部分 | 不进入 Top20 Lost 判断 |

### 6.3 Top20 Lost 异常规则

| 异常信号 | 默认阈值 | 判定规则 |
|---|---:|---|
| Top20 未回流资金占期初 Supply | `> 5%` | `Top20 90D 未回流流出资金 / Top20 期初 Supply > 5%` |
| 单个大户未回流流出金额 | `> 200,000 USD` | 单个用户所选周期 `unreturned_outflow_usd > 200,000` |

BR-008：Top20 Lost 只能基于真实资产数量下降判断，不得用 `supply_usd` 下降直接判断。

BR-009：如果某地址在周期内没有主动 Withdraw / Redeem 或 Supply Amount 下降，不得进入 Top20 Lost。

## 7. Round Trip 指标

| 指标 | 定义 | 计算口径 | 判定 / 说明 |
|---|---|---|---|
| Round Trip | 主动 Withdraw / Redeem 后重新 Supply / Deposit 回 JustLend 的资金调度记录 | 按同地址、同资产或可匹配资产回流识别 | 用于区分大户流失和短期资金调度 |
| Outflow Time | 资金流出时间 | 主动 Withdraw / Redeem 或资产数量下降对应时间 | 使用 UTC |
| Return Time | 资金回流时间 | Supply / Deposit 回 JustLend 的时间 | 无回流则为空 |
| Time Away | 资金离开时长 | Return Time - Outflow Time；无回流时用周期结束时间估算 | 辅助判断资金离开持续性 |
| Status | 回流状态 | returned / partially_returned / not_returned | 必须保留三种状态 |

### 7.1 Round Trip 状态规则

| 状态 | 定义 |
|---|---|
| returned | 流出资金已全部或近似全部回流 |
| partially_returned | 流出资金部分回流，仍存在未回流余额 |
| not_returned | 周期结束时未识别到回流 |

## 8. 链上归因指标

| 指标 | 定义 | 判定 / 使用规则 |
|---|---|---|
| Hop 1 | 流出后 24h 内的一跳资金去向 | 可作为强归因候选，但必须排除协议内部地址和非结论标签 |
| Hop 2 | Hop 1 地址后续 7D 内的下一跳去向 | 只进入二跳分析，不进入 Overview 主判断 |
| Destination Ranking | 强归因目的地排行 | 只统计 Hop 1 且 `usedInOverview=true` 的外部目的地 |
| 一跳归因 | Hop 1 归因明细 | 展示 Hop 1 直接去向、目的地类别、置信度和是否进入 Overview |
| 二跳分析 | Hop 1 到 Hop 2 的弱线索分析 | 展示 Hop 1、Hop 2、时间间隔、金额匹配比例和证据 |
| Unknown / 待链上归因 | 未找到可解释链上去向 | 必须保留，不得强行解释 |

### 8.1 归因等级定义

| 归因等级 | 中文展示 | 定义 | 是否进入 Overview / Destination Ranking |
|---|---|---|---|
| `strong` | 强归因 | Hop 1 命中可信外部实体，如 CEX、明确外部协议或可解释 TRON Eco 目的地 | 是 |
| `weak` | 弱归因 | Hop 2 命中可信实体，或链路距离更远、可信度较低 | 否 |
| `profile` | 疑似用户钱包 / 非目的地标签 | 地址库画像标签，例如 `j* holder`、`j* participant` | 否 |
| `system_sink` | 黑洞/销毁地址 | blackhole、burn、dead、zero address、黑洞、销毁等系统地址 | 否 |
| `unlabeled_hop` | 一跳地址未识别 | 只确认一跳接收地址，未确认实体归属 | 否 |
| `pending` | 待链上归因 | 当前窗口内未找到可解释链上路径 | 否 |
| `returned` | 已回流 | 资金已回流 JustLend | 否 |
| `none` | 无流出 | 未识别到真实主动流出 | 否 |

BR-010：`jHTX holder`、`j* holder`、`j* participant` 只能作为地址画像，不得解释为资金流向 jHTX 或对应 jToken。

BR-011：黑洞/销毁地址只表示资金进入不可花费或系统接收地址，不等同于外部目的地流失。

BR-012：一跳地址未识别只表示链上存在接收地址，可能是同一用户钱包、中转地址或外部平台地址，不得直接作为流失结论。

### 8.2 二跳分析指标

| 指标 | 定义 | 判定 / 使用规则 |
|---|---|---|
| Source Address | Top20 Lost 用户地址 | 用于关联原始大户流出 |
| Outflow Amount | Hop 1 对应的未回流流出金额 | 作为二跳金额匹配的参照 |
| Hop 1 | 一跳接收地址或标签 | 只表示直接去向，不代表最终目的地 |
| Hop 1 Type | Hop 1 归因等级 | strong / profile / system_sink / unlabeled_hop / pending 等 |
| Hop 2 | Hop 1 地址后续 7D 内的接收地址或标签 | 只作为弱线索 |
| Hop 2 Type | Hop 2 地址类别 | CEX / TRON Eco / User Wallet / Unlabeled Hop / Blackhole / Burn 等 |
| Time Delta | Hop 1 到 Hop 2 的时间间隔 | 用于判断链路相关性 |
| Amount Match | Hop 2 金额与 Hop 1 流出金额的匹配比例 | 只能辅助判断，不能单独作为归因结论 |
| Evidence | Hop 2 交易哈希 | 用于人工复核 |

BR-013：二跳分析不得进入 Overview 主判断和 Destination Ranking。

BR-014：如果 Hop 2 命中 CEX、协议或 TRON Eco 标签，只能展示为弱线索，不得直接表述为用户流失到该目的地。

BR-015：如果 Hop 2 仍为裸地址，展示为“二跳地址未识别”或“一跳地址未识别”同类非结论状态。

## 9. Data Quality 指标

| 指标 | 定义 | 判定 / 说明 |
|---|---|---|
| 数据覆盖状态 | 当前快照是否覆盖目标 UTC 日期 | 未覆盖时必须提示，不得静默生成误导快照 |
| 真实数据模式 | 当前是否使用 SQLite Daily Snapshot | 生产页面应展示 `SQLITE_DAILY_SNAPSHOT` |
| 地址库命中率 | 地址库标签命中数 / 地址库查询数 | 用于评估本地标签覆盖能力 |
| TronScan 命中率 | TronScan 标签命中数 / TronScan 查询数 | 用于评估链上标签覆盖能力 |
| Arkham 命中率 | Arkham 标签命中数 / Arkham 查询数 | Arkham 默认关闭，未配置 key 不影响页面 |
| Unknown 占比 | 未归因资金占未回流资金比例 | 保留为 Data Quality，不强行解释 |
| 协议内部地址跳过数 | jToken、market、协议合约等被跳过的数量 | 用于避免把协议内部流转误判为外部流失 |

## 10. 阈值配置项

| 配置项 | 默认值 | 作用范围 | 判定规则 | 是否默认开启 |
|---|---:|---|---|---|
| 跑输竞品中位数 | `5 pct_point` | 全局 | JustLend TVL Change 低于竞品 TVL Change 中位数超过 5 个百分点 | 是 |
| 核心资产 Borrow 下降 | `-10%` | 资产 | Borrow USD Change < -10%，且 Borrow Amount 同步下降 | 是 |
| Top20 未回流资金占期初 Supply | `5%` | 全局 | Top20 未回流资金 / Top20 期初 Supply > 5% | 是 |
| 单个大户未回流流出金额 | `200,000 USD` | 地址 | 单地址未回流流出金额超过 200,000 USD | 是 |
| 目的地集中占比 | `30%` | 全局 | 单一强归因目的地占强归因资金比例超过 30% | 是 |
| Hop 1 强归因窗口 | `24h` | 全局 | 流出后 24h 内的一跳去向 | 是 |
| Hop 2 弱归因窗口 | `7D` | 全局 | Hop 1 后 7D 内的后续去向 | 是 |
| 抵押意愿下降金额 | `1,000,000 USD` | 地址 | ⚠️ 待确认：抵押关闭意愿相关指标 | 否 |

## 11. 不参与主判断的指标和状态

| 项目 | 不参与原因 | 页面处理 |
|---|---|---|
| `net_outflow_usd` | 可能混合短期调度和回流，不能单独判断流失 | 只辅助展示 |
| Hop 2 弱归因 | 跳数更远，因果关系弱 | 只进二跳分析 |
| `profile` 地址画像 | 只能说明地址历史画像，不能说明当前资金目的地 | 显示“疑似用户钱包”或“非目的地标签” |
| `system_sink` 黑洞/销毁地址 | 不等同于外部流失目的地 | 显示“黑洞/销毁地址” |
| `unlabeled_hop` 裸一跳地址 | 未确认实体归属 | 显示“一跳地址未识别” |
| 价格造成的 USD 下降 | 不是真实资产数量减少 | 进入 Price Effect，不进入 Top20 Lost |
| 协议内部地址 | 不是外部目的地 | 跳过外部归因 |

## 12. 资产与竞品范围

| 范围 | 内容 |
|---|---|
| MVP 资产 | USDT / USDD / TRX / sTRX / BTC / ETHB / ETH |
| 竞品协议 | Aave / Morpho / Spark / Compound / Venus |
| 竞品指标 | MVP 只展示 TVL Change 中位数；Borrow 中位数标 TODO |
| 用户范围 | 只分析排除内部地址后的 Top20 大户 |

## 13. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-06-05 | 新增关键指标说明文档，统一 Overview、Market Comparison、Borrow Demand、Capital Outflow、Round Trip、链上归因、Data Quality 和阈值配置口径 |
| 2026-06-05 | 增加二跳分析指标口径，明确二跳只作为弱线索，不进入 Overview 和 Destination Ranking |
