---
title: JustLend 第三方冻结风险监控 PRD
type: prd
created: 2026-05-14
updated: 2026-06-01
author: Nikki
---

# PRD：JustLend 第三方冻结风险监控

## 1. 项目名称

JustLend 平台外部风险因素监控：第三方冻结、黑名单与高风险资金流入

## 2. 背景

在 JustLend 关联地址自清算与 USDT 黑名单风险分析中，已观察到黑名单地址可能通过清算、赎回、抵押品迁移等链上行为，将其在协议中的经济价值迁移至其他地址。

近期 Zama cUSDC 事件进一步暴露了中心化稳定币在 DeFi 共享池中的地址级冻结风险：当争议资金进入协议合约后，发行方无法识别协议内部用户份额，只能按合约地址执行 blacklist / freeze，进而可能影响整个池子的提现、借款、还款或清算链路。

平台需要建立一套轻量、可持续的外部风险因素监控能力，用于识别第三方发行方或包装资产协议的冻结、黑名单、暂停和高风险资金流入是否已经或可能影响 JustLend 市场。

2026-05-26 英国将 Huobi Global S.A. / HTX 纳入 Russia Sanctions 制裁名单后，主流交易所和链上风控服务可能对 HTX 相关资金执行额外审查、拒收、冻结或地址风险标记。对 JustLend 而言，该风险不只存在于 HTX 直接入金，也可能通过 `HTX -> TRON 钱包 -> JustLend`、`HTX -> 其他平台 -> TRON 钱包 -> JustLend` 等短路径进入协议，因此需要作为第三方冻结风险下的临时专题分支进行监控。

本需求不追求覆盖完整市场风险矩阵。MVP 聚焦第三方冻结风险，不纳入脱锚、DEX 深度、清算坏账、oracle 偏差等二期市场风险监控。

## 3. 目标

- 业务目标：
  - 识别 JustLend 核心市场合约、资金持有地址、reserve、bot、admin 等地址是否被第三方发行方 blacklist / freeze。
  - 识别 USDT、USDCOLD 及未来 USDC 相关市场中的高风险资金流入，提前提示共享池合约被发行方冻结的尾部风险。
  - 以临时专题分支形式识别 HTX 制裁相关资金经 TRON 钱包、其他平台或多跳路径进入 JustLend 后触发第三方冻结、拒收或地址污染的风险。
  - 在平台风险看板的外部风险模块中呈现冻结命中、协议状态异常和高风险流入事件，支持人工核查与留痕。

- 用户目标：
  - JustLend 平台工作人员可以在平台风险看板中快速判断是否存在第三方冻结风险。
  - 点击风险项后，可以查看影响市场、命中地址、第三方协议状态、链上证据和处理状态。

- 成功指标：
  - 每日扫描任务成功率 ≥ 99%。⚠️ 待确认
  - 冻结命中识别延迟 ≤ 24 小时。
  - 风险事件证据完整率 100%，每条事件均包含触发原因、影响市场和链上证据。

## 4. 用户画像

- 核心用户：
  - JustLend 风控 / 运营工作人员
  - 值班人员
  - 产品与数据分析人员

- 使用场景：
  1. 工作人员每天查看平台风险看板的外部风险模块，确认当前 JustLend 是否存在第三方冻结命中。
  2. 发现风险事件后，进入详情页查看影响市场、命中地址、资产合约状态和链上证据。
  3. 当高风险资金进入市场合约，工作人员在看板上进行人工核查和状态标记。

- 关键痛点：
  - 仅看 Risk Value 无法识别第三方发行方、包装资产协议或外部合约状态带来的冻结风险。
  - 用户地址未被 blacklist，不代表资金进入市场合约后不会触发发行方对市场合约的冻结。
  - 冻结命中或高风险流入本身不等于法律结论，需要用链上事实和人工核查形成处置闭环。

## 5. 范围

### 本期包含

- 在平台风险看板的外部风险模块中展示第三方冻结风险。
- TRON V1 `USDT` 市场真实接入：
  - USDT blacklist / freeze 命中；
  - USDT Transfer 流入市场合约；
  - 市场合约、资金持有地址、reserve、bot、admin 等核心地址状态。
