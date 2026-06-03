# JustLend Capital Intelligence Dashboard MVP 产品与技术方案 PRD

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 产品名称 | JustLend Capital Intelligence Dashboard |
| 文档类型 | MVP 产品与技术方案 PRD |
| 版本 | v0.2.0 |
| 状态 | Draft |
| 默认分析周期 | 90D |
| 时间口径 | UTC |
| 目标用户 | JustLend 产品团队、增长团队、运营团队、战略团队、风控团队、管理层 |

## 2. 背景与目标

JustLend TVL 下降时，团队需要快速判断下降原因，而不是只看到 TVL 曲线本身。MVP 的目标是建立一个可复盘、可解释、可配置的资金流向分析看板，回答以下问题：

1. JustLend 是否跑输同类借贷协议？
2. TVL 下降是否主要来自 Borrow Demand 下降？
3. Top20 大户是否出现真实资金流失，而不是短期资金调度？
4. 大户主动提出的资金主要流向哪里？
5. 哪些异常信号值得管理层和运营团队优先关注？

MVP 不追求完整用户旅程，也不做实时链上监控。核心价值是把 90D 的资金变化拆解成可解释的结论。

## 3. MVP 范围

### 3.1 一期包含

| 模块 | 范围 |
|---|---|
| Overview | 90D 核心结论、主要异常信号、核心指标摘要 |
| Market Comparison | JustLend vs 竞品 TVL 90D Change 中位数 |
| Borrow Demand | 按资产分析 Supply、Borrow、Utilization、APY，并区分币本位和 USD 本位 |
| Capital Outflow | Top20 Current、Top20 Lost、Round Trip、目的地归因 |
| Settings / Data Config | 内部地址、阈值、资产范围、数据源、归因规则配置 |

### 3.2 一期不包含

| 模块 | 处理 |
|---|---|
| Market Share | 一期不做，避免分母受跨链协议体量影响 |
| User Journey | 二期 |
| Retention Cohort | 二期 |
| Fund Source Analysis | 二期 |
| 独立 Alert Center | 一期并入 Overview 的主要异常信号 |
| AI 分析助手 | 三期 |
| 自动生成报告 | 三期 |
| CSV 导出 | 一期不做 |
| 实时链上监控 | 一期不做，采用 Daily Snapshot |

## 4. 页面信息架构

### 4.1 侧边栏

| 菜单 | 页面标题 | 作用 |
|---|---|---|
| Overview | 总览 | 管理层入口，展示 90D 核心结论和主要异常信号 |
| Market Comparison | 竞品对比 | 判断 JustLend 是否跑输同类借贷协议中位数 |
| Borrow Demand | 借贷需求分析 | 判断 TVL 变化是否来自真实 Borrow Demand 下滑 |
| Capital Outflow | 大户资金流出 | 分析 Top20 Current / Lost、Round Trip 和资金去向 |
| Settings / Data Config | 数据与口径配置 | 配置内部地址、阈值、资产、数据源、归因规则 |

### 4.2 Overview 区块

1. 90D 核心结论
2. 主要异常信号
3. JustLend 核心指标
4. 竞品中位数对比摘要
5. Borrow Demand 摘要
6. Top20 Current / Top20 Lost / Round Trip 摘要
7. Last Updated：最近一次 UTC 汇总时间
8. Data Quality：数据源缺失、延迟、Borrow TODO 状态

### 4.3 Capital Outflow 二级 Tab

```text
Top20 Current
Top20 Lost
Round Trip Detail
Destination Ranking
Attribution Detail
```

### 4.4 Settings 二级 Tab

```text
Internal Address
Asset Scope
Thresholds
Data Sources
Attribution Rules
```

## 5. 核心数据口径

