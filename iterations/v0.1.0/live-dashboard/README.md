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

- 顶层 Tab：`现有监控` 保留冻结、新币和代理监控；`MEXC 专项` 独立展示归因复核、USDT / USDD 入金、jUSDT / jUSDD 权益和地址来源。支持 `/#mexc` 直达。
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

## MEXC 专项（USDT / USDD）

生产入口为 `http://43.134.57.52/freeze-risk/#mexc`。本轮采用**复核快照发布**：`reviewed-snapshots/` 保存已经核验、带原始时点的两市场快照，配合 `mexc-attribution-review.json` 展示归因。若有独立采集器生成的 `data/mexc*-snapshot.json`，运行时快照优先；没有时使用发布基线，既不清空也不覆盖其他生产缓存。历史归因不因刷新按钮而自动变成实时值。

VPS 内存余量不足以安全承载本地约 267 MB 的完整 MEXC 回查状态，**本轮不启用 `mexc-worker.js` 持续采集服务**。既有冻结、新币、代理采集沿用原服务。MEXC 后续数据需要经资源评估后单独启用采集器，或重新复核发布；页面保留覆盖范围、过期状态和逐行余额时点。快照原文件不通过 HTTP 静态路径开放，仅由只读 API 返回公开视图。

来源清单为 `mexc-sources.json`。2026-11-16 登录 Arkham、选择 Tron 后，累计核对了 2 个 MEXC 热钱包和 37 个充值地址；每条保留标签、来源链接、核对日期和状态，新增充值地址另附可见转账证据。该清单是**已核对的子集**，不代表全量 TRON 地址；当前账号的历史分页受 Enterprise 权限限制，用户已选择按可核对地址继续。交易对手、提款接收方不会自动成为 MEXC 来源地址。`predicted` / `removed` 均不用于来源匹配。扩充清单会使旧快照失效，采集器重新计算关联路径。

### 本地预览与采集

无需新依赖，使用 Node 22。预览服务器只读取缓存，不启动原有后台扫描器：

```sh
DASHBOARD_READ_ONLY=1 HOST=127.0.0.1 PORT=8789 node server.js
```

打开 `http://127.0.0.1:8789/#mexc`。独立终端运行一轮只读链上采集：

```sh
node mexc-worker.js --once
```

持续采集使用 `node mexc-worker.js`，顺序运行 USDT 和 USDD 两个独立市场队列，每轮结束后等待 300 秒。只读调用 TronGrid，沿用本地 `.env` 的 `TRON_PRO_API_KEY`；不发链上交易。`/api/mexc` 只允许 GET，刷新页面不触发扫描。前端每 30 秒读取快照，仅在 MEXC Tab 可见时轮询。USDT 数据写入被 Git 忽略的 `data/mexc-state.json`、`data/mexc-snapshot.json`；USDD 使用 `data/mexc-usdd-state.json`、`data/mexc-usdd-snapshot.json`。缓存、完整审计底稿及配置不会随静态文件公开。

采集器使用独占 `data/mexc-worker.lock`，禁止多进程写同一缓存；进程异常退出后会保留锁，应确认原进程已停止后再清理。`MEXC_DATA_ROOT` 可隔离运行时缓存目录，来源清单仍从代码目录读取；标准服务器读取代码目录下的缓存，隔离目录用于调试，不会自动改变服务器读取位置。

固定窗口历史回查使用：

```sh
node mexc-backfill.js
# 上一个任务退出后，运行独立 USDD 队列
node mexc-backfill.js --market=USDD
```

首次启动将截止时间（运行时前 2 分钟，避开未确认块）保存到 `data/mexc-backfill-window.json`，窗口长度 30 天。再次运行沿用同一窗口和断点，直到所有相关队列完成或出现明确错误，不等待日常采集的 300 秒间隔。每轮进度分别写入 `data/mexc-backfill-progress.json` 或 `data/mexc-usdd-backfill-progress.json`；`scanComplete=true` 仅表示**当前标签子集、资产与追踪规则内**的回查完成，`sourceComplete` 始终为 false。此命令不部署服务。

