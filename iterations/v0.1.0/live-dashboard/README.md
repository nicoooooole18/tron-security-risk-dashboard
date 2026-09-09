# JustLend 第三方冻结风险实时看板

## 新币风险监控（2026-09-09）

在现有页面新增独立的新币风险区块，`GET /api/xinbi` 只读取最近的监控快照，不触发链上扫描。后台每 300 秒启动一轮；上一轮未结束时不重入。原 HTX 扫描与新币扫描独立，共用既有 API 节流。

- 地址来源：[MistTrack 原帖](https://x.com/MistTrack_io/status/2097334357891645946)的原始配图，10 个完整地址均经过 Base58Check 校验。归属来源与链上冻结状态分别记录；首次读取建立冻结基线，后续变化保留观测时间。
- 资产来源：[JustLend 官方 jToken API](https://openapi.just.network/lend/jtoken)。使用配置内合约白名单和精度，避免同名假币。覆盖 22 个底层 TRC20 资产及 23 个 jToken。
- 资金路径：seed 直接进入协议、经 1 或 2 个中转地址进入协议；按同一资产合约、严格时间先后匹配。跨资产或向 seed 转出后再入金仅标记为 P2 交互关联。经过已识别公共平台的路径停止穿透。
- 异常行为：单笔 ≥100,000 USDT、24 小时至少 5 笔且累计 ≥100,000 USDT、多 seed 汇集、入金后 1 小时内收到协议出金；这些是待核信号，不直接认定洗钱。包含 ≤1 USDT 线索的路径降为 P2。
- 操作识别：通过目标交易中已配置协议合约的 `Mint / RepayBorrow / LiquidateBorrow / Borrow / Redeem` 事件识别存款、还款、代还款与清算等操作；接口失败或分页不完整明确显示。监控相关账户 jToken 转出，不声称已完整跟踪权益后续赎回。
- 取数：仅确认的 `Transfer`，排除 Approval、零额、铸造/销毁零地址、无效时间和非白名单资产。跨账户返回的同一记录去重。API 未提供 log index 时，相同 tx/合约/收发方/原始金额保守折叠，可能少计。
- 持久化：`data/xinbi-monitor-state.json` 保存增量游标、已取转账、冻结基线与操作缓存；`data/xinbi-snapshot.json` 为公开快照。文件原子写入并排除 Git。静态服务只开放页面资源，配置、源码、运行缓存及 `.env` 不作为静态文件提供。

参数位于 `riskSources.xinbi`：30 天回溯、2,000 个候选账户、每轮 40 个账户、每账户最多 2 页（200 条/页）、最多保留 100,000 条转账、每轮解析最多 30 笔入金操作。seed 优先，其余账户轮询；有来源资金证据的候选优先于未扫描的仅交互候选。头部增量与历史回溯使用独立、固定时间窗的 fingerprint，避免换窗漏页。

**覆盖边界**：5 分钟是任务启动频率，不代表所有候选账户都在 5 分钟内完成扫描。页面展示已扫描、历史未完成、错误和容量上限；资金流命中数是当前已扫描范围，入金金额不是涉案金额。暂不覆盖 TRX 原生转账、跨链追踪、DEX 换币同源证明、全量历史仓位、2 个中转以上路径，以及自动更新的新币实体归属名单。地址新增须保留来源证据。

验证：

```bash
node --test xinbi-monitor.test.js
node --check server.js
node --check xinbi-ui.js
```

部署顺序：验证通过 → Git 提交与推送 → 备份既有服务文件 → 部署上述提交的文件 → 重启冻结风险服务 → 核对 `/freeze-risk/api/xinbi` 的地址状态、扫描完成时间和运行错误。不得以本地测试缓存覆盖生产监控状态。

这是一个零依赖 Node.js 实时看板，用于监控 JustLend 在 TRON 链上的第三方冻结风险、用户黑名单交集和 HTX SP 风险路径。

## 启动

```bash
node server.js
```

打开：

```text
http://localhost:8787
```

VPS 部署时建议配置：

```env
TRON_PRO_API_KEY=your_trongrid_key
TRONSCAN_API_KEY=your_tronscan_key
HOST=0.0.0.0
PORT=8787
```

## 看板结构

- 顶部风险状态：展示当前是否存在冻结命中、用户黑名单交集或 HTX SP 风险路径。
- 指标卡片：Tether 黑名单、Circle 黑名单、近期高风险流入、HTX SP 识别。
- 地址风险监控：
  - 协议地址监控：默认 tab，检查 JustLend 自身地址。
  - 用户地址监控：检查 JustLend 用户地址库与 USDT / USDC 黑名单交集。
- 链上流入事件：按 30 天窗口分页读取已启用 `trackTransfers=true` 的 watched address USDT 流入，默认展示最近 100 条，支持按日期和命中状态筛选。
- HTX SP 路径命中：仅展示链上证据完整的 HTX -> 钱包 / 平台 -> JustLend 命中路径。
- 配置状态：页面底部按钮打开弹窗，查看 HTX seed、平台中转 seed、TronGrid Key 状态、监控地址数和 HTX 地址标签明细。

## 当前接入

- 协议地址：31 个 JustLend 协议地址，包括核心合约、治理/Oracle 合约和 jToken market。
- 用户地址库：从多个 jToken Transfer 事件增量发现地址，维护到共享组件 `../../../shared/address-book/data/justlend-address-book.json`。
- USDT 黑名单：调用 TRON USDT `getBlackListStatus(address)`。
- USDC 黑名单：调用 TRON USDC `isBlacklisted(address)`。
- HTX SP：
  - `HTX_SP0_direct`：HTX seed 直接流入 JustLend watched address。
  - `HTX_SP1_wallet_inflow`：HTX -> TRON 钱包 -> JustLend。
  - `HTX_SP2_platform_proven`：HTX -> 其他平台 -> TRON 钱包 -> JustLend。
  - 单纯其他平台 -> 钱包 -> JustLend 只作为上下文，不计入 HTX 风险。

## 后台快照

页面不再直接等待链上全量扫描。

- 服务启动后后台生成风险快照。
- `/api/snapshot` 返回最近一次缓存快照。
- 刷新按钮只触发后台刷新，不阻塞页面。
- 默认每 300 秒后台刷新一次，可通过 `dashboard.snapshotRefreshSeconds` 或 `SNAPSHOT_REFRESH_SECONDS` 调整。
- 流入窗口默认 30 天，可通过 `dashboard.inflowLookbackDays` 或 `INFLOW_LOOKBACK_DAYS` 调整；分页按接口实际返回条数推进 offset，页面展示上限默认 100 条，可通过 `dashboard.eventDisplayLimit` 或 `EVENT_DISPLAY_LIMIT` 调整。
- 链上流入扫描优先使用 TronGrid account TRC20 fingerprint 分页；没有 TronGrid key 时回退 Tronscan offset 分页；只统计 `Transfer`，排除 `Approval` 授权记录。Tronscan 请求支持 `TRONSCAN_API_KEY`，遇到 429 会按 `RATE_LIMIT_RETRY_MS` 退避重试。
- 运行时快照写入 `data/live-snapshot-cache.json`，该文件已忽略，不提交。

## 配置说明

- `watchedAddresses`：JustLend 协议地址清单。
- `userAddressPool.addressBookPath`：JustLend 用户地址库路径，默认指向仓库共享组件。
- `userAddressPool.autoJTokenSources`：从 watched jToken market 自动派生用户地址发现来源。
- `userAddressPool.scanLimit`：每轮用户黑名单扫描地址数。
- `cexAddressBookPath`：既有 CEX 地址库路径；VPS 会兜底尝试 `/home/nn/project/tron-monitor-dashboard/data/cex-address-book.json`。
- `riskSources.useCexAddressBook`：是否启用既有 CEX 地址库。
- `riskSources.htxSeedAddresses`：手工补充 HTX / Huobi seed 地址。
- `riskSources.intermediatePlatformAddresses`：手工补充其他平台中转地址。
- `dashboard.riskThresholdUsd`：大额观察阈值，只做辅助标签。
- `dashboard.inflowLookbackDays`：链上流入统计窗口，当前为 30 天。
- `dashboard.inflowPageSize` / `dashboard.inflowMaxPages`：TronScan 分页扫描保护上限；如果接口实际返回条数小于请求条数，系统按实际返回条数继续翻页，直到到达窗口起点、空页或页数上限。
- `dashboard.eventDisplayLimit`：链上流入事件表默认展示上限，当前为 100 条。
- `TRONSCAN_API_KEY` / `TRONSCAN_API_KEY_HEADER`：Tronscan API Key 与请求头名称；默认请求头为 `TRON-PRO-API-KEY`。
- `TRONSCAN_REQUEST_DELAY_MS` / `RATE_LIMIT_RETRY_MS`：Tronscan 请求节流与 429 退避间隔。

## 安全说明

- `.env` 已被忽略，不提交 TronGrid API Key。
- `data/live-snapshot-cache.json` 是运行时缓存，不提交。
- `../../../shared/address-book/data/justlend-address-book.json` 是共享地址库初始数据，会提交。