- TRON V1 `USDCOLD` 市场真实接入：
  - USDCOLD Transfer 流入市场合约；
  - USDCOLD 合约是否存在 blacklist / freeze / pause 能力的确认结果；
  - 若合约支持冻结能力，则纳入冻结状态检查。
- ETH V2 市场预留展示：
  - `USDD/USDC`；
  - `WBTC/USDC`；
  - `wstUSDT/USDC`；
  - `wsETH/USDC`。
- 高风险资金流入识别：
  - 来自已冻结地址或观察名单地址的资金流入；
  - 大额 direct transfer 到市场合约；
  - 大额 supply / repay / liquidation repay 进入市场合约。
- 临时专题分支：HTX 制裁相关资金冻结风险：
  - 展示在“平台风险 / 第三方冻结风险”下，不作为长期固定一级模块；
  - 识别 `HTX -> TRON 地址 -> JustLend` 的 1-hop 间接流入；
  - 识别 `HTX -> 其他平台 -> TRON 地址 -> JustLend` 的 2-hop 平台中转流入；
  - 记录 `HTX -> 多个中转地址 / 跨链 / 拆分地址 -> JustLend` 的可疑多跳流入；
  - 支持在风险解除后将专题状态调整为“已降级”或“已下线”，下线后不再新增监测和告警，仅保留历史事件归档。
- 人工核查、状态标记、备注和证据留痕。

### 本期不包含

- 不做全量历史每时每刻的 JustLend 用户快照重建。
- 不做“全量历史 JustLend 用户 ∩ 全量历史第三方冻结名单”的粗口径交集。
- 不自动限制、冻结或干预链上清算。
- 不自动给出洗钱、制裁、违法等法律定性。
- 不将“来自 HTX”本身直接等同于制裁资金；HTX 专题仅作为第三方冻结风险线索，需要结合路径、金额、时间、对手方和人工核查结论判断。
- 不接入 Telegram、飞书、Slack、邮件等推送渠道。
- 不做脱锚、DEX 深度、清算坏账、oracle 偏差、大户集中度等完整市场风险矩阵。
- 不做面向普通用户的前台展示。

## 6. 页面与功能

| 页面/模块 | 功能 | 优先级 | 说明 |
| --- | --- | --- | --- |
| 外部风险看板 | 顶部汇总当前风险状态 | P0 | 展示冻结命中、高风险流入、第三方协议状态异常、待接入市场、最近扫描时间 |
| 外部风险看板 | 市场监控列表 | P0 | 展示 TRON V1 USDT、USDCOLD 以及 ETH V2 预留市场的接入状态 |
| 外部风险看板 | 风险事件列表 | P0 | 展示冻结命中、高风险流入、第三方协议状态异常事件 |
| 外部风险看板 | 临时专题分支卡片 | P1 | 在第三方冻结风险下展示 HTX 制裁相关资金冻结风险，支持监控中、已降级、已下线状态 |
| 风险详情页 | 事件基本信息 | P0 | 展示风险类型、影响市场、资产、发行方 / 第三方协议、命中地址 |
| 风险详情页 | 证据链时间线 | P0 | 按时间展示状态检查、事件日志、Transfer、交易哈希、区块时间和金额 |
| 风险详情页 | 处理状态 | P0 | 支持人工标记核查状态、备注与关闭原因 |
| 专题详情页 / 专题下钻区 | HTX 专题概览与命中明细 | P1 | 展示制裁来源、风险状态、命中路径、命中地址、金额、处置状态和下线条件 |

## 7. 交互要求

### 7.1 外部风险看板

1. 用户进入页面。
2. 系统展示顶部风险汇总：
   - 当前冻结命中数；
   - 当前高风险流入数；
   - 当前第三方协议状态异常数；
   - 待接入市场数；
   - 最近扫描时间；
   - 数据同步状态。