USDT 回查按已确认的 USDT 入金页向上追踪；USDD 队列读取已确认入账，识别 USDT / USDD 资金边并补齐 USDD 入账回执以查找 PSM 换币。任意合约通过市场入金交易的完整回执穿透，避免扫描并混入合约其他用户的历史资金。命中路径的每一跳均补充原始日志核验；已关联钱包再读取 jUSDT 历史。独立的 `mexc-boundaries.json` 保留核对过的公共平台钱包及 Arkham 来源，新增边界会撤销旧关联，并排除仅经该平台才能到达的候选地址。平台标签变更不会悄悄保留旧归因。

第二层钱包的上游入账只需查询到它最后一笔相关出款的时间；之后到达的资金不可能解释此前的目标入金。市场、第一层钱包和权益历史仍保留完整窗口。后来发现更晚的连接交易时，自动扩大该地址的范围并重新分页；同一轮新回执发现的连接也会在完成判定前处理。已完成且范围更大的缓存不重复查询。

第二层钱包连续读取超过 64 页后，将所需时间范围拆成 12 个无重叠、无间隙的区间，各自保存分页游标，在同一请求限速器下并行续跑。重读缓存按交易事件去重；仅全部区间完成后才将该地址标记为完成。单一区间失败不会抹掉其他区间的进度。

回查默认 4 路并发、请求启动间隔 200ms，每轮每地址最多连续读取 64 页以减少大体积缓存的重复计算，遵守 429/403 限流反馈；未完成时保留游标，不将错误当作完成。回查保护上限独立于日常监控：50,000 个地址、1,000,000 条转账、100,000 个回执、20,000 条归档入金、10,000 个权益地址。触及上限会停止并报告不完整。

### 识别与展示口径

- 覆盖官方 TRON USDT / jUSDT 及 USDD / jUSDD 市场。USDT 精度为 6、USDD 为 18，两类 jToken 均为 8，整数计算并按资产分别展示。按市场入金向上回查近 30 天、最多 2 个钱包中转；任意合约仅穿透同交易内有序的 Transfer，不套用新币固定代理地址。
- USDT → PSM → USDD → jUSDD 自动串联要求同一成功回执中 SellGem、USDT 入金、USDD 铸造及支付人与接收人路径闭合，金额与精度逐项匹配；支持直接 PSM 和路由调用。非零手续费、其他 DEX 换币与跨链暂不自动串联。识别路径不等于确认来源本金。
- 交易回执必须在已确认链上成功，Transfer 与原始日志逐项核对；交易索引尚未同步时继续等待，不能作为核验成功。以交易哈希、合约和日志序号去重；Mint / RepayBorrow 匹配操作人、原始金额和事件顺序。
- 直接金额是标签地址转入的交易额；间接金额是具有时间顺序的代表路径的关联交易额，**可归因金额未知**。粉尘、公共平台边界和未知地址类型单独处理。金额使用整数计算，普通转账不能冒充存款。
- 从核验后的 Mint 与对应 jToken 铸造事件开始追踪，最多 4 次权益转手；公共平台停止扩展。共用合约只在同交易内延续权益路径，跨交易等量转出只列待核。赎回须匹配 Redeem，否则仅列候选。
- 已用真实 JustLend 回执验证 `Mint` 在 jUSDT `Transfer` 之前的事件顺序，并兼容 4 字段及尾部为零的 6 字段持仓返回。持仓检查时间使用实际查询时间，与固定历史窗口分开。
- 关联钱包对应市场的 jToken 份额、底层资产等值和借款通过 `getAccountSnapshot` 查询；其全部持仓含混同资金，不能与入金、转手或赎回金额相加。已关联地址会持续跟踪；首次入金归因窗口仍为 30 天。
- 监管事件、Arkham 归属标签、USDT 冻结各自独立。标签关联不代表违法；没有命中不代表没有资金流入。

### 归因复核与留存

