# TRON Security Risk Dashboard

JustLend 第三方冻结风险实时看板，用于监控 USDT / USDC 第三方黑名单、JustLend 协议地址风险、用户地址风险交集，以及 HTX SP-1 / SP-2 风险路径。

## 当前版本

主看板目录：

```text
iterations/v0.1.0/live-dashboard
```

核心能力：

- 协议地址监控：覆盖 JustLend 核心合约与 jToken market 地址。
- 用户地址监控：维护 JustLend 地址库，从多个 jToken Transfer 事件增量发现用户/参与地址。
- 第三方黑名单：读取 TRON USDT `getBlackListStatus(address)` 与 USDC `isBlacklisted(address)`。
- HTX SP 识别：复用既有 CEX 地址库，识别 HTX -> 钱包 -> JustLend、HTX -> 平台 -> 钱包 -> JustLend 风险路径。
- 30 天流入覆盖：链上流入事件上方固定展示最近 30 天每日覆盖，包含 0 流入日期；当前仅统计启用 `trackTransfers=true` 的协议地址，点击日期可筛选下方事件明细。
- 后台快照缓存：页面读取最近一次缓存快照，后台定时刷新，避免前端刷新阻塞链上全量扫描。
- 风险下线友好：HTX 专题作为第三方冻结风险分支，可在风险解除后从配置中下线。

## 本地启动

```bash
cd iterations/v0.1.0/live-dashboard
node server.js
```

打开：

```text
http://localhost:8787
```

## 环境变量

生产或 VPS 部署时需要在 `iterations/v0.1.0/live-dashboard/.env` 中配置：

```env
TRON_PRO_API_KEY=your_trongrid_key
TRONSCAN_API_KEY=your_tronscan_key
HOST=0.0.0.0
PORT=8787
```

`.env` 已被 `.gitignore` 排除，不会提交到 GitHub。

## 部署建议

```bash
git clone https://github.com/nicoooooole18/tron-security-risk-dashboard.git
cd tron-security-risk-dashboard/iterations/v0.1.0/live-dashboard
node server.js
```

生产环境建议使用 `pm2` 或 `systemd` 托管进程，并通过 Nginx 配置 HTTPS 反向代理。

## 数据口径

- 协议地址：当前覆盖 31 个 JustLend 协议地址，包括核心合约、治理/Oracle 合约与 jToken market。
- 用户地址库：当前由多个 jToken 的链上 Transfer 事件增量维护，作为共享组件落地为 `shared/address-book/data/justlend-address-book.json`。
- 链上流入：默认覆盖最近 30 天；每日覆盖按扫描窗口聚合，优先用 TronGrid account TRC20 fingerprint 分页，Tronscan 作为备用并支持 API key 和 429 退避重试，事件明细受展示上限控制，用于排查具体交易。
- 快照缓存：运行时快照写入 `data/live-snapshot-cache.json`，该文件不提交。
- CEX 地址库：HTX 和其他平台地址优先复用既有 CEX 地址库，手工 seed 作为补充。