| 项 | 规则 |
|---|---|
| 时间口径 | 全部使用 UTC 事件时间 |
| 默认分析周期 | 90D |
| 汇总频率 | 每日 UTC 00:00 后汇总一次 |
| 数据窗口 | 前一完整 UTC 日 |
| 数据形态 | Daily Snapshot，不做实时看板 |
| 初始化范围 | 首次初始化 90D，之后每日增量更新 |
| 页面默认数据 | 最近一次已完成 Daily Snapshot |
| 价格口径 | 每日 UTC 00:00 快照价，趋势计算统一同一价格源 |
| 价格源 | CoinMarketCap |
| 竞品 TVL 源 | DeFiLlama |
| 竞品 Borrow 源 | 协议 API 或已有数据源；缺失则标记 TODO / Data unavailable |

### 5.1 资产范围

```text
USDT / USDD / TRX / sTRX / BTC / ETHB / ETH
```

### 5.2 竞品范围

```text
Aave / Morpho / Spark / Compound / Venus
```

一期不做 Market Share。Market Comparison 只展示：

```text
JustLend TVL 90D Change vs 竞品 TVL 90D Change 中位数
```

Borrow 中位数如果数据缺失，不参与计算，页面显示 TODO / Data unavailable。

## 6. Top20 大户规则

| 项 | 规则 |
|---|---|
| 大户范围 | Top20 |
| 地址来源 | 使用已有用户地址数据库，每日刷新，不从 0 重扫 |
| 内部地址 | 老板地址、团队地址、Treasury、运营地址、协议合约等全部排除 |
| Top20 Current | 排除内部地址后，按当日 `supply_usd` 排名前 20 |
| Top20 Lost | 排除内部地址后，按 90D `unreturned_outflow_usd` 排名前 20 |
| Borrow Demand | 保留协议总量口径，暂不排除内部地址 |

### 6.1 `supply_usd` 定义

`supply_usd` 表示用户在 JustLend 全部供应资产的 USD 总价值。

建议同时保存：

| 字段 | 含义 |
|---|---|
| `supply_usd` | 用户全部 Supply 资产 USD 总价值 |
| `borrow_usd` | 用户全部 Borrow 资产 USD 总价值 |
| `net_position_usd` | `supply_usd - borrow_usd` |
| `collateral_usd` | 用户启用为抵押品的资产 USD 价值，可选 |
| `asset_breakdown` | 用户各资产 Supply / Borrow 明细 |

### 6.2 内部地址维护

内部地址支持在 Settings 页面维护，并支持批量导入。

内部地址默认从以下场景排除：

| 场景 | 是否排除 |
|---|---|
| Top20 Current 排名 | 是 |
| Top20 Lost 排名 | 是 |
| Capital Outflow 分析 | 是 |
| 主要异常信号 | 是 |
| Borrow Demand | 否，保留协议总量口径 |

## 7. 用户资金流出与 Round Trip

### 7.1 行为分类

用户资金流出只统计 Supply 侧主动资金撤出，不混入抵押状态变化、借款归还、清算和价格波动。

| 用户行为 | 是否算资金流出 | 归类 |
|---|---|---|
| Withdraw / Redeem Supply | 是 | 主动资金流出 |
| Supply / Deposit | 否 | 回流 / 新增存款 |
| Repay Borrow | 否 | Borrow Demand 下降 |
| Borrow 提走资产 | 否 | Borrow 增加 |
| 关闭抵押开关 | 否 | 抵押意愿下降，单独信号 |
| 清算 | 否 | 风险事件，单独标记 |
| 价格波动导致 USD 仓位变化 | 否 | 价格影响 |

### 7.2 Round Trip 定义

Round Trip 指用户从 JustLend 主动 Withdraw / Redeem 后，在观察窗口内又重新 Supply / Deposit 回 JustLend 的行为链路。

它用于回答：

1. 用户什么时候提出资金？
2. 提到哪里？
3. 中间是否命中 CEX、TRON 生态、竞品协议或 Unknown？
4. 什么时候回流？
5. 回流金额是多少？
6. 回流到 JustLend 的哪个 Market / Asset？
7. 这是大户真实流失，还是短期资金调度后回流？

### 7.3 Round Trip 匹配规则