`mexc-attribution-review.json` 保存本次固定审计结果；`mexc-attribution.js` 校验来源版本、证据来源、去重本金和分组区间后与两个采集快照合并。本次共 61 笔已复核明细：原 23 笔 USDT 加 38 笔 USDD，其中 USDD 比前次增加 36 笔。明细可按关联强度、资产、路径及时间筛选，顶部卡片保持完整复核范围，后续新增命中不会自动累加确认金额。

归因窗口为北京时间 2026-10-17 17:54:03 至 2026-11-16 17:54:03，延续此前固定的 30 天窗口。USDD 回查已完成：1,145 个入队地址、38 笔命中，历史待查、回执待核、读取错误均为零，无遍历上限截断。USDD 留存时点为 2026-11-17 21:10:00–21:11:18；11 月 18 日 USDT 专项更新了 TKs / TM9 / TMM / TLY，逐行展示时点，不将所有资产标成同一时刻。11 月 17 日基线（界面下限向下、上限向上保留两位）：

- 新增 36 笔的来源本金区间 **123,635.806098–213,339.915986 USDT**；对应 jUSDD 留存折合 **123,626.42–213,339.97 USDD**。全部 38 笔 USDD 交易中，有 24 笔未增加可归因本金，包含借款换币、赎回后再存及已流往别处的来源资金。
- 合并原 USDT 复核后，已确认来源本金下限 **138,838.196314 USDT**：498.8 还款 + 138,339.396314 换币存入；来源本金首次进入只计一次。
- 疑似新增本金 **0–173,548.823271 USDT**：总本金联合上限 312,387.019585，扣除已确认下限；已另扣除 USDT / USDD 共享的 0.000038 USDT 上限。各笔上限不可直接相加，原 8,137,658.347386 USDT 是交易流水。
- 全部已复核 USDD 线索当前仍持有的 jUSDD 折合 **123,626.42–224,949.31 USDD**，下限可确认，上限含未确认部分。USDT 留存区间 **0–41,451.13 USDT**，单独计量，不与 USDD 相加。
- `TYYC…` 于 11 月 17 日赎回后，原确认留存已不再成立：当前归因区间为 **0–10,097.20 USDD**。`TAja…` 的来源本金下限为 **113,295.890162 USDT**、上限 203,000；上游资金混同，不能把整笔存入归因于 MEXC。
- 还款进入公共池，不当作个人存款权益；AMM 后尚未厘清的权益单列，不能据钱包清仓推定协议内全部清零。

复核采用全额流水、时间有序资金守恒和分组上下界，扣除已证明流往其他用途的来源资金，防止循环还款、再借、再存重复计数。同区块交易顺序保守放宽；PSM 仅接受已核验、零手续费的 1:1 换币。当前留存追踪本批 Mint 对应的 jToken 份额，扣除随后转出，并按余额时点兑换率折算（含利息）。11 月 18 日另核对赎回现金的回流并扩展 TLY 的保守留存范围，历史来源本金未重复增加。

`mexc-fund-flow.js` 为整数资金守恒及份额计算，`mexc-audit-collect.js` 收集完整流水、原始日志核对过的回执及一致余额，`mexc-audit-review.js` 生成并校验版本 2 复核结果。审计覆盖 14 个钱包、1,522 份回执；新版底稿为本地忽略文件 `data/mexc-usdd-audit-evidence-2026-11-17.json`，旧底稿为 `data/mexc-attribution-evidence-2026-11-16.json`，旧 25 笔结论保存在 `test-fixtures/mexc-review-baseline-2026-11-16.json`。两脚本须顺序运行，不能同时写同一审计文件：

```sh
node mexc-audit-collect.js
node mexc-audit-review.js
```

上述值始终标注审计时点；后续已识别权益转出提示重新复核。在线采集持仓是相关钱包全额，不冒充可归因留存。来源清单版本改变、窗口不一致、证据未收齐或审计校验失败时不发布新复核金额。当前采集范围仍为已核对的 Arkham 地址子集。

### 11 月 17 日追加复核：TAja 混同与疑似金额拆解

