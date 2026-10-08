# JustLend 第三方冻结风险实时看板

## 2026-10-08 USDT / jUSDT 自动发现与持仓队列

本专项只监测官方 USDT 与 jUSDT 合约。经 E 入金的出资方、jUSDT 接收方和时间有序的后续 USDT / jUSDT 接收方自动纳入持续队列。普通下游地址继续追踪；公共平台、共用 E/H/I 和市场合约停止穿透，避免把公共代理的其他用户并入同一资金批次。余额归零和滚动流水过期不会移除有效关联地址；重启从代理快照恢复。

仅查询 JustLend USDT 市场的 jUSDT 余额、兑换率及 USDT 借款。页面以 jUSDT 折算的 USDT 存款余额作为当前存量，借款另列；不以净头寸替代存量，不叠加再存流水。按地址去重，区间决定关注的出资方和权益接收方，后续流向可晚于区间结束，持仓始终为最新观测值。关联地址持仓含其他时期及混同资金，可归因于本批资金的金额保持未知，转给市场不自动证明赎回。

旧多币种快照在 GET 展示时即过滤其他资产流向和仓位；下一轮采集重建 USDT / jUSDT 关联队列，清除仅由其他币种关联的地址与其他市场仓位，保留有效 USDT 地址余额并重新补查流向。其他专项的扫描配置不变。

后台沿用每 300 秒的非重入轮询，每轮最多扫描 40 个地址流向和 300 个 USDT 持仓，按上次尝试时间轮转；默认上限为 5,000 地址、4 跳、100,000 条流向边。新发现地址自动排队，可能需多轮补齐。超过 15 分钟未成功刷新标为过期或待补，失败不计为零。分页未完成不推进完成游标，容量或跳数受限明确提示。

GET `/api/xinbi-proxy` 只读缓存，`trackingView` 返回区间关联地址当前 USDT 存款、逐地址 jUSDT 份额、USDT 借款及覆盖状态；`positions` 保留 E/H/I 共用合约参考值，单独展示。本功能不覆盖跨链或换币后的同源证明。

验证：`node --test proxy-tracking.test.js proxy-monitor.test.js xinbi-monitor.test.js xinbi-investigation.test.js`。部署包含 `proxy-tracking.js`，保留生产配置、密钥与缓存。测试覆盖 97 个接收地址入队、轮询、下游转移、时间顺序、公共平台边界、旧多币种缓存迁移、归零保留、重启恢复及失败/过期/容量限制。

## 2026-09-18 外部代理 E 独立监测

`proxy-monitor.js` 每 300 秒独立扫描 E/H 最近 30 天的已确认 TRC20 转账；TronGrid 为主数据源，沿用现有请求节流和凭据，固定时间窗及 fingerprint 翻页；TronScan 为主源失败时的后备，按实际条数推进 offset。每地址最多 40 页，触及上限或同交易出资/jUSDT 到账证据不完整时明确标记覆盖不足。该任务不依赖新币来源路径命中和普通候选轮询，GET `/api/xinbi-proxy` 只读缓存。默认返回最近 7 天，支持 `since` / `until` ISO 时间参数（需同时提供，起点早于终点，终点不晚于当前时间，跨度最多 30 天），无效参数返回 400。前端使用北京时间输入，点击「应用」后汇总、每日统计和三组交易明细统一按区间重算；「最近 7 天」恢复滚动窗口。持仓始终为最新读取值，不是历史区间余额。

缓存 v2 保留最近 30 天的转账原始记录供区间聚合；更早区间标记覆盖不完整，不执行页面触发的历史补扫。旧版缓存需等待首次扫描完成后才能提供区间结果。扩大采集窗口后仍保留分页上限，触顶时提示覆盖不足。`dataThrough` 表示最近扫描覆盖到的时间。