3. 用户在下方查看风险项模块：
   - 市场合约冻结命中；
   - 高风险资金流入；
   - 第三方协议状态异常；
   - 临时专题分支，如 HTX 制裁相关资金冻结风险；
   - ETH V2 待上线市场接入状态；
   - 数据同步 / 扫描异常。
4. 用户点击具体风险项。
5. 系统进入风险详情页。

### 7.2 风险详情页

1. 系统展示风险事件当前状态。
2. 系统展示影响市场与资产：
   - 链；
   - 版本；
   - 市场；
   - 资产；
   - 第三方发行方或包装资产协议；
   - 命中地址或资金来源地址。
3. 系统展示风险时间线：
   - 当前冻结 / pause / blacklist 检查结果；
   - 第三方协议事件日志；
   - 资金流入交易；
   - 状态恢复事件，如有。
4. 系统展示影响判断：
   - 是否命中 JustLend 市场合约或核心地址；
   - 是否为 direct transfer；
   - 是否来自观察名单或已冻结地址；
   - 是否影响用户提现、借款、还款或清算链路。⚠️ 影响链路判断一期以人工核查为准。
5. 用户根据证据链进行人工核查，并更新处理状态。

### 7.3 临时专题分支

1. 系统在第三方冻结风险模块下展示临时专题分支卡片。
2. HTX 专题卡片展示：
   - 专题状态：监控中 / 已降级 / 已下线；
   - 风险来源：英国 Russia Sanctions 制裁名单；
   - 涉及平台：HTX / Huobi Global S.A.；
   - 主要资产：TRON USDT、TRX、其他从 HTX 流入资产；
   - 影响路径：HTX -> 钱包 / 平台 -> JustLend；
   - 当前风险等级；
   - 最近命中时间；
   - 近 24 小时 / 7 天命中地址数；
   - 近 24 小时 / 7 天命中金额；
   - 待处理事件数。
3. 用户点击专题卡片后进入专题详情页或专题下钻区。
4. 系统展示专题命中明细：
   - 用户地址；
   - 资产；
   - 金额；
   - 路径层级；
   - 中转地址；
   - 入金时间；
   - 进入 JustLend 市场；
   - 风险等级；
   - 处置状态。
5. 当制裁与第三方冻结风险解除后，人工可将专题状态调整为“已降级”或“已下线”。

### 7.4 状态流转

系统自动处理链上事实，人工处理风险结论。

| 状态 | 触发方式 | 说明 |
| --- | --- | --- |
| 待核查 | 系统自动创建 | 发生冻结命中、高风险流入或第三方协议状态异常后生成 |
| 核查中 | 人工操作 | 工作人员开始核查 |
| 已确认风险 | 人工操作 | 工作人员确认需要持续关注或升级 |
| 误报 / 无需处理 | 人工操作 | 工作人员确认无需继续跟进 |
| 已关闭 | 人工操作 | 本轮风险处理完成 |
| 重新打开 | 系统或人工 | 已关闭事件出现新的冻结、流入或状态变化证据 |

BR-001: 系统不得自动将风险事件状态置为“已确认风险”。

BR-002: 系统可以自动创建风险事件、追加证据、更新第三方冻结状态、重新打开已关闭风险。

BR-003: 人工关闭风险时必须填写关闭原因。

BR-003A: 临时专题状态独立于单条风险事件状态，支持“监控中 / 已降级 / 已下线”。

BR-003B: 当专题状态为“监控中”时，系统启用 HTX 来源识别、路径追踪、分级告警和事件入库。

BR-003C: 当专题状态为“已降级”时，系统保留历史事件和统计；新增命中默认仅记录不强告警，除非命中制裁地址、A7、Garantex 或其他高风险实体。

BR-003D: 当专题状态为“已下线”时，系统不再新增 HTX 专题监测和告警；历史事件归档，前台不再默认展示该分支，或仅在历史专题中可查。

## 8. 内容要求

### 8.1 市场与地址监控范围

BR-004: 本期监控对象为 JustLend 市场维度，不再仅以用户地址为入口。

BR-005: 本期真实接入市场包括：
- TRON V1 `USDT`；
- TRON V1 `USDCOLD`。

