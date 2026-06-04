# JustLend 第三方冻结风险实时看板

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
HOST=0.0.0.0
PORT=8787
```

## 看板结构

- 顶部风险状态：展示当前是否存在冻结命中、用户黑名单交集或 HTX SP 风险路径。
- 指标卡片：USDT 黑名单、USDC 黑名单、近期高风险流入、HTX SP 识别。
- 地址风险监控：
  - 协议地址监控：默认 tab，检查 JustLend 自身地址。
  - 用户地址监控：检查 JustLend 用户地址库与 USDT / USDC 黑名单交集。
- 链上流入事件：展示 watched address 的近期 USDT 流入，支持仅看命中。
- 配置状态：页面底部按钮打开弹窗，查看 HTX seed、平台中转 seed、TronGrid Key 状态和监控地址数。

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
- 运行时快照写入 `data/live-snapshot-cache.json`，该文件已忽略，不提交。

## 配置说明

- `watchedAddresses`：JustLend 协议地址清单。
- `userAddressPool.addressBookPath`：JustLend 用户地址库路径，默认指向仓库共享组件。
- `userAddressPool.autoJTokenSources`：从 watched jToken market 自动派生用户地址发现来源。
- `userAddressPool.scanLimit`：每轮用户黑名单扫描地址数。
- `cexAddressBookPath`：既有 CEX 地址库路径。
- `riskSources.useCexAddressBook`：是否启用既有 CEX 地址库。
- `riskSources.htxSeedAddresses`：手工补充 HTX / Huobi seed 地址。
- `riskSources.intermediatePlatformAddresses`：手工补充其他平台中转地址。
- `dashboard.riskThresholdUsd`：大额观察阈值，只做辅助标签。

## 安全说明

- `.env` 已被忽略，不提交 TronGrid API Key。
- `data/live-snapshot-cache.json` 是运行时缓存，不提交。
- `../../../shared/address-book/data/justlend-address-book.json` 是共享地址库初始数据，会提交。