| 项 | 规则 |
|---|---|
| 观察对象 | Top20 Current + Top20 Lost |
| 流出行为 | Withdraw / Redeem Supply |
| 回流行为 | 同地址 Supply / Deposit 回 JustLend |
| 回流窗口 | 默认 90D |
| 多次流出 / 回流 | 按事件序列展示，不只做聚合 |
| 多笔匹配 | 按时间顺序匹配 |
| 部分回流 | 回流金额小于流出金额时标记 `partially_returned` |
| 未回流 | 标记 `not_returned` |
| 回流目标 | 记录回到 JustLend 的具体 Market / Asset |

### 7.4 Round Trip 指标

| 字段 | 定义 | 用途 |
|---|---|---|
| `gross_withdraw_usd` | 90D 主动 Withdraw / Redeem 总额 | 看总撤出规模 |
| `gross_deposit_usd` | 90D Supply / Deposit 总额 | 看总回流 / 新增规模 |
| `net_outflow_usd` | `gross_withdraw_usd - gross_deposit_usd` | 辅助展示，不单独判定流失 |
| `returned_outflow_usd` | 流出后在观察窗口内重新回到 JustLend 的金额 | 看已回流规模 |
| `unreturned_outflow_usd` | 流出后截至统计日尚未回流的金额 | 大户流失主判断字段 |
| `return_rate` | `returned_outflow_usd / gross_withdraw_usd` | 看回流比例 |
| `avg_time_away` | 从流出到回流的平均时长 | 看资金离开周期 |
| `return_market` | 回流到 JustLend 的具体 Market / Asset | 看回流方向 |

`net_outflow_usd` 保留，但不能单独用于判断大户流失。

### 7.5 Overview 表达规则

Overview 不应只展示净流出，应表达为：

```text
Top20 90D 主动提出 X，其中 Y 已在平均 N 天后回流，Z 尚未回流；
未回流金额占期初 Top20 Supply 的 R%，1 跳强归因显示主要流向 A / B / C。
```

## 8. 资金路径归因规则

一期最多追踪 2 跳。

```text
Hop 0: JustLend Withdraw / Redeem
Hop 1: Withdraw 后 24h 内，用户地址转出的第一跳或主要去向
Hop 2: Hop 1 未知地址在 7D 内继续转向的已知实体
```

| 归因等级 | 跳数 | 规则 | 用途 |
|---|---:|---|---|
| 强归因 | 1 跳 | Hop 1 命中已知实体 | Overview 主结论、主要异常信号 |
| 弱归因 | 2 跳 | Hop 2 命中已知实体 | Capital Outflow 详情辅助 |
| Unknown | 最多 2 跳仍未命中 | 保留 Unknown | 不强行解释 |

归因限制：

1. Overview 主结论只使用 1 跳强归因。
2. 2 跳弱归因只用于详情页辅助解释。
3. 超过 2 跳不追踪，归为 Unknown / Unresolved。
4. 多个去向按金额拆分。
5. Unknown 占比必须保留，不强行归因。

### 8.1 目的地分类

| 分类 | 示例 |
|---|---|
| CEX | Binance、OKX、HTX、Bybit |
| TRON Eco | StUSDT、SUN、USDD |
| Lending | Aave、Morpho、Spark、Compound、Venus |
| Bridge / Cross-chain | 跨链桥、目标链入口 |
| Unknown | 未识别地址 |

## 9. Borrow Demand 规则

Borrow Demand 必须同时看币本位和 USD 本位，避免把价格波动误判成真实借贷需求下降。

| 字段 | 含义 |
|---|---|
| `borrow_amount` | 币本位借款数量 |
| `borrow_usd` | USD 借款价值 |
| `borrow_amount_change_pct` | 币本位 Borrow 变化 |
| `borrow_usd_change_pct` | USD Borrow 变化 |
| `asset_price_change_pct` | 币价变化 |
| `borrow_apy_change` | 借款 APY 变化 |
| `supply_apy_change` | 存款 APY 变化 |
| `utilization_change` | 利用率变化 |

### 9.1 真实 Borrow Demand 下降

```text
核心资产 borrow_usd 90D 下降 > 阈值
且 borrow_amount 同步下降
```

满足以上条件时，才优先判断为真实 Borrow Demand 下降。

### 9.2 价格影响

如果只是 `borrow_usd` 下降，但 `borrow_amount` 稳定或上升，应标记为：