页面前置展示 E 全地址、外部代存作用、每日独立出资地址/笔数/USDT、交易哈希、接收地址经 H 存入的单列金额、E/H/I 当前链上持仓及逐项读取时间。E 入金与 H 后续入金不相加；不宣称已完成跨资产和全部历史资金去重，不将共用代理所有入金自动定性为新币资金。持仓读取失败展示未知；失败扫描保留上次结果并标记异常。数据缓存为 `data/xinbi-proxy-snapshot.json`，不公开为静态文件。

修复历史事件提示覆盖新活动，以及 E/H 历史资金被错误套用于后续独立出资的问题。共用代理处仅接受同交易的资金传递作为原路径证据；独立代理监测仍完整展示其入金。风险提示在看板内展示，本次未增加向外部渠道发送通知。

验证：`node --test xinbi-monitor.test.js xinbi-investigation.test.js proxy-monitor.test.js`。部署增加 `proxy-monitor.js`、`proxy-ui.js`，并更新 `server.js`、`index.html`、`xinbi-monitor.js`、`xinbi-ui.js`；保留生产配置和缓存。独立扫描本身不会清空或覆盖既有新币调查状态。

## 新币风险监控（2026-09-09）

在现有页面新增独立的新币风险区块，`GET /api/xinbi` 只读取最近的监控快照，不触发链上扫描。后台每 300 秒启动一轮；上一轮未结束时不重入。原 HTX 扫描与新币扫描独立，共用既有 API 节流。

