---
title: JustLend 关联地址自清算与 USDT 黑名单风险分析
type: research
created: 2026-05-12
updated: 2026-05-12
author: Nikki
---

# JustLend 关联地址自清算与 USDT 黑名单风险分析

## 0. 一句话结论

本事件判定为 **中高风险 / SEV-2 合规风险事件**。从协议执行看，清算（Liquidation）按 JustLend 规则完成，暂未看到直接造成坏账；但从风控与合规看，`TLfa...eusu` 已被 USDT TRC-20 合约加入黑名单，且与 `TRq3...dURa` 存在启动资金、连续清算、后续资产转移等强关联，行为可被解释为“通过关联清算迁移黑名单地址经济价值”。

## 1. 事件范围

| 项目 | 内容 |
|------|------|
| 被清算地址 | `TLfa4ChitsGz1SaAEfnuNx5RaQz7FQeusu` |
| 清算地址 | `TRq3kiuN4KYbAVZd78Tyj7goaZimA3dURa` |
| 涉及协议 | JustLend DAO Supply & Borrow Market |
| 主要合约 | jUSDT：`TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd`；USDT：`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| 事件类型 | 关联账户清算、黑名单地址价值迁移、稳定币合规风险 |
| 数据来源 | TRONSCAN、TRONGrid、JustLend 文档、Tether / OKX / Aave / Compound / DOJ 公开资料 |

## 2. 核心事实

| 事实 | 结论 |
|------|------|
| 地址关联关系 | 高可信关联 |
| 关联证据 | 2026-04-16 03:16:57（UTC+8），`TLfa...eusu` 向 `TRq3...dURa` 转入 50 TRX，交易哈希 [`4683527b...`](https://tronscan.org/#/transaction/4683527bf6869147978b4d445bb271aa621a69b007cc0812afeb562eab4805f0) |
| 黑名单状态 | `TLfa...eusu` 当前为 USDT 黑名单地址；`TRq3...dURa` 当前不是 USDT 黑名单地址 |
| 黑名单加入时间 | 2026-03-26 06:23:42（UTC+8），区块 `81270073`，交易哈希 [`53463160...`](https://tronscan.org/#/transaction/53463160f9a416d48a58bdcb8237abbd3b759e34a6ae6e8eda779b9a0a22ce50) |
| 清算次数 | 至少 14 次 |
| 清算合计 | 403,921.736802 USDT |
| 抵押品流向 | 13 次取得 43,564,727.90280627 jUSDD；1 次取得 10,990,688,982.53601 jBTT |
| 协议损失判断 | 暂未看到直接坏账证据；清算偿还了债务 |
| 主要风险 | 合规规避、关联账户自清算、黑名单资产价值迁移、平台被动卷入 AML 风险 |

## 3. 地址关联关系判断

### 3.1 直接资金关系

`TRq3...dURa` 注册/启用初期，`TLfa...eusu` 为其转入 50 TRX。该笔交易包含账户创建成本，说明 `TLfa...eusu` 不只是普通转账方，更像是 `TRq3...dURa` 的启动资金来源。

### 3.2 行为协同关系

`TRq3...dURa` 在 2026-05-06 起连续多次清算 `TLfa...eusu`，且清算对象、清算资产、时间窗口高度集中。首笔清算交易为 [`09cc1d1d...`](https://tronscan.org/#/transaction/09cc1d1d43a7c012e65a4b8f3dbcd89a82b7cdf85bdf52c70568814b0db373c6)，调用方法为：

```text
liquidateBorrow(address borrower,uint256 repayAmount,address cTokenCollateral)
```

参数显示：
- borrower：`TLfa...eusu`
- liquidator：`TRq3...dURa`
- repayAmount：200,000 USDT
- cTokenCollateral：jUSDD

### 3.3 后续资产转移关系

清算后，仍观察到 `TLfa...eusu` 向 `TRq3...dURa` 转移 JST、wstUSDT、USDD 等资产。该行为进一步强化两个地址之间的经济关联，不像独立清算人随机捕获清算机会。

## 4. USDT 黑名单核验

已确认：`TLfa4ChitsGz1SaAEfnuNx5RaQz7FQeusu` 已被 USDT TRC-20 合约加入黑名单。链上事件为 `AddedBlackList(address indexed _user)`，发生于 2026-03-26 06:23:42（UTC+8），区块高度 `81270073`，交易哈希 [`53463160...`](https://tronscan.org/#/transaction/53463160f9a416d48a58bdcb8237abbd3b759e34a6ae6e8eda779b9a0a22ce50)。

当前状态核验：
- `TLfa...eusu` 调用 USDT `getBlackListStatus(address)` 返回 `true / 1`
- `TRq3...dURa` 调用 USDT `getBlackListStatus(address)` 返回 `false / 0`
- 检索 `RemovedBlackList` 与 `DestroyedBlackFunds`，未发现 `TLfa...eusu` 后续被移出黑名单或黑名单资金被销毁的记录

⚠️ 待确认：链上事件只证明“被加入黑名单”，不记录执法机构、案件编号或 AML 命中规则。“涉及反洗钱”可以作为 TRONSCAN / Tether 风险标签描述引用，但不应写成已被链上直接证明的法律事实。

## 5. 清算明细

| 序号 | 时间 UTC+8 | 交易 | 偿还 USDT | 取得抵押品 |
|---:|---|---|---:|---:|
| 1 | 2026-05-06 00:10:12 | [`09cc1d1d...`](https://tronscan.org/#/transaction/09cc1d1d43a7c012e65a4b8f3dbcd89a82b7cdf85bdf52c70568814b0db373c6) | 200,000.000000 | 21,572,784.87410943 jUSDD |
| 2 | 2026-05-06 00:18:36 | [`4d58dc65...`](https://tronscan.org/#/transaction/4d58dc65231d2219b9264e406aefc01894f4cd514b754ee7edf51b4a5d03dd7c) | 101,978.526454 | 10,999,804.06394722 jUSDD |
| 3 | 2026-05-06 00:28:57 | [`bebed751...`](https://tronscan.org/#/transaction/bebed751ccb4d93248401cc3bcec7d510b7ea2d724efd220880c3f650a801254) | 50,989.295894 | 5,499,905.55500556 jUSDD |
| 4 | 2026-05-06 00:35:48 | [`ffcc0981...`](https://tronscan.org/#/transaction/ffcc098124741f47b703052114e3e258f30d3b5c69a5f0da1221f89e63234630) | 25,494.660211 | 2,749,954.100161 jUSDD |
| 5 | 2026-05-06 00:47:51 | [`9cdbd5a2...`](https://tronscan.org/#/transaction/9cdbd5a252b3ecf810aa5d277dc814a4b61370b6b44787e4d31ecaed1378f77f) | 12,747.340296 | 1,374,978.14910514 jUSDD |
| 6 | 2026-05-06 01:00:57 | [`eb5953f8...`](https://tronscan.org/#/transaction/eb5953f82055a2fdb7697d5f40a271e1f22d7a305519970627fb2d03778bf7f7) | 6,373.675262 | 687,489.62608025 jUSDD |
| 7 | 2026-05-06 03:31:57 | [`e87290ee...`](https://tronscan.org/#/transaction/e87290eecf2e5be96c4d4dc574355996676ca7bd5619cf33f3cb1bbf7ce41f08) | 2,830.508602 | 305,309.76517193 jUSDD |
| 8 | 2026-05-06 06:37:21 | [`9d2453bc...`](https://tronscan.org/#/transaction/9d2453bc62caf8e9751a63ab6079a47e6f1a3a993499786eec34d87fd30f3e62) | 1,771.634050 | 191,095.40045559 jUSDD |
| 9 | 2026-05-06 15:25:54 | [`6bd33c96...`](https://tronscan.org/#/transaction/6bd33c96731ffa05bd70abdda55c2d207b11b7e814ad8e5c14569e717db4001c) | 628.365950 | 67,778.01669907 jUSDD |
| 10 | 2026-05-07 01:35:39 | [`707d5820...`](https://tronscan.org/#/transaction/707d58207c2ba088cf58e00731bb04ce0f30e26b9cb641decda83933aab81c04) | 571.685059 | 61,664.19304430 jUSDD |
| 11 | 2026-05-08 03:46:45 | [`2500e1e2...`](https://tronscan.org/#/transaction/2500e1e231674e8015b198c08906457fd68e56e11232125cc917f928365ce102) | 285.870101 | 30,835.06999878 jUSDD |
| 12 | 2026-05-09 01:46:00 | [`40f26819...`](https://tronscan.org/#/transaction/40f26819840da8e8af5263baef9d609fe857eab263456195e7d94e30470a7546) | 142.946311 | 15,418.74939252 jUSDD |
| 13 | 2026-05-10 14:04:00 | [`3ece6544...`](https://tronscan.org/#/transaction/3ece6544cef637b5f889a869aa25b6ed2defadcd3f95d529aac7e7ce5dce383d) | 71.482103 | 7,710.33963549 jUSDD |
| 14 | 2026-05-12 10:42:00 | [`6442842d...`](https://tronscan.org/#/transaction/6442842dbd9465defa09434dcf3fac8f7efbffb40536775412efc5aaafdd4068) | 35.746509 | 10,990,688,982.53601 jBTT |

## 6. 清算后行为

`TRq3...dURa` 在首笔清算后较快执行 `redeemUnderlying`，将部分 jUSDD 赎回为 USDD，并通过 `execute` 与地址 `TSJEt...` 发生 USDD / USDT 兑换流向。

后续观察到：
- `TRq3...dURa` 对另一个地址 `TKMj...` 执行 JST 清算，说明其具备清算策略行为，不只是一次性接收资产。
- `TLfa...eusu` 向 `TRq3...dURa` 转入 1,000 JST、约 33,254.67793045 wstUSDT、20,000 USDD。
- `TRq3...dURa` 将 wstUSDT mint 为 jwstUSDT。
- `TRq3...dURa` 当前仍持有 jUSDD、jBTT、jUSDT、jwstUSDT、jJST 等 JustLend 相关资产。

## 7. 风险影响判断

| 风险项 | 等级 | 判断依据 |
|------|------|------|
| 协议坏账风险 | 低到中 | 清算偿还了 USDT 债务，机制上降低借款敞口 |
| 合规风险 | 高 | 黑名单地址通过关联清算将抵押品价值迁移至未黑名单地址 |
| 声誉风险 | 高 | 若外部解读为 JustLend 被用于规避 Tether 冻结，将影响平台风险形象 |
| jUSDT 合约牵连风险 | 低概率、高影响 | 单个用户事件通常不足以导致 jUSDT 合约被列入黑名单，但若被认定为系统性 AML 逃避通道，后果严重 |
| 清算公平性风险 | 中 | 关联账户可能提前准备资金并控制清算节奏 |
| 监控缺口风险 | 高 | 若只监控 Risk Value，不监控黑名单和地址关系，难以及时识别该类事件 |

## 8. 对 jUSDT 合约的影响

短期看，jUSDT 合约被 Tether 直接列入黑名单的概率较低。原因是 jUSDT 合约是协议池合约，承载大量用户资产，Tether 通常会区分“用户地址风险”和“协议合约风险”。

但这不是零风险。若出现以下情况，风险会显著上升：

1. 多个 USDT 黑名单地址通过 JustLend 清算、赎回、借贷迁移资产。
2. 平台没有监控、告警、处置、留痕机制。
3. 合规机构或 Tether 认为 jUSDT 池子被反复用于规避冻结。
4. 出现媒体或社区集中讨论，形成声誉压力。

因此，对 JustLend 来说，重点不是证明“合约一定没风险”，而是建立可解释、可审计、可响应的风控流程。

## 9. JustLend 可采取的规避措施

BR-001: 接入 USDT 黑名单监控。对所有活跃借款人、供应人、清算人、前端连接地址定时调用 USDT 合约 `getBlackListStatus(address)`，并监听 `AddedBlackList`、`RemovedBlackList`、`DestroyedBlackFunds` 事件。

BR-002: 建立关联地址图谱。将新地址激活资金来源、历史互转、同一清算对象、同一兑换路径、同一资金归集地址纳入关联评分。

BR-003: 建立黑名单地址风险队列。若用户地址命中 USDT 黑名单，应进入内部合规工单，而不是只依赖 Risk Value 是否到 100。

BR-004: 不建议贸然阻断链上清算。清算是避免坏账的核心机制，直接禁止清算可能扩大协议损失；更合理的是前端提示、后台告警、合规留痕、必要时通过治理调整特定市场参数。

BR-005: 建立 jUSDT 合约暴露看板。监控黑名单地址相关借款额、供应额、清算额、jUSDT 池 USDT 余额、可赎回压力、USDT 转账失败率。

BR-006: 建立稳定币发行方响应预案。若发现合约级风险信号，应准备地址清单、交易证据、资金路径、风险控制动作，并联系 Tether compliance、法律顾问和核心治理方。

BR-007: 将清算簇纳入异常监控。若同一清算人与同一被清算地址在短时间内连续出现多笔清算，且存在历史资金关系，应触发“关联清算”告警。

## 10. 行业案例参考

### 10.1 Tether / OKX / DOJ 冻结 2.25 亿 USDT

2023 年 11 月，Tether 与 OKX、美国司法部协作，冻结约 2.25 亿 USDT。公开资料称，这些资金位于外部自托管钱包，和东南亚跨国犯罪组织及“杀猪盘”骗局相关。OKX 公告称，调查使用了 Chainalysis 等链上分析工具，Tether 主动冻结相关 USDT，这是当时最大规模的 USDT 冻结案例之一。

他们做了什么：
- 使用链上分析工具追踪资金流。
- 交易所与稳定币发行方配合执法机构定位资金。
- Tether 对外部自托管钱包中的 USDT 执行冻结。
- 向执法机构提供资金路径和地址证据。

结果：
- 大额涉案 USDT 被阻断继续流转。
- 稳定币发行方展示了对 AML 风险的主动响应能力。
- 也说明稳定币合约黑名单机制会真实影响链上地址资产可用性。

对 JustLend 的启发：
JustLend 无法控制 Tether 是否冻结地址，但应能快速识别“黑名单地址是否正在通过协议迁移价值”。平台需要准备可导出的链上证据包，包括地址关系、交易路径、协议交互和当前敞口。

参考链接：[OKX 公告](https://www.okx.com/en-us/learn/tether-okx-investigation)

### 10.2 Aave CRV 大户集中抵押风险

2023 年，Aave 社区围绕 CRV 大户仓位多次讨论风险治理。Gauntlet 指出，某大户在 Aave v2 中以大量 CRV 作为抵押借出稳定币，虽然当时健康因子没有立即危险，但 CRV 流动性下降，仓位集中度高，若继续累积会增加协议清算和坏账风险。

他们做了什么：
- Gauntlet 发布风险建议，建议冻结 Aave v2 的 CRV 市场。
- 治理提案将 CRV reserve 冻结，阻止新增 CRV 供应和借款。
- 后续 v2 Deprecation Plan 中继续调整冻结资产的 LTV / LT 等参数。

结果：
- 提案于 2023-08-19 执行。
- CRV 风险敞口增长被限制。
- 风险处置从“等待爆仓”转为“提前限制新增风险”。

对 JustLend 的启发：
对于 `TLfa...eusu` 这类高风险地址，不一定要直接修改链上合约逻辑，但可以通过治理或风控策略限制新增风险敞口，例如降低特定资产借款能力、限制前端新增供应、对黑名单关联地址设置观察名单。

参考链接：[Aave CRV 冻结提案](https://governance-v2.aave.com/governance/proposal/297)、[Gauntlet 风险建议](https://governance.aave.com/t/arfc-gauntlet-recommendation-on-freezing-crv-for-aave-v2-ethereum/14428)

### 10.3 Compound DAI 价格异常清算事件

2020 年 11 月，Compound 因 DAI 在 Coinbase Pro 上短时涨至约 1.30 美元，触发大规模清算。Compound 当时使用 Coinbase Oracle 参与价格计算，协议合约按规则执行，但用户侧出现大量非预期清算。Compound 社区随后讨论是否补偿受影响用户，以及是否需要改进预言机机制。

他们做了什么：
- 社区公开复盘 DAI 清算事件。
- 讨论补偿受影响用户，但早期补偿提案未通过。
- 后续 Compound 推进预言机体系调整，引入更稳健的价格源机制。

结果：
- 协议“按规则执行”并不等于用户和社区接受风险结果。
- 大规模清算事件推动了预言机和风险参数治理升级。
- 清算事件成为 DeFi 风控里“机制正确但结果不可接受”的典型案例。

对 JustLend 的启发：
本次事件中，JustLend 清算也可能是“机制正确”。但如果平台没有识别黑名单关联清算，外部会关注“平台是否被用于规避冻结”，而不是只看合约是否按规则执行。风控报告要同时覆盖合约正确性、合规风险和用户信任风险。

参考链接：[Compound DAI Liquidation Event](https://www.comp.xyz/t/dai-liquidation-event/642)、[Compound 补偿讨论](https://www.comp.xyz/t/dai-liquidation-compensation/684)

### 10.4 Mango Markets 市场操纵事件

2022 年，Mango Markets 遭遇价格操纵攻击。攻击者通过操纵 MNGO 永续合约价格，提高账户抵押价值，再从协议中借出大量资产。美国司法部后续将该案作为加密开放市场操纵案件处理，2024 年 Avraham Eisenberg 被判犯有商品欺诈、商品市场操纵和电汇欺诈等罪名。

他们做了什么：
- 协议和社区通过治理讨论资金返还与处置。
- 执法机构介入，将链上操纵行为纳入刑事追责。
- 司法系统明确将 DeFi 中的开放市场操纵纳入可追责范围。

结果：
- 事件从“链上策略争议”升级为刑事案件。
- DeFi 协议意识到，链上交易可执行不代表法律和合规层面无风险。
- 风控模型开始更重视市场操纵、关联账户、价格影响和资金路径。

对 JustLend 的启发：
“链上允许”不是合规免责。本次关联地址清算也不能只以“清算函数正常执行”作为最终结论。平台应能说明：是否识别到黑名单地址、是否识别到关联地址、是否采取过合理监控与响应。

参考链接：[DOJ 公告](https://www.justice.gov/opa/pr/man-convicted-110m-cryptocurrency-scheme)

## 11. 最终判断

本事件不宜定性为 JustLend 协议漏洞，也暂不宜定性为直接资金损失事件。更准确的定性是：

**黑名单地址通过关联账户在 JustLend 内执行连续清算与资产迁移的合规高风险事件。**

判断依据：

1. `TLfa...eusu` 在清算发生前已被 USDT 合约加入黑名单。
2. `TRq3...dURa` 与 `TLfa...eusu` 存在明确启动资金关系。
3. `TRq3...dURa` 连续清算 `TLfa...eusu`，金额合计超过 40 万 USDT。
4. 清算后存在赎回、兑换、再转移等资金路径。
5. `TRq3...dURa` 当前未被 USDT 黑名单限制，具备承接资产价值的现实意义。

## 12. 下一步行动清单

1. 建立 `TLfa...eusu` 与 `TRq3...dURa` 的一跳/二跳地址图谱。
2. 拉取 USDT `AddedBlackList` 全量事件，回溯所有命中 JustLend 的地址。
3. 对 JustLend 活跃用户、借款人、清算人建立每日黑名单扫描任务。
4. 对“黑名单地址 + 关联清算 + 大额抵押品迁移”建立 SEV-2 告警。
5. 准备对内复盘材料：事实、影响、处置、后续监控规则。
6. 准备对外谨慎口径：只描述链上事实和平台风控动作，避免未经证实的法律定性。

## 13. 参考资料

| 类型 | 链接 |
|------|------|
| JustLend 清算机制 | [JustLend Liquidations](https://docs.justlend.org/getting_started/concepts/liquidations/) |
| TRON 只读合约调用 | [triggerconstantcontract](https://developers.tron.network/reference/triggerconstantcontract) |
| TRON 事件查询 | [Events API](https://developers.tron.network/reference/get-events-by-contract-address) |
| Tether / OKX / DOJ 冻结 USDT | [OKX 公告](https://www.okx.com/en-us/learn/tether-okx-investigation) |
| Aave CRV 治理处置 | [Aave Proposal 297](https://governance-v2.aave.com/governance/proposal/297) |
| Aave CRV 风险建议 | [Gauntlet 风险建议](https://governance.aave.com/t/arfc-gauntlet-recommendation-on-freezing-crv-for-aave-v2-ethereum/14428) |
| Compound DAI 清算复盘 | [Compound DAI Liquidation Event](https://www.comp.xyz/t/dai-liquidation-event/642) |
| Compound 补偿讨论 | [DAI Liquidation Compensation](https://www.comp.xyz/t/dai-liquidation-compensation/684) |
| Mango Markets 司法处理 | [DOJ 公告](https://www.justice.gov/opa/pr/man-convicted-110m-cryptocurrency-scheme) |