```text
主要受币价波动影响，不直接判断为借贷需求下降。
```

## 10. 主要异常信号

主要异常信号位于 Overview，不是普通告警列表，而是帮助管理层定位 90D 变化原因的归因入口。

### 10.1 展示结构

每条信号使用固定结构：

```text
现象
影响
证据
归因置信度
查看入口
```

### 10.2 默认异常规则

| 异常信号 | 默认触发规则 | 代表含义 |
|---|---|---|
| 跑输竞品中位数 | JustLend TVL 90D Change 跑输竞品 TVL 90D Change 中位数 > 5 pct | JustLend 表现弱于同类协议 |
| Borrow Demand 下降 | 核心资产 `borrow_usd` 90D 下降 > 10%，且 `borrow_amount` 同步下降 | 真实借贷需求下降 |
| 价格影响 | `borrow_usd` 下降，但 `borrow_amount` 稳定或上升 | USD 下降主要来自币价波动 |
| Top20 未回流资金流出 | `Top20 unreturned_outflow_usd / Top20 beginning_supply_usd > 5%` | 大户资金撤出且尚未回流 |
| 单个大户撤资 | 单地址 90D `unreturned_outflow_usd > 200,000 USD` | 重点用户撤资 |
| 资金集中流向 | 1 跳强归因目的地占 Top20 流出 > 30% | 大户资金集中流向某类目的地 |
| 抵押意愿下降 | 默认关闭，默认金额 1,000,000 USD | 用户降低杠杆或风险敞口 |

### 10.3 Top20 未回流资金流出公式

```text
top20_unreturned_outflow_ratio =
Top20 unreturned_outflow_usd / Top20 beginning_supply_usd
```

其中：

| 字段 | 定义 |
|---|---|
| `top20_beginning_supply_usd` | Top20 在 90D 起始日 UTC 00:00 快照的 Supply USD 总额 |
| `top20_gross_withdraw_usd` | Top20 90D 主动 Withdraw / Redeem 总额 |
| `top20_returned_outflow_usd` | 已回流 JustLend 的流出资金 |
| `top20_unreturned_outflow_usd` | 尚未回流 JustLend 的流出资金 |
| `top20_unreturned_outflow_ratio` | `unreturned_outflow_usd / beginning_supply_usd` |

若 90D 起始日无快照，则使用最早可用快照，并在 Data Quality 中标记。

## 11. 阈值配置与权限

所有百分比阈值、金额阈值、时间窗口阈值都做成可配置项，不写死在代码中。

| 项 | 规则 |
|---|---|
| 配置位置 | Settings / Data Config -> Thresholds |
| 可配置类型 | 百分比、金额、时间窗口 |
| 默认值 | 使用 MVP 默认规则 |
| 生效范围 | 当前视图立即生效 |
| 历史异常列表 | 不改写 |
| 修改原因 | 必填 |
| 修改日志 | 记录修改人、修改时间、修改前后值、修改原因 |
| 权限 | 管理员可配置，其他用户只读 |

### 11.1 默认阈值

| 阈值项 | 默认值 | 状态 |
|---|---:|---|
| 跑输竞品中位数 | 5 pct | 开启 |
| 核心资产 Borrow 下降 | 10% | 开启 |
| Top20 未回流资金占期初 Supply | 5% | 开启 |
| 单个大户未回流流出金额 | 200,000 USD | 开启 |
| 目的地集中占比 | 30% | 开启 |
| Hop 1 强归因窗口 | 24h | 开启 |
| Hop 2 弱归因窗口 | 7D | 开启 |
| 抵押意愿下降金额 | 1,000,000 USD | 关闭 |

### 11.2 即时生效定义

阈值修改后：

1. 当前页面基于已有聚合数据立即重新判断异常信号。
2. 不重新拉链上数据。
3. 不改变 TVL、Borrow、Top20、资金路径等原始指标。
4. 不改写历史异常列表。

## 12. 数据源与数据质量

### 12.1 数据源