BR-006: 本期预留市场包括：
- ETH V2 `USDD/USDC`；
- ETH V2 `WBTC/USDC`；
- ETH V2 `wstUSDT/USDC`；
- ETH V2 `wsETH/USDC`。

BR-007: 每个市场需要维护 watched address 清单，至少包括 market、pool、vault、reserve、treasury、bot、admin、资金持有地址。⚠️ 待确认最终地址清单。

BR-008: ETH V2 市场未上线前仅展示“待上线 / 待接入地址”，不得参与真实风险统计。

### 8.2 冻结命中规则

BR-009: 当 watched address 被第三方发行方或资产合约标记为 blacklist / freeze / pause 影响对象时，生成“冻结命中”风险事件。

BR-010: TRON V1 `USDT` 当前冻结状态以 USDT `getBlackListStatus(address)` 返回结果为准。

BR-011: TRON V1 `USDT` 的 `AddedBlackList`、`RemovedBlackList` 用于补充时序和证据链。

BR-012: TRON V1 `USDCOLD` 必须先确认合约是否存在 blacklist / freeze / pause 能力；能力未确认前，页面展示“冻结能力待确认”。

BR-013: 未来 ETH V2 `USDC` 当前冻结状态以 Circle USDC `isBlacklisted(address)` 返回结果为准，`Blacklisted`、`UnBlacklisted` 用于补充证据链。

### 8.3 高风险资金流入规则

BR-014: 只要 USDT、USDCOLD 或未来 USDC / 抵押资产 `Transfer.to` 命中市场 watched address，即进入流入监测，不要求一定经过 supply / repay 方法。

BR-015: 以下资金流入生成“高风险流入”事件：
- 来源地址已被第三方发行方 blacklist / freeze；
- 来源地址命中人工维护观察名单；
- 来源地址与已冻结地址存在 1-3 hop 资金路径；⚠️ MVP 可先不做自动图谱，仅保留字段。
- 单笔 direct transfer 到市场合约且金额达到配置阈值；
- 单笔或 24 小时累计流入金额达到配置阈值。⚠️ 阈值待确认。

BR-016: 高风险流入仅作为人工核查线索，不自动定性为违法、被盗或制裁资金。

BR-017: 资金流入金额同时记录原始资产数量和 USD 估值；价格缺失时进入“待估值”状态，不直接视为未命中。

### 8.4 HTX 临时专题规则

BR-018: HTX 制裁相关资金冻结风险作为“第三方冻结风险”的临时专题分支展示，默认不作为长期固定监控分支。

BR-019: 系统需要支持以下路径标签：
- `HTX_direct_inflow`：HTX 已知地址直接向 JustLend watched address 入金；
- `HTX_1hop_wallet_inflow`：HTX 已知地址先进入 TRON 中转地址，再进入 JustLend watched address；
- `HTX_2hop_platform_inflow`：HTX 资金经其他平台或 CEX 后进入 TRON 地址，再进入 JustLend watched address；
- `HTX_possible_indirect_exposure`：存在时间、金额、地址行为相关性，但链路证据不足以确认直接来源；
- `HTX_sanctions_related_exposure`：路径中命中制裁地址、A7、Garantex 或其他 Russia-linked 高风险实体；
- `HTX_high_risk_routing`：存在拆分、合并、多跳、跨链、快速转出或循环借贷等规避特征。

BR-020: 风险分级规则如下：
- P0：命中制裁地址、A7、Garantex、已知 Russia-linked 高风险实体，或 HTX 来源资金经短路径进入 JustLend 后快速借贷、转出、跨链；
- P1：`HTX -> TRON 地址 -> JustLend`，且金额较大、时间间隔短、近似全额转入；
- P2：`HTX -> 主流 CEX / 平台 -> TRON 地址 -> JustLend`，可通过时间和金额匹配出间接来源；
- P3：历史远距离接触 HTX，但金额小、路径长、无异常行为。