- 地址来源：[MistTrack 原帖](https://x.com/MistTrack_io/status/2097334357891645946)的原始配图，原始 10 个地址，加上 Bitrace 两篇更新中的 12 个去重新地址，共 22 个（20 个新币担保、2 个 XPay），均经过 Base58Check 校验。逐地址保存来源链接和业务分类。归属来源与链上冻结状态分别记录；首次读取建立冻结基线，后续变化保留观测时间。
- 资产来源：[JustLend 官方 jToken API](https://openapi.just.network/lend/jtoken)。使用配置内合约白名单和精度，避免同名假币。覆盖 22 个底层 TRC20 资产及 23 个 jToken。
- 资金路径：seed 直接进入协议、经 1 或 2 个中转地址进入协议；按同一资产合约、严格时间先后匹配。跨资产或向 seed 转出后再入金仅标记为 P2 交互关联。经过已识别公共平台的路径停止穿透。
- 异常行为：单笔 ≥100,000 USDT、24 小时至少 5 笔且累计 ≥100,000 USDT、多 seed 汇集、入金后 1 小时内收到协议出金；这些是待核信号，不直接认定洗钱。包含 ≤1 USDT 线索的路径降为 P2。
- 操作识别：通过目标交易中已配置协议合约的 `Mint / RepayBorrow / LiquidateBorrow / Borrow / Redeem` 事件识别存款、还款、代还款与清算等操作；接口失败或分页不完整明确显示。监控相关账户 jToken 转出，继续发现接收方；向市场转回权益仅列为待核赎回，匹配同市场、赎回人及原始凭证数量的 Redeem 事件后才确认。
- jUSDT 专项视图：从同一份新币风险快照中单独汇总进入 `jUSDT market` 的关联入金，以及相关账户之间的 `jUSDT Transfer`。关联入金交易总额不是涉案金额，权益转移数量不是当前余额；登记事件单独展示完整的两组存款、权益转移、赎回证据；滚动扫描仍不代表全量历史仓位。
- 取数：仅确认的 `Transfer`，排除 Approval、零额、铸造/销毁零地址、无效时间和非白名单资产。跨账户返回的同一记录去重。API 未提供 log index 时，相同 tx/合约/收发方/原始金额保守折叠，可能少计。
- 持久化：`data/xinbi-monitor-state.json` 保存增量游标、已取转账、冻结基线与操作缓存；`data/xinbi-snapshot.json` 为公开快照。文件原子写入并排除 Git。静态服务只开放页面资源，配置、源码、运行缓存及 `.env` 不作为静态文件提供。

参数位于 `riskSources.xinbi`：30 天回溯、4,000 个候选账户、每轮 53 个账户、每账户最多 2 页（200 条/页）、最多保留 100,000 条转账、每轮解析最多 30 笔入金操作。22 个来源地址和已登记的 7 个调查地址去重后优先，其余名额轮询；最多为权益地址预留剩余名额的一半，其余按最近扫描时间轮询；来源地址不受候选容量限制，候选提升为来源或更短路径时重新补扫历史；有来源资金证据的候选优先于未扫描的仅交互候选。头部增量与历史回溯使用独立、固定时间窗的 fingerprint，避免换窗漏页。

**覆盖边界**：5 分钟是任务启动频率，不代表所有候选账户都在 5 分钟内完成扫描。页面展示已扫描、历史未完成、错误和容量上限；资金流命中数是当前已扫描范围，入金金额不是涉案金额。暂不覆盖 TRX 原生转账、跨链追踪、DEX 换币同源证明、全量历史仓位、登记事件以外的 2 个中转以上路径，以及自动更新的新币实体归属名单。地址新增须保留来源证据。Bitrace 180 万 USDT 收款地址 `TAnP1DxhEuCtbGqX66RV8TtWdDUJzhErzp` 按 depth=1 优先候选跟踪，保存两笔交易证据，不作为实体来源地址或缩短路径深度。

### 2026-09-10 事件调查与 jUSDT 后续监控

- `xinbi-investigation.js` 登记 7 地址、10 笔交易及两组存赎路径，保留来源、角色、原始金额和逐笔交易链接。只有报道来源地址沿用实体归属，其余地址按资金路径关联展示，不提升为来源地址。
- 两组分别存入 800,000 与 1,000,000 USDT，jUSDT 转移后已全部赎回，合计赎回 1,800,000.205174 USDT。历史存款额不代表当前敞口。七地址当前 jUSDT 余额单独读取；代理合约返回 3 个 32 字节槽位时取首槽余额，并要求其余槽位为 0；调用失败或格式异常仍显示未知。
- 固定台账独立于 30 天滚动窗口和 100,000 条转账缓存。后台向 TronGrid 读取确认事件，按合约、收发方、整数金额及 Mint/Redeem 字段复核；成功后每 24 小时重查，失败下一轮重试。复核失败、证据不一致和等待复核分别显示；保留上次成功的历史日志并明确本次复核状态。
- 固定交易的内部 USDT 转账使用 event_index 确定同笔交易顺序，补齐外部代理合约路径；和账户接口的重复记录去重，不把 jUSDT 铸造当成 USDT 返款。固定台账与滚动列表不能相加。
- `rightsMaxHops: 4` 限制后续权益接收方发现，`maxRightsAccounts: 200` 提供独立候选额度。到达公共平台或已配置协议地址停止扩展；接收方继续转移、向市场转回凭证及已核赎回分别展示。权益关联不等于逐份凭证的同源证明。
- 回归样本位于 `test-fixtures/xinbi-2026-09-09-events.json`，来自 2026-09-10 读取的 10 笔 TronGrid 原始事件。测试离线回放，覆盖完整路径、金额精度、错误及分页、重启和窗口过期、候选容量、前端呈现与静态资源隔离。
- 部署新增模块时一并更新 `server.js`、`xinbi-monitor.js`、`xinbi-ui.js`、`index.html` 和 `config.json` 中的三个新增参数；保留服务器其余配置、密钥和运行缓存。旧 version=1 状态自动兼容，不需要清空生产数据。部署及重启须获得授权。SSH 使用 macOS 系统 `/usr/bin/ssh -o UseKeychain=yes`，沿用已有密钥与 nn 账户、6673 端口。

验证：

```bash
node --test xinbi-monitor.test.js xinbi-investigation.test.js
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