本次查清 TAja 的 220,000 USDT 直接出款方为 `TEub…mtVX`：SunX 官方文档列示的金库合约。其 Transfer 回执已与链上原始日志核对，后续依次转到 TTb、TWu。TWu 在核对窗口内的完整 USDT 流水没有直接返回 TAja / TTb；这不排除更长路径，也不代表掌握 SunX 的平台内部资金来源。另有一个首尾相似、完整地址不同的 `TTbNp8…` 转入 1 USDT，未将它误认作原 TTb 来源。

TAja 的本金区间仍为 **113,295.890162–203,000 USDT**，未确认差额 **89,704.109838 USDT**；当前本批 jUSDD 留存折合 **113,295.91–203,000.05 USDD**。`mexc-taja-review.js` 基于完整 TAja / TTb 收支构建上下界的两组可行分配，每一组均满足全部来源入流、转账容量与余额守恒。两端都可成立，因而不能仅凭等额进出将区间压缩，也不能采用 FIFO、LIFO 或比例分摊冒充已证实的归属。金库标签仅解释直接出款方，不能据此认定 22 万全部为非 MEXC 资金。

另独立复算 `TKsT…` 的 0–40,992.11 USDT 区间，结果未变。其余主要疑似构成为 `TM9…` 33,083 USDT、`TMM…` 9,141.827663 USDT；这两组当前钱包 jUSDT 均为零。合计疑似上限仍为 **173,548.823271 USDT**，本次没有足够证据可靠缩窄金额。页面新增逐组本金差额及留存表、8 笔关键时间线、两种可行分配和核对边界，所有金额与顶部汇总校验一致。

新增原始查询缓存：`data/mexc-deepening-2026-11-17.json`；追加前结论：`data/mexc-deepening-baseline-2026-11-17.json`；完整上下界分配证明：`data/mexc-taja-extremal-proof-2026-11-17.json`。以上为本地忽略文件。可复现的 TAja / TTb 回放样本保存在 `test-fixtures/mexc-taja-mixing-2026-11-17.json`。新证据不自动扩展已核对的 MEXC 标签地址库。

### 11 月 18 日追加复核：USDT 上游与赎回回流

本轮 USDT 组疑似本金仍为 **0–83,844.713421 USDT**，其中 TKs 为 0–40,992.11、TM9 为 0–33,083、TMM 为 0–9,141.827663，其余各组共 627.775758。三组均保存通过节点余额、边容量及全额来源守恒校验的上下界分配；本次没有新增确认本金，也没有用主观分摊缩小区间。该数不是包含 USDD 路径的全部疑似本金（后者仍为 173,548.823271 USDT）。

- TKs 在固定窗口收到已标记 MEXC 来款 50,573.2 USDT，但与其他入账混同，不能全部算入 JustLend 存款。
- TM9 的 33,083 USDT 来自 TD27；TD27 的期初余额、其他来款与 MEXC 出款混同，因此来源区间仍从零起。
- TMM 上限由 TN3 路径 8,990.25 和 TWT 路径 151.577663 USDT 构成。TXt 的 121.5 USDT 来款对本批存款贡献上限为零；TMM 后来直接收到的 7,999.662191 USDT 也不能逆向解释此前存款。9 笔 Mint 共用来源，不能把逐笔上限相加。