BR-021: HTX 专题命中事件需要记录风险来源平台、链路层级、进入链、进入资产、进入市场、进入金额、首次进入时间、最近进入时间、中转地址数量、是否命中制裁实体、是否命中 A7 / Garantex / 高风险 Russia-linked 平台、是否存在拆分 / 合并 / 快速转出 / 循环借贷、风险等级和处理状态。

BR-022: 下线条件包括但不限于：
- HTX / Huobi Global S.A. 从相关制裁名单移除；
- 主流交易所不再对 HTX 相关资金额外审查；
- 稳定币发行方或链上风控供应商解除 HTX 高风险标签；
- 连续 N 天无新增命中；⚠️ N 值待确认
- 合规 / 风控人工确认关闭专题。

BR-023: HTX 专题不得自动对用户地址给出违法、洗钱或制裁资金定性；系统只输出链上路径、标签来源、证据和风险等级建议，最终结论由人工确认。

### 8.5 UI 文案规格

| 场景 | 中文文案 | 英文文案 |
| --- | --- | --- |
| 当前无命中 | 当前未发现第三方冻结命中或高风险流入 | No third-party freeze hit or high-risk inflow is currently detected |
| 冻结命中 | JustLend 核心地址命中第三方冻结规则，需人工核查影响范围 | A JustLend core address matches a third-party freeze rule. Manual impact review is required |
| 高风险流入 | 发现高风险来源资金流入 JustLend 市场合约，需人工核查 | High-risk source funds flowed into a JustLend market contract. Manual review is required |
| 协议状态异常 | 第三方资产合约状态异常，需确认是否影响市场资金流转 | Third-party asset contract status is abnormal. Confirm whether market fund flows are affected |
| 待估值 | 当前价格或 exchangeRate 缺失，待估值后确认是否达到阈值 | Price or exchangeRate is missing. Threshold evaluation is pending |
| HTX 专题监控中 | HTX 制裁相关资金冻结风险监控中 | HTX sanctions-related freeze risk monitoring is active |
| HTX 专题已降级 | HTX 专题已降级，仅记录高风险命中 | HTX topic is downgraded. Only high-risk hits are recorded |
| HTX 专题已下线 | HTX 专题已下线，历史事件已归档 | HTX topic is offline. Historical events are archived |

## 9. 技术约束

- 平台：JustLend 监控后台（$Monitoring）
- 前端框架：⚠️ 待确认
- API 依赖：
  - JustLend 市场 watched address 配置；
  - TRON USDT `getBlackListStatus(address)`；
  - TRON USDT `AddedBlackList` / `RemovedBlackList` 事件；
  - TRON USDT / USDCOLD `Transfer` 事件；
  - USDCOLD 合约能力解析结果；
  - ETH V2 USDC `isBlacklisted(address)`、`Blacklisted` / `UnBlacklisted` 事件（待上线后接入）；
  - 人工维护观察名单；
  - HTX / Huobi Global S.A. 已知地址标签与来源平台标签；
  - 第三方平台 / CEX 地址标签；
  - 制裁名单、A7、Garantex、Russia-linked 高风险实体标签；
  - 资产 USD 价格源。
- 埋点要求：
  - `third_party_freeze_monitor_view`
  - `risk_item_click`
  - `risk_detail_view`
  - `risk_status_change`
  - `evidence_tx_click`

### 9.1 数据与估值约束

BR-024: 高风险流入金额不得直接按 jToken 数量判断 USD 阈值。

BR-025: jToken 底层资产数量 = jToken 数量 × exchangeRate。

BR-026: USD 价格取触发区块最近可用价格。⚠️ 待确认：价格源与最大允许延迟。

BR-027: 每条风险事件必须保存触发时的估值依据。

### 9.2 事件去重

BR-028: 同一市场、同一地址、同一触发类型在同一 24 小时窗口内的累计流入应合并为一条事件，并保留明细交易。

BR-029: 建议去重键为 `chain + market + asset + address + trigger_type + window_start + primary_tx_hash`。⚠️ 待确认

## 10. 验收标准