| 数据 | MVP 数据源 |
|---|---|
| JustLend 用户地址 / 仓位 | 已有数据库，每日刷新 |
| JustLend 资产价格 | CoinMarketCap |
| 竞品 TVL | DeFiLlama |
| 竞品 Borrow | 协议 API 或已有数据源 |
| 地址标签 | 已有内部标签库；缺失归 Unknown |
| 内部地址 | Settings 页面维护，支持批量导入 |

### 12.2 Data Quality 展示

页面需要展示：

1. 最近一次汇总时间：`Last Updated: UTC yyyy-mm-dd HH:mm`
2. 竞品 Borrow 是否缺失。
3. CoinMarketCap 价格是否缺失或延迟。
4. DeFiLlama TVL 是否缺失或延迟。
5. 90D 起始日快照是否完整。
6. Unknown 归因占比。

## 13. 权限规则

| 用户类型 | 权限 |
|---|---|
| 管理员 | 查看全部页面，维护内部地址，修改阈值，维护数据源配置 |
| 只读用户 | 查看 Overview、Market Comparison、Borrow Demand、Capital Outflow，不可修改配置 |

配置类操作必须记录修改日志。

## 14. 数据表设计

### 14.1 维表

#### `dim_protocol`

| 字段 | 类型 | 说明 |
|---|---|---|
| `protocol_id` | string | 协议 ID |
| `name` | string | 协议名称 |
| `category` | string | lending / yield / cex / bridge / tron_eco |
| `chain` | string | 所属链 |
| `defillama_slug` | string | DeFiLlama 协议映射 |
| `is_competitor` | boolean | 是否竞品 |
| `is_active` | boolean | 是否启用 |

#### `dim_asset`

| 字段 | 类型 | 说明 |
|---|---|---|
| `asset_id` | string | 资产 ID |
| `symbol` | string | USDT / USDD / TRX / sTRX / BTC / ETHB / ETH |
| `chain` | string | 所属链 |
| `contract_address` | string | 合约地址 |
| `market_id` | string | JustLend market ID |
| `asset_group` | string | stablecoin / tron_asset / btc_asset / eth_asset |
| `cmc_asset_id` | string | CoinMarketCap 资产 ID |
| `is_active` | boolean | 是否启用 |

#### `dim_internal_address`

| 字段 | 类型 | 说明 |
|---|---|---|
| `address` | string | 地址 |
| `chain` | string | 所属链 |
| `label` | string | founder / treasury / ops / market_maker / contract / team |
| `owner_name` | string | 内部识别名，可选 |
| `exclude_from_top_holder` | boolean | 是否从 Top20 中排除 |
| `exclude_from_flow_analysis` | boolean | 是否从资金流向分析中排除 |
| `exclude_from_alert` | boolean | 是否从异常信号中排除 |
| `reason` | string | 排除原因 |
| `effective_from` | date | 生效日期 |
| `effective_to` | date | 失效日期 |
| `updated_by` | string | 维护人 |
| `updated_at` | timestamp | 更新时间 |

#### `dim_address_label`

| 字段 | 类型 | 说明 |
|---|---|---|
| `address` | string | 钱包或合约地址 |
| `chain` | string | 所属链 |
| `entity_name` | string | Binance / StUSDT / Aave 等 |
| `entity_type` | string | cex / protocol / bridge / whale / unknown |
| `protocol_id` | string | 关联协议，可为空 |
| `confidence` | decimal | 标签置信度 |
| `source` | string | 标签来源 |
| `updated_at` | timestamp | 更新时间 |

#### `dim_threshold_config`

| 字段 | 类型 | 说明 |
|---|---|---|
| `threshold_key` | string | 阈值 key |
| `name` | string | 展示名称 |
| `metric_name` | string | 作用指标 |
| `operator` | string | `>` / `<` / `>=` / `<=` |
| `value` | decimal | 阈值数值 |
| `unit` | string | pct / usd / hours / days |
| `scope_type` | string | global / asset / protocol |
| `scope_value` | string | 作用范围，可为空 |
| `default_value` | decimal | 默认值 |
| `is_active` | boolean | 是否启用 |
| `updated_by` | string | 修改人 |
| `updated_at` | timestamp | 更新时间 |