TM9 赎回 33,083.102514 USDT 后，1,700 转入 SunSwap V4 PoolManager（[官方地址依据](https://docs.sun.io/protocols/sunswap-v4/reference/contract/)），其余 31,383.102514 转给 TPm。完整账本及双向 PSM 回执证明：其中 **31,383.1025 USDT 赎回现金** 经 USDD → TEAq → USDT 路径再次存入 JustLend；TPm 留下 0.000014 USDT。两笔 Mint 总操作额是 1,031,383.8024 USDT，包含其他来源，不是 MEXC 新本金。已确认的是回流现金，MEXC 来源部分仍为 **0–31,383.1025 USDT（含利息）**。

TEAq 随后将 jUSDT 送入 `TEr2…21z6` 合约。首次复核在此保留跨交易边界；本页下方“TM9 公共合约后续追踪”已补齐分流与赎回，现金更远路径仍未闭合。TM9 原钱包 jUSDT 清零不能据此把全协议留存设为零。1,700 USDT 的其他资产路径也单列未闭合。

TMM 赎回后出现回到自身再存、经 TD7 / TJRo 到 TLY 再存等路线。TLY 新上限使用原组在每次转出前可能已入金的本金、历史 Mint / Redeem 比率构造含利息的保守现金上限，再按 TLY 全额账本与份额计算；下限固定为零，**不把假定可能来源产生的数学下限提升为确认值**。TD7 的 10 USDT 原路径与回流在同一账本去重，新值替换 TLY 原钱包上限，不重复相加。回流终点可晚于原首次入金窗口，单独展示且不增加原 61 笔或历史来源本金。公共合约及更长路径仍可能有留存，钱包汇总不代表全协议上限。

11 月 18 日核对结果：TKs 原钱包留存为 **0–41,004.364629 USDT**；TLY 包含回流的保守留存为 **0–9,004.410003 USDT**，已替换原约 10 USDT 上限。已核对钱包合计为 **0–50,446.549449 USDT**（界面上限 50,446.55），因新增回流覆盖而上调；仍不包括公共合约及更长路径的未闭合权益。12 个完整账本、4,906 份去重回执；109 个直接收款方中 101 个钱包出账探查完成、8 个合约作为边界，错误与分页截断均为零。

`mexc-usdt-collect.js` 为只读补充采集器，`mexc-usdt-review.js` 复算来源与现金回流，`mexc-fund-flow.js` 支持显式来源、单笔及共用来源上限、已核验的双向 PSM。完整底稿和上下界分配分别保存在被忽略的 `data/mexc-usdt-deepening-2026-11-18.json`、`data/mexc-usdt-return-evidence-2026-11-18.json`、`data/mexc-usdt-return-candidates-2026-11-18.json`、`data/mexc-usdt-extremal-proof-2026-11-18.json`。回流探查及双市场终点索引为 `data/mexc-usdt-reentry-probes-2026-11-18.json`、`data/mexc-return-market-index-2026-11-18.json`。页面仅公开审计摘要；原始底稿、测试样本和计算脚本不通过 HTTP 静态服务开放。

固定样本复算：`node mexc-usdt-review.js`。该命令要求所有选定钱包回执完成且索引覆盖探查截止时间；失败不覆盖已发布的本地复核文件。`mexc-audit-review.js` 也会重新应用已完成的 USDT 专项，防止重算 USDD 时丢失新增留存。采集应串行运行（500 ms 请求间隔），限流后保留断点；不同时写同一文件。上述命令和本地预览均不执行部署。

### 11 月 18 日追加：TM9 公共合约后续追踪

固定追踪对象是 **31,383.1025 USDT 已核实回流现金**，不是新增确认 MEXC 本金。补充了 59 个完整账户账本、271 笔与原始日志核对过的回执，以及 55 个现金接收方的完整出账探查；无分页截断或未解决的读取错误。TQqg 合约的同笔等量 jUSDT 转发由回执穿透，不把它标为 MEXC 地址。首次入金 30 天窗口和原 61 笔统计保持不变。

- TEr2 的 24 个直接接收地址包括 TEAq、22 个分流钱包和同笔转发的 TQqg。23 个钱包都已正式赎回。TEr2 剩余 **1.20946437 jUSDT**；截至北京时间 **2026-11-18 17:29:51**，本批可归属的原始 jUSDT 权益为 **0–0.013183 USDT**（含兑换率及向上舍入）。至少 **31,383.089329 USDT 原始本金**已发生首次赎回；这不等于永久退出。
- 22 个分流钱包的赎回款经 18 个中转地址归集至 TS7o / TUAP，与 TEAq 赎回款共同汇入 TBF。完整现金守恒证明全部 **2,343,946.217772 USDT 总操作额**又存入 JustLend，随后赎回 **2,343,970.962037 USDT**，转至 TSE。TSE 分给 TSM **1,200,000 USDT**、TNT **1,143,970 USDT**，留下 **0.962037 USDT** 现金。上述大额操作包含其他来源，不归为 MEXC 本金。
- 后续发现经 TNT→TM3→PSM 的 **5 笔 USDD 存款，总操作额 396,872 USDD**。TNT 中途余额下降至 0.062168 USDT，因此**沿已核对、以外部出账为边界的路径**，这 5 笔共享 **0–0.062168 USDT** 的来源上限。该值不排除外部绕行后返回，也不是全链来源上限。jUSDD 已追踪至另外 5 个接收钱包并全部核验 Redeem；这 5 笔 Mint 对应的剩余 jUSDD 为 **0**，再赎回的 USDD 现金去向另列边界。
- **全协议当前留存仍未闭合**。原批 jUSDT 上限不能替代全协议上限；更远现金、其他资产和跨链回流未穷尽，仍可能涉及整批 31,383.1025 USDT 原始本金。USDT 与 USDD 不相加，反复存入不增加历史来源本金，已确认金额不变。

`mexc-tm9-collect.js` 串行限速读取已确认账本、余额与回执；显式地址可继续扩展，`--contracts` 仅允许对显式指定的合约做有分页保护的查询。`mexc-tm9-cash-probe.js` 比对双市场入金索引并保留分页覆盖。`mexc-tm9-flow.js` 对 jToken 用整数容量、共用两笔 Mint 来源上限建立保守包络；保存的极值分配证明该包络可行，不声称逐币身份或精确最优经济归属。`mexc-tm9-usdd.js` 单列 USDD 路径及其来源边界。

本地原始证据为 `data/mexc-tm9-followup-2026-11-18.json`、`data/mexc-tm9-cash-probes-2026-11-18.json`；守恒证明为 `data/mexc-tm9-share-proof-2026-11-18.json`，均不由 HTTP 静态服务公开。离线真实回放样本为 `test-fixtures/mexc-tm9-followup-2026-11-18.json`。执行 `node mexc-tm9-review.js` 可从缓存复算；`node mexc-usdt-review.js` 和 `node mexc-audit-review.js` 会重新应用此结果。证据采集中或不完整时，复算拒绝覆盖现有本地快照。新增数据也参与后续权益变化提示。生产发布采用本节开头说明的复核快照模式。

### 覆盖与运行限制

每轮默认最多 8 个地址、每地址 2 页、20 笔回执、20 个钱包持仓。历史分页与增量分页使用各自固定的时间范围和游标，重启后续扫。高活跃市场首次回查可能需要多轮，不能将首批结果视为完整 30 天扫描。界面展示历史待扫、增量待追平、回执待核、失败、追踪边界及容量上限。

默认保护上限：2,000 个候选地址、100,000 条转账、30,000 个回执、5,000 条归档入金、1,000 个权益地址。触及上限时标记不完整，不默默视为扫描完成；生产部署前应根据流量调整采集吞吐和存储策略。列表最多展示 500 条入金 / 权益 / 赎回、100 条合约待核，汇总保留全部已识别结果。接口失败保留上次快照并提示，超过 15 分钟的持仓及冻结状态显示待核，不用零代替失败。

### 验证

```sh
node --test mexc-tm9-review.test.js mexc-usdt-review.test.js mexc-fund-flow.test.js mexc-attribution.test.js mexc.test.js xinbi-monitor.test.js xinbi-investigation.test.js proxy-monitor.test.js proxy-tracking.test.js
```

测试覆盖：真实 PSM 直连和路由交易回放、USDD 精度、换币缺证/错额/错收款人排除、双市场采集隔离与断点；资金混同上下界、联合上限去重、借款和赎回再存不增加本金、后续无关 Mint 不恢复已转出份额；版本 2 汇总、来源证据防重复、余额逐行时点、混同组确认下限展示及 38 笔筛选；共享上游路径缓存、未来资金排除、合约跨交易误归因、公共平台边界、精确金额、日志核验、协议动作、jToken 转手与赎回、分页续扫与重启、地址清单变更、限额与读取失败、接口只读与文件隔离，以及既有新币 / 代理回归。
