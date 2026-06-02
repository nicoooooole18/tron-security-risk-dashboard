# JustLend 第三方冻结风险实时看板 MVP

## 启动

```bash
node server.js
```

打开：

```text
http://localhost:8787
```

## 当前接入

- TRON USDT `getBlackListStatus(address)`：检查 watched address 是否命中 USDT blacklist。
- TRON USDC `isBlacklisted(address)`：检查 watched address 是否命中 USDC blacklist；接口不可用时展示“未知”。
- 用户黑名单交集：优先从 `userAddressPool.onchainSources` 配置的 jToken Transfer 事件发现候选地址，并用 `balanceOf(address) > 0` 过滤当前 holder；`userAddressPool.addresses` 作为手工补充。随后逐个检查 USDT / USDC blacklist。
- Tronscan TRC20 transfers：读取 watched address 的近期 USDT 流入。
- HTX SP-1 / SP-2：优先复用既有 CEX 地址库，`config.json` 中的手工地址作为补充。SP-2 必须证明 HTX -> 平台地址 -> 钱包 -> JustLend 的完整链路。

## 配置说明

- `watchedAddresses`：JustLend market、reserve、treasury、bot、admin 等需要检查的地址。
- `userAddressPool.onchainSources`：链上用户地址池来源；当前 MVP 接入 `jUSDT holder`，从近期 jUSDT Transfer 候选中调用 `balanceOf` 过滤当前持仓地址。
- `userAddressPool.addresses`：手工补充的 JustLend 当前用户地址池，支持字符串地址或 `{ address, role, market, source, note }` 对象。
- `cexAddressBookPath`：既有 CEX 地址库路径，当前指向 `tron-monitor-dashboard/data/cex-address-book.json`。
- `riskSources.useCexAddressBook`：是否启用既有 CEX 地址库。
- `riskSources.htxSeedAddresses`：经确认的 HTX / Huobi Global S.A. TRON 地址，作为地址库之外的手工补充。
- `riskSources.intermediatePlatformAddresses`：经确认的平台中转地址，作为地址库之外的手工补充。
- `dashboard.riskThresholdUsd`：大额观察阈值，只做辅助标签，不进入第三方冻结风险等级。

未接入地址库且未配置 HTX seed 时，看板仍读取真实链上流入和冻结状态，但不会伪造 SP-1 / SP-2 命中。

没有冻结命中、没有 SP-1、没有 SP-2 时，看板显示为 `未命中`，不再使用 `P3` 表达正常状态。单纯 `其他平台地址 -> 钱包 -> JustLend` 不计入 HTX SP 风险，按 `未命中` 处理，只在说明中保留 CEX 来源上下文。链上流入事件支持 `仅看命中` 筛选，只显示真正命中 HTX SP 路径的事件。