### 14.2 事实表与应用层表

| 表 | 用途 |
|---|---|
| `fact_user_position_daily` | 用户每日 JustLend 总仓位 |
| `fact_user_asset_position_daily` | 用户-资产粒度每日仓位 |
| `fact_top_holder_daily` | Top20 Current 快照 |
| `fact_top_lost_holder_daily` | Top20 Lost 快照 |
| `fact_asset_daily_metrics` | JustLend 资产级 Supply / Borrow / APY / Utilization |
| `fact_capital_flow_event` | Supply / Withdraw / Borrow / Repay 等事件 |
| `fact_capital_migration_path` | 1 跳强归因、2 跳弱归因结果 |
| `fact_capital_round_trip` | Top20 Round Trip 明细 |
| `fact_threshold_change_log` | 阈值修改审计 |
| `mart_overview_daily` | Overview 聚合结果 |
| `mart_market_comparison_daily` | 竞品中位数对比 |
| `mart_borrow_demand_daily` | Borrow Demand 聚合 |
| `mart_capital_outflow_daily` | 大户资金流出聚合 |
| `mart_anomaly_signal_daily` | 主要异常信号 |

#### `fact_capital_round_trip`

| 字段 | 类型 | 说明 |
|---|---|---|
| `round_trip_id` | string | Round Trip ID |
| `snapshot_date` | date | 快照日期 |
| `user_address` | string | 用户地址 |
| `outflow_time` | timestamp | 流出时间 UTC |
| `outflow_asset` | string | 流出资产 |
| `outflow_amount` | decimal | 流出数量 |
| `outflow_usd` | decimal | 流出 USD |
| `outflow_destination` | string | 1 跳强归因目的地 |
| `outflow_destination_category` | string | CEX / TRON Eco / Lending / Unknown |
| `weak_destination` | string | 2 跳弱归因目的地，可选 |
| `return_time` | timestamp | 回流时间 UTC |
| `return_asset` | string | 回流资产 |
| `return_amount` | decimal | 回流数量 |
| `return_usd` | decimal | 回流 USD |
| `return_market` | string | 回流 JustLend market |
| `time_away_hours` | decimal | 离开时长 |
| `round_trip_delta_usd` | decimal | 回流金额 - 流出金额，仅参考 |
| `status` | string | returned / partially_returned / not_returned |

## 15. API 设计

### 15.1 业务 API

| API | 用途 |
|---|---|
| `GET /api/v1/overview?period=90d` | 总览与主要异常信号 |
| `GET /api/v1/market-comparison?period=90d` | JustLend vs 竞品 TVL 中位数 |
| `GET /api/v1/borrow-demand?period=90d&asset=USDT` | 借贷需求分析 |
| `GET /api/v1/capital-outflow/summary?period=90d` | 大户流出摘要 |
| `GET /api/v1/capital-outflow/top-current?period=90d` | Top20 Current |
| `GET /api/v1/capital-outflow/top-lost?period=90d` | Top20 Lost |
| `GET /api/v1/capital-outflow/round-trip?period=90d` | Round Trip 明细 |
| `GET /api/v1/capital-outflow/destinations?period=90d` | 目的地排行 |
| `GET /api/v1/capital-outflow/attribution-detail?period=90d` | 归因明细 |

### 15.2 Settings API

| API | 用途 |
|---|---|
| `GET /api/v1/settings/internal-addresses` | 查询内部地址配置 |
| `POST /api/v1/settings/internal-addresses` | 新增内部地址 |
| `POST /api/v1/settings/internal-addresses/import` | 批量导入内部地址 |
| `PATCH /api/v1/settings/internal-addresses/{address}` | 修改内部地址配置 |
| `GET /api/v1/settings/thresholds` | 获取阈值配置 |
| `PATCH /api/v1/settings/thresholds/{threshold_key}` | 修改单个阈值 |
| `GET /api/v1/settings/thresholds/change-log` | 查看阈值修改日志 |
| `GET /api/v1/settings/data-sources` | 查看数据源配置 |
| `GET /api/v1/settings/asset-scope` | 查看资产范围 |
| `GET /api/v1/settings/attribution-rules` | 查看归因规则 |