- [ ] 系统可读取 TRON V1 `USDT`、`USDCOLD` watched address 配置。
- [ ] 系统可对 watched address 调用 USDT `getBlackListStatus(address)` 并识别冻结命中。
- [ ] 系统可展示 USDCOLD 合约冻结能力确认状态。
- [ ] 系统可监听或查询 USDT / USDCOLD `Transfer.to = watched address` 的资金流入。
- [ ] 外部风险看板可展示冻结命中、高风险流入、第三方协议状态异常、待接入市场、最近扫描时间。
- [ ] 市场监控列表可展示 TRON V1 USDT、TRON V1 USDCOLD、ETH V2 预留市场。
- [ ] 风险详情页可展示影响市场、资产、第三方协议、命中地址、风险时间线。
- [ ] 高风险流入事件可展示交易哈希、区块时间、资产、原始数量、USD 估值、触发原因。
- [ ] 第三方冻结风险模块可展示 HTX 制裁相关资金冻结风险专题分支，并区分监控中、已降级、已下线状态。
- [ ] HTX 专题可识别并展示 `HTX -> TRON 地址 -> JustLend` 的 1-hop 间接流入。
- [ ] HTX 专题可记录 `HTX -> 其他平台 -> TRON 地址 -> JustLend` 的 2-hop 平台中转流入。
- [ ] HTX 专题命中事件可展示路径层级、中转地址、来源平台、进入市场、金额、风险等级和处置状态。
- [ ] 专题状态为“已下线”后，系统不再新增 HTX 专题监测和告警，仅保留历史事件归档。
- [ ] 价格或 exchangeRate 缺失时，风险项进入“待估值”状态。
- [ ] 人工可将风险事件状态流转为核查中、已确认风险、误报 / 无需处理、已关闭。
- [ ] 系统不得自动标记“已确认风险”。
- [ ] 所有人工状态变更保留操作人、时间和备注。

## 11. 风险与待确认项

| 项目 | 说明 | 状态 |
| --- | --- | --- |
| watched address 清单 | 需确认 TRON V1 USDT、USDCOLD 的 market、reserve、资金持有、bot、admin 等地址 | ⚠️ 待确认 |
| USDCOLD 合约能力 | 需确认 USDCOLD 是否具备 blacklist / freeze / pause 能力及对应接口 | ⚠️ 待确认 |
| ETH V2 市场地址 | V2 上线前仅预留展示，待 USDD/USDC、WBTC/USDC、wstUSDT/USDC、wsETH/USDC 地址确认后接入 | ⚠️ 待确认 |
| 高风险地址来源 | MVP 可人工维护观察名单，后续再接内部或第三方安全标签源 | ⚠️ 待确认 |
| HTX 地址标签来源 | 需确认 HTX / Huobi Global S.A. 热钱包、归集地址、充值提现地址和平台标签来源 | ⚠️ 待确认 |
| 第三方平台地址标签 | 需确认主流 CEX、小平台、OTC、P2P、跨链桥等中转平台标签来源 | ⚠️ 待确认 |
| HTX 专题下线条件 | 需确认连续无新增命中的天数 N，以及制裁解除、主流平台风控解除、供应商标签解除的判定依据 | ⚠️ 待确认 |
| 价格源 | 需确认 USD 估值使用哪个价格源，以及最大允许延迟 | ⚠️ 待确认 |
| 处理 SLA | 冻结命中或高风险流入后多久内需要人工核查 | ⚠️ 待确认 |

## 12. 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-05-14 | 初稿，按“每日当前扫描 + 命中后行为追踪 + SEV-2 告警”收敛需求 | AI |
| v0.1.1 | 2026-06-01 | 按 Zama cUSDC 事件启发，将范围从 USDT 用户地址黑名单扩展为第三方冻结风险；一期覆盖 TRON V1 USDT / USDCOLD，看板预留 ETH V2 USDC 相关市场，不接入 Telegram 推送 | AI |
| v0.1.2 | 2026-06-01 | 新增 HTX 制裁相关资金冻结风险临时专题分支，支持识别 HTX 经 TRON 钱包、其他平台或多跳路径进入 JustLend 的冻结风险，并支持风险解除后的降级和下线 | AI |