## 16. V1 开发任务

### 16.1 数据口径与映射

1. 确认 DeFiLlama slug：Aave / Morpho / Spark / Compound / Venus。
2. 确认 CoinMarketCap asset id：USDT / USDD / TRX / sTRX / BTC / ETHB / ETH。
3. 确认 JustLend market 与资产映射。
4. 确认已有用户地址数据库字段映射。
5. 确认地址标签库来源与 Unknown 兜底逻辑。

### 16.2 数据层

1. 每日 UTC 快照任务。
2. `fact_user_position_daily` 生成。
3. `fact_user_asset_position_daily` 生成。
4. Top20 Current 计算。
5. Top20 Lost 计算。
6. Supply / Withdraw / Borrow / Repay 事件识别。
7. Round Trip 匹配。
8. Hop 1 强归因和 Hop 2 弱归因。
9. Borrow 双口径聚合。
10. 主要异常信号生成。

### 16.3 后端

1. Overview API。
2. Market Comparison API。
3. Borrow Demand API。
4. Capital Outflow API。
5. Settings API。
6. 阈值配置与审计日志。
7. 权限校验：管理员可配置，其他用户只读。

### 16.4 前端

1. 侧边栏与全局 90D 筛选。
2. Overview 页面。
3. Market Comparison 页面。
4. Borrow Demand 页面。
5. Capital Outflow 页面。
6. Settings / Data Config 页面。
7. Thresholds 页面支持修改阈值并要求填写修改原因。
8. Internal Address 页面支持单条维护和批量导入。

## 17. 验收标准

| 验收项 | 标准 |
|---|---|
| UTC 口径 | 所有事件、快照、页面 Last Updated 均使用 UTC |
| 90D 窗口 | 默认窗口为 90D，计算结果可复查 |
| 内部地址过滤 | Top20 Current / Lost、资金流出、异常信号均排除内部地址 |
| Top20 Current | 按排除内部地址后的当日 `supply_usd` 排名 |
| Top20 Lost | 按 90D `unreturned_outflow_usd` 排名 |
| Round Trip | 能展示已回流、部分回流、未回流、平均离开时长 |
| `net_outflow_usd` | 只辅助展示，不作为流失主判断 |
| Borrow Demand | 同时展示 `borrow_usd` 和 `borrow_amount`，能识别价格影响 |
| Overview 归因 | 主结论只使用 Hop 1 强归因 |
| 2 跳弱归因 | 只在详情页作为辅助展示 |
| Unknown | 保留 Unknown 占比，不强行解释 |
| 阈值配置 | 页面可修改，当前视图立即生效，不改写历史异常列表 |
| 修改审计 | 阈值和内部地址修改必须记录修改原因 |
| 权限 | 管理员可配置，其他用户只读 |
| CSV 导出 | 一期不提供 |

## 18. TODO / 待开发确认项

| TODO | 说明 |
|---|---|
| DeFiLlama slug | 开发前确认 Aave / Morpho / Spark / Compound / Venus 映射 |
| CoinMarketCap asset id | 开发前确认 USDT / USDD / TRX / sTRX / BTC / ETHB / ETH 映射 |
| JustLend market id | 开发前确认资产与 market 映射 |
| Borrow 数据源 | 确认协议 API 或已有数据源可用性；缺失时标 TODO |
| 地址标签库 | 确认内部标签库字段与更新频率 |
| 清算事件 | MVP 只单独标记，不进入 Overview 主要异常信号 |
| 抵押意愿下降 | 阈值配置页默认关闭，后续按需要开启 |

## 19. 方案判断

一期 MVP 的重点不是做完整的数据大屏，而是让管理层能用可信数据判断：

```text
JustLend 过去 90D 是否跑输竞品中位数；
核心资产 Borrow Demand 是否真实下降；
Top20 大户是否有未回流资金流出；
这些未回流资金的一跳强归因主要流向哪里。
```

只要以上四个问题能稳定回答，一期 MVP 就能支撑产品、增长、运营和管理层的第一轮决策。
