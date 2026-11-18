"use strict";
(() => {
  const el=id=>document.getElementById(id);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const time=v=>v && Number.isFinite(new Date(v).getTime())?new Date(v).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):"待查询";
  function amount(v,decimals=6) {
    if(!/^\d+$/.test(String(v??"")))return "待核";
    const n=BigInt(v),unit=10n**BigInt(decimals),fraction=String(n%unit).padStart(decimals,"0").replace(/0+$/,"");
    return `${String(n/unit).replace(/\B(?=(\d{3})+(?!\d))/g,",")}${fraction?`.${fraction}`:""}`;
  }
  const addr=a=>/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a||"")?`<a class="mexc-address" href="https://tronscan.org/#/address/${a}" target="_blank" rel="noopener noreferrer">${a}</a>`:esc(a);
  const tx=t=>/^[0-9a-f]{64}$/i.test(t||"")?`<a href="https://tronscan.org/#/transaction/${t}" target="_blank" rel="noopener noreferrer">${t.slice(0,12)}… ↗</a>`:"证据待核";
  const empty=(n,text)=>`<tr><td colspan="${n}" class="mexc-empty">${esc(text)}</td></tr>`;
  const kinds={direct:"直接入金",wallet:"钱包中转",contract:"合约路径",conversion:"USDT → USDD 换币"};
  const ops={Mint:"存款 · Mint",RepayBorrow:"还款 · RepayBorrow",Transfer:"普通转账",pending:"协议动作待核"};
  let current=null,active=false,inflight=false,fetchError="";
  const levels={confirmed:"已确认",mixed:"中 · 存在混同",weak:"弱 · 间接关联",diverted:"未增加可归因本金",pending:"新增待复核"};
  const tokenInfo=c=>c==="TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz"?["USDD",18]:c==="TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf"?["jUSDD",8]:c==="TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd"?["jUSDT",8]:["USDT",6];
  function rounded(v,d=6){if(!/^\d+$/.test(String(v??"")))return "待核";const n=BigInt(v),unit=10n**BigInt(d),c=(n*100n+unit/2n)/unit;return `${String(c/100n).replace(/\B(?=(\d{3})+(?!\d))/g,",")}.${String(c%100n).padStart(2,"0")}`;}
  function bound(v,d=6,upper=false){const n=BigInt(v),unit=10n**BigInt(d),c=(n*100n+(upper?unit-1n:0n))/unit;return `${String(c/100n).replace(/\B(?=(\d{3})+(?!\d))/g,",")}.${String(c%100n).padStart(2,"0")}`;}
  function interval(lo,hi,d=6){if(lo==null||hi==null)return "待核";return lo===hi?rounded(hi,d):`${bound(lo,d)} ～ ${bound(hi,d,true)}`;}
  function tm9Followup(f,flows){
    if(!f)return "";const p=f.originalShareRetention,c=f.teaCashReturn,q=f.cashProbe,pool=p.positions.find(p=>p.address===f.pool);
    return `<section class="mexc-tm9-followup"><h3>TM9 · 公共合约之后的资金去向</h3><p>本次追踪 ${amount(f.cohortCashRaw)} USDT 回流所对应的 jUSDT。<strong>来源归因未变，新增确认 MEXC 金额为 0。</strong></p>
      <div class="mexc-retention-summary"><div><span>原批 jUSDT · 已核对剩余权益</span><strong>${f.needsReview?"后续变化，待复核":`0 ～ ${amount(p.upperRaw)} USDT`}</strong><small>仅 TEr2 的微量合约余额可能承载本批权益；${esc(time(pool.asOf))}。不是全协议留存上限。</small></div><div><span>原始现金中 · 至少已发生首次赎回</span><strong>${amount(f.redeemedOriginalPrincipalLowerRaw)} USDT</strong><small>按原始本金计，不含后续利息；赎回后仍可能再存，不能等同永久离场。</small></div></div>
      <p><strong>全协议当前留存：尚未闭合。</strong> 现金更远路径仍可涉及整批 ${amount(f.unresolvedCashPrincipalUpperRaw)} USDT 原始本金；不能把上面的微量权益作为全协议上限，也不与已有钱包留存重复相加。</p>
      <p><strong>已核实去向：</strong>TEr2 → ${f.coverage.redeemingWallets} 个钱包赎回。${f.cashConvergence?`其中 22 个分流钱包经 18 个中转地址及 TS7o / TUAP 归集，与 TEAq 一路汇合至 TBF；全部赎回现金 ${amount(f.cashConvergence.cashRaw)} USDT 再存入 JustLend。`:`TEAq 的 ${amount(c.cashRaw)} USDT 赎回款经 TBF 再存。`}TBF 随后赎回 ${amount(c.redeem.amountRaw)} USDT，转给 TSE，再分出 ${c.split.map(r=>`${amount(r.amountRaw)} USDT 至 ${addr(r.to)}`).join("；")}。TSE 尚余 ${amount(c.tseCashRemainingRaw)} USDT 现金；TBF / TSE 的 jUSDT 均为 0。以上为总操作额，包含其他来源。</p>
      ${q?`<p><strong>现金后续检查：</strong>截至 ${esc(time(q.asOf))}，${q.targets} 个接收地址中 ${q.complete} 个出账分页完整、${q.limited} 个截断、${q.contracts} 个合约边界。已将这些地址及其出账接收方与 USDT / USDD 的 JustLend 入金索引比对，${q.candidateCount?`发现 ${q.candidateCount} 条路径${f.usddReturn?`，其中 ${f.usddReturn.entries.length} 笔 USDD 存款已完成专项归因`:"，待归因"}。`:`未发现额外直接入金或再经一个钱包入金的路径。`}此结果不覆盖更远钱包、其他资产或跨链回流。</p>`:""}
      ${f.usddReturn?`<div class="mexc-retention-summary"><div><span>已核对 USDD 路径 · 来源上限</span><strong>0 ～ ${amount(f.usddReturn.sourceUpperRaw,18)} USDT</strong><small>${f.usddReturn.entries.length} 笔存入合计 ${amount(f.usddReturn.grossRaw,18)} USDD；TNT 中途余额仅 ${amount(f.usddReturn.bottleneck.balanceRaw)} USDT，限制沿此路径承接的本批资金；外部绕行返回未排除。</small></div><div><span>这批 jUSDD · 已核对剩余权益</span><strong>${f.needsReview?"后续变化，待复核":`${f.usddReturn.upperRaw==="0"?"0":`0 ～ ${amount(f.usddReturn.upperRaw,18)}`} USDD`}</strong><small>已追踪转手后的 ${f.usddReturn.redemptions.length} 笔正式赎回；后续现金仍单列未闭合，不能宣称整条路径永久退出。</small></div></div><details><summary>查看 ${f.usddReturn.entries.length} 笔 USDD 换币再存、最低余额和赎回证据</summary><p>关键限制余额的交易：${tx(f.usddReturn.bottleneck.transfer.txid)}。已核验 PSM 换币：${f.usddReturn.swapProofs.map(tx).join(" · ")}。${esc(f.usddReturn.note)} 各行是总操作额；不是 MEXC 可归因金额。</p>${flows(f.usddReturn.entries.map(r=>({...r,label:"USDD Mint · 总操作额"})))}${flows(f.usddReturn.redemptions.map(r=>({...r,label:"转手接收方赎回 USDD"})))}${flows(f.usddReturn.redemptions.flatMap(r=>r.outgoing.map(x=>({...x,label:"再赎回后现金边界"}))))}<p>沿已核对路径再赎回的本批现金上限为 ${amount(f.usddReturn.redeemedCashUpperRaw,18)} USDD，含保守利息及舍入，不是已确认 MEXC 金额。余额快照范围：${esc(time(f.usddReturn.watchpoints[0]?.asOf))} 至 ${esc(time(f.usddReturn.watchpoints.at(-1)?.asOf))}。</p></details>`:""}
      <details><summary>查看 ${f.coverage.redeemingWallets} 个赎回钱包、金额与现金去向</summary><p>每行是实际交易额；公共合约内混同后的来源分配不唯一，不代表各行均为 MEXC 资金。</p><div class="table-wrap"><table><thead><tr><th>赎回钱包</th><th>赎回总额 · USDT</th><th>现金后续去向</th><th>赎回证据</th></tr></thead><tbody>${f.redemptions.map(r=>`<tr><td>${addr(r.to)}</td><td>${amount(r.amountRaw)}</td><td>${r.outgoing.map(x=>`${addr(x.to)} · ${amount(x.amountRaw)} USDT · ${tx(x.txid)}`).join("<br>")}</td><td>${tx(r.txid)}</td></tr>`).join("")}</tbody></table></div><p>TEr2 原始余额 ${amount(pool.wholeSharesRaw,8)} jUSDT，本批可归属区间 0 ～ ${amount(pool.upperSharesRaw,8)} jUSDT。已核对钱包余额均为 0。</p></details>
      <details><summary>查看再次存入、再次赎回与最终分账证据</summary>${flows([...(f.cashConvergence?.hubTransfers||[]).map(r=>({...r,label:"分流赎回款归集至 TBF"})),{...c.mint,label:"TBF 再存 · 总操作额"},{...c.redeem,label:"TBF 再赎回 · 总操作额"},{...c.toTse,label:"转给 TSE"},...c.split.map(r=>({...r,label:"TSE 分账"}))])}<p>TQqg 同笔转入转出相等、顺序及官方代币回执已核验：${f.routerRoutes.map(r=>tx(r.incoming.txid)).join(" · ")}。公共合约与中转地址不据此标记为 MEXC 自有地址。</p></details>
      ${q?`<details><summary>查看现金后续覆盖与边界</summary><div class="table-wrap"><table><thead><tr><th>接收地址</th><th>检查起点</th><th>出账条目</th><th>覆盖状态</th><th>直接入金条目</th></tr></thead><tbody>${q.rows.map(r=>`<tr><td>${addr(r.address)}</td><td>${esc(time(r.since))}</td><td>${r.rows}</td><td>${r.status==="complete"?"分页完整":r.status==="limited"?"截断，保留未知":"合约边界"}</td><td>${r.directEntries}</td></tr>`).join("")}</tbody></table></div>${q.candidates.length?flows(q.candidates.slice(0,20).map(r=>({...r.entry,label:"路径线索，尚未归因"}))):""}</details>`:""}
      <p>标准回执 ${f.coverage.receipts} 笔、完整账本 ${f.coverage.ledgers} 个，jUSDT 账本截断 ${f.coverage.truncatedShareLedgers}；各行余额使用各自区块快照。两笔 Mint 共用一个来源上限，逐条路径的最大值不能累加。</p></section>`;
  }
  function renderUSDTDeepening(){
    const box=el("mexcUSDTDeepening"),d=current.review?.usdtDeepening;box.hidden=!d;box.innerHTML="";if(!d)return;
    const t=d.tm9,m=d.tmm,p=m.returnRetention,c=d.coverage;
    const flows=rs=>`<div class="table-wrap"><table><thead><tr><th>时间 / 说明</th><th>资金方向</th><th>实际交易额</th><th>链上证据</th></tr></thead><tbody>${rs.map(r=>{const [asset,decimals]=tokenInfo(r.contract);return `<tr><td>${esc(time(r.blockTs))}<small>${esc(r.label||"")}</small></td><td>${addr(r.from)}<br>→ ${addr(r.to)}</td><td>${amount(r.amountRaw,decimals)} ${asset}</td><td>${tx(r.txid)}</td></tr>`;}).join("")}</tbody></table></div>`;
    box.innerHTML=`<div class="section-head"><div><span class="section-kicker">最新专项复核 / TKs · TM9 · TMM</span><h2>赎回后回流与来源混同</h2></div><span class="pill muted">${esc(time(d.checkedAt))}${fetchError?" · 读取失败，保留快照":""}</span></div>
      <p><strong>本轮 USDT 组的历史疑似本金仍为 ${amount(d.suspectedUpperRaw)} USDT，本次新增确认金额为 0。</strong> 三组占 ${amount(d.focusUpperRaw)}，其他组 ${amount(d.otherUpperRaw)} USDT。完整收支均容许归因上下界，暂不能继续压低来源上限。</p>
      <div class="table-wrap"><table><thead><tr><th>来源组</th><th>历史本金 · USDT</th><th>原钱包留存 · USDT</th><th>来源核对结论</th></tr></thead><tbody>${d.focus.map(f=>`<tr><td>${addr(f.address)}</td><td>${interval(f.lowerRaw,f.upperRaw)}</td><td>${f.retention.needsReview?"后续变化，待复核":interval(f.retention.lowerRaw,f.retention.upperRaw)}<small>${esc(time(f.retention.asOf))}${f.retention.status==="wallet-closed"?" · 仅原钱包清零":""}</small></td><td>${esc(f.note)}</td></tr>`).join("")}</tbody></table></div>
      <div class="mexc-retention-summary"><div><span>TM9 · 已核实赎回现金再存</span><strong>${amount(t.cashReturnLowerRaw)} USDT</strong><small>其中可归因 MEXC 的部分：${interval(t.mexcReturnLowerRaw,t.mexcReturnUpperRaw)} USDT，含利息，尚未确认来源</small></div><div><span>TMM 回流所涉 TLY · 当前可能留存</span><strong>${p.needsReview?"后续变化，待复核":interval(p.lowerRaw,p.upperRaw)} USDT</strong><small>保守上限，已替换下方 TLY 原值；包含原路径，不另行相加 · ${esc(time(p.asOf))}</small></div></div>
      ${tm9Followup(t.followup,flows)}
      <p><strong>TM9 路径：</strong>赎回 → TPm → PSM 换 USDD → TEAq → PSM 换回 USDT → JustLend → jUSDT 跨交易合约。两笔再存的总操作额 ${amount(t.grossReentryRaw)} USDT 含其他来源，不能归为 MEXC 新本金。</p>
      <p>${esc(t.note)} 因此原钱包余额为 0，不能显示为“全部资金已退出”。</p>
      <p><strong>TMM 路径：</strong>经 ${addr(m.routes.find(r=>r.via.startsWith("TJRo"))?.via)} / ${addr(m.routes.find(r=>r.via.startsWith("TD7"))?.via)} 到 ${addr(m.returnWallet)} 后再存。${esc(m.note)}</p>
      <details><summary>查看三组上游混同与上下界证明依据</summary><p>以下为原固定窗口的完整 USDT 收支，包含赎回等资金；不是新增来源本金。未知资金不自动标记为非 MEXC。三组均保存了满足所有余额与转账约束的上下界分配。</p>${d.focus.map(f=>`<h3>${esc(f.address.slice(0,4))} · 已核对 MEXC 来款 ${f.sourceCount} 笔 / ${amount(f.sourceRaw)} USDT</h3><div class="table-wrap"><table><thead><tr><th>钱包</th><th>期初余额</th><th>窗口流入</th><th>其中已标记 MEXC 来款</th><th>窗口流出</th><th>对本组本金的可能贡献</th></tr></thead><tbody>${f.funds.map(w=>`<tr><td>${addr(w.address)}</td><td>${amount(w.openingRaw)}</td><td>${amount(w.incomingRaw)}</td><td>${amount(w.verifiedMexcRaw)}</td><td>${amount(w.outgoingRaw)}</td><td>${interval(w.sourceContributionLowerRaw,w.sourceContributionUpperRaw)}</td></tr>`).join("")}</tbody></table></div>`).join("")}</details>
      <details><summary>查看 TM9 换币回流与合约边界证据</summary>${flows(t.timeline)}<p>PSM 反向换币已核验付款、销毁、收款及 BuyGem 事件：${t.swapProofs.map(tx).join(" · ")}。换币两端的原始回执用于守恒计算。</p>${flows(t.poolTransfers.map(r=>({...r,label:"jUSDT 转入跨交易合约"})))}<p>TEAq 后续赎回 ${amount(t.laterRedeem.amountRaw)} USDT：${tx(t.laterRedeem.txid)}。该钱包与合约混同后的全额赎回，不能逐币对应此前 MEXC 疑似份额。</p></details>
      <details><summary>查看 TMM 回流路线 · ${m.routes.length} 组，${m.redemptionCount} 次赎回背景</summary><p>已核验转账与终点 Mint；路径成立不代表全部金额来自赎回或 MEXC。同一终点可匹配多条路径，禁止累加总操作额。</p>${m.routes.map(r=>`<h3>${esc(r.via.slice(0,4))} → ${esc(r.destination.slice(0,4))}</h3>${flows(r.parents.map(p=>({...p,label:"TMM 转给中转钱包"})))}${flows(r.edges.map(e=>({...e,label:"中转钱包后续转出"})))}${flows(r.terminals.map(e=>({...e,label:"终点 Mint · 总操作额"})))}`).join("")}</details>
      <p>覆盖 ${c.wallets} 个完整账本、${c.receipts} 笔标准回执；赎回后 ${c.firstRecipients} 个直接收款方中，${c.walletProbes} 个钱包已完成出账探查、${c.contractBoundaries} 个合约作为追踪边界。终点索引核对至 ${esc(time(c.marketUntil))}，探查至 ${esc(time(c.probeUntil))}；错误 ${c.errors}、分页截断 ${c.limited}。</p><ul>${d.limitations.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`;
  }
  function renderDeepening(){
    const box=el("mexcDeepening"),d=current.review?.deepening;box.hidden=!d;box.innerHTML="";if(!d)return;
    const f=d.focus,p=f.retention;
    const why=BigInt(d.reductionRaw)===0n?"本次补充了来源和流向证据，尚未取得能可靠缩小金额区间的新证据。":"本次已据新增证据调整区间，变化详见逐组结果。";
    box.innerHTML=`<div class="section-head"><div><span class="section-kicker">专项复核 / TAja 优先</span><h2>疑似本金拆解与混同证据</h2></div><span class="pill muted">${esc(time(d.checkedAt))}</span></div>
      <p><strong>${esc(why)}</strong> 上次疑似上限 ${amount(d.previousSuspectedUpperRaw)} USDT；本次 ${amount(d.suspectedUpperRaw)} USDT。</p>
      <div class="mexc-retention-summary"><div><span>TAja 来源本金 · USDT</span><strong>${interval(f.lowerRaw,f.upperRaw)}</strong><small>其中 ${amount(f.uncertainRaw)} USDT 仍有混同不确定性</small></div><div><span>TAja 当前留存 · USDD</span><strong>${p.needsReview?"后续权益变化，待复核":interval(p.lowerRaw,p.upperRaw,18)}</strong><small>本批 jUSDD 折合值 · ${esc(time(p.asOf))}</small></div></div>
      <p>${esc(f.conclusion)}</p><p>${addr(f.sourceLabel.address)} · <a href="${esc(f.sourceLabel.url)}" target="_blank" rel="noopener noreferrer">${esc(f.sourceLabel.label)}的官方地址依据 ↗</a></p>
      <details><summary>查看全部疑似金额构成与对应留存</summary><div class="table-wrap"><table><thead><tr><th>钱包 / 市场</th><th>疑似本金上限 · USDT</th><th>对应钱包已核对留存</th><th>复核状态</th></tr></thead><tbody>${d.breakdown.map(g=>`<tr><td>${addr(g.address)}<small>${g.asset}</small></td><td>${amount(g.uncertainRaw)}</td><td>${g.retention?`${g.retention.needsReview?"后续权益变化，待复核":interval(g.retention.lowerRaw,g.retention.upperRaw,g.retention.decimals)} ${g.retention.asset}${g.retention.includesReturnFrom?"<small>含 TMM 回流，非本组单独留存</small>":""}`:"无个人存款权益"}</td><td>${esc(g.status)}<small>${esc(g.note)}</small></td></tr>`).join("")}</tbody></table></div><p>分组差额合计另扣除共用来源 ${amount(d.overlapAdjustmentRaw)} USDT；不同资产的留存不相加，历史本金上限不等于当前留存。</p></details>
      <details><summary>查看 TAja 关键资金时间线 · ${f.timeline.length} 笔</summary><div class="table-wrap"><table><thead><tr><th>时间 / 说明</th><th>资金方向</th><th>实际交易额</th><th>链上证据</th></tr></thead><tbody>${f.timeline.map(r=>{const [asset,decimals]=tokenInfo(r.contract);return `<tr><td>${esc(time(r.blockTs))}<small>${esc(r.label)}</small></td><td>${addr(r.from)}<br>→ ${addr(r.to)}</td><td>${amount(r.amountRaw,decimals)} ${asset}</td><td>${tx(r.txid)}</td></tr>`;}).join("")}</tbody></table></div><p>TWu 下游检查：${esc(time(f.downstream.since))} 至 ${esc(time(f.downstream.until))}，共 ${f.downstream.rows} 条 USDT 转账，直接回流 TAja / TTb ${f.downstream.directReturnCount} 条。</p></details>
      <details><summary>为什么仍无法缩窄：两种均满足链上收支的分配示例</summary><p>以下是上下界的可行性证明，<strong>不是实际资金归属的判定</strong>。金额单位为 USDT。</p><div class="table-wrap"><table><thead><tr><th>对应交易</th><th>实际金额</th><th>下限情形的 MEXC 部分</th><th>上限情形的 MEXC 部分</th></tr></thead><tbody>${f.cases[0].assignments.map((a,i)=>`<tr><td>${tx(a.txid)}</td><td>${amount(a.totalRaw)}</td><td>${amount(a.mexcRaw)}</td><td>${amount(f.cases[1].assignments[i].mexcRaw)}</td></tr>`).join("")}</tbody></table></div><p>两种分配均通过全部来源、转账容量和节点余额守恒校验，最终分别进入 ${amount(f.cases[0].principalRaw)} 与 ${amount(f.cases[1].principalRaw)} USDT 的本金。</p></details>
      <ul>${f.limitations.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`;
  }
  function renderReview(){
    const r=current.review;
    if(!r){el("mexcReviewNote").textContent=current.reviewError||"尚无金额归因复核，已识别路径不等于确认来源金额。";el("mexcMetrics").innerHTML=["已确认来源本金","疑似关联本金上限","已确认留存权益"].map(x=>`<article class="card"><span class="label">${x}</span><strong>待复核</strong></article>`).join("");el("mexcRetention").innerHTML=empty(4,"留存归因待复核，不按零处理。");el("mexcRetentionTime").textContent="尚无有效复核快照";el("mexcRetentionSummary").innerHTML="";el("mexcUnresolved").innerHTML="";return;}
    const reviewedAssets=["USDT","USDD"].map(asset=>`${r.entries.filter(e=>e.asset===asset).length} 笔 ${asset}`).join(" + ");
    el("mexcReviewNote").innerHTML=`<strong>本次归因复核</strong> · ${esc(time(r.since))} — ${esc(time(r.until))}<br>复核时间 ${esc(time(r.reviewedAt))} · ${r.entries.length} 笔已复核（${reviewedAssets}） · ${r.newPendingCount} 笔新增待复核。以下为该时点结果，刷新采集不会自动改写归因。`;
    if(r.additionalUSDD){const a=r.additionalUSDD;el("mexcReviewNote").innerHTML+=`<br><strong>USDD 回查已完成：</strong>${a.reviewedCount} 笔已复核，其中 ${a.addedCount} 笔为本次新增。新增线索来源本金至少 ${bound(a.addedLowerRaw)} USDT，上限 ${bound(a.addedUpperRaw,6,true)} USDT；对应 jUSDD 留存折合 ${interval(a.retainedLowerRaw,a.retainedUpperRaw,18)} USDD。全部 USDD 线索中 ${a.zeroPrincipalCount} 笔未增加可归因本金。${r.usdtDeepening?"TKs / TM9 / TMM 已补充上游及回流复核；留存按各行时点展示。":`USDT 本金沿用 ${esc(time(r.carriedUSDTReviewAt))} 的复核，留存已重新查询。`}`;}
    const confirmedDD=r.retention.filter(p=>p.asset==="USDD");
    const retained=confirmedDD.reduce((s,p)=>s+BigInt(p.lowerRaw),0n).toString(),needsReview=confirmedDD.some(p=>p.needsReview);
    const cards=[["confirmed",r.version===2?"已确认来源本金 · 至少":"已确认来源本金",r.version===2?bound(r.totals.confirmedPrincipalRaw):rounded(r.totals.confirmedPrincipalRaw),"USDT",`${rounded(r.totals.confirmedRepaymentRaw)} 还款 + ${rounded(r.totals.confirmedConversionPrincipalRaw)} 换币存入；来源本金去重`],
      ["possible","疑似关联本金上限",r.version===2?bound(r.totals.suspectedAdditionalUpperRaw,6,true):rounded(r.totals.suspectedAdditionalUpperRaw),"USDT","可能范围从 0 起；已扣除确认金额，不是已确认流入"],
      ["retained",r.version===2?"已确认留存权益 · 至少":"已确认留存权益",needsReview?"需重新复核":r.version===2?bound(retained,18):rounded(retained,18),"USDD","复核时点仍持有的 jUSDD；USDT 与 USDD 分开计量"]];
    el("mexcMetrics").innerHTML=cards.map(([cls,name,v,u,note])=>`<article class="card ${cls}"><span class="label">${esc(name)}</span><strong>${esc(v)} <small>${u}</small></strong><p>${esc(note)}</p></article>`).join("");
    el("mexcRetentionTime").textContent=`各行时点不同 · 最近 ${time(r.positionsAsOf)}`;
    el("mexcRetentionSummary").innerHTML=["USDT","USDD"].map(asset=>{const ps=r.retention.filter(p=>p.asset===asset),d=asset==="USDD"?18:6,lo=ps.reduce((s,p)=>s+BigInt(p.lowerRaw),0n),hi=ps.reduce((s,p)=>s+BigInt(p.upperRaw),0n);return `<div><span>${asset} · 已核对钱包可归因权益</span><strong>${ps.some(p=>p.needsReview)?"后续权益变化，待复核":interval(String(lo),String(hi),d)}</strong><small>上限含未确认部分；不含公共池后尚未厘清的权益</small></div>`;}).join("");
    el("mexcRetention").innerHTML=r.retention.map(p=>`<tr><td>${addr(p.address)}<small>${p.asset} / j${p.asset}</small></td><td>${p.needsReview?"需重新复核":interval(p.lowerRaw,p.upperRaw,p.decimals)} ${p.asset}<small>${p.status==="confirmed"?"已确认留存":p.status==="closed"?"原钱包本批权益已退出":p.status==="wallet-closed"?"仅原钱包清零，后续回流另列":BigInt(p.lowerRaw)>0n?"下限可确认；上限仍含可能部分":"归因区间 · 未确认留存"}</small></td><td>${rounded(p.wholeRaw,p.decimals)} ${p.asset}</td><td>${esc(p.note)}${p.needsReview?" 后续发现权益转出，原时点值不可作为当前值。":""}<small>余额时点 ${esc(time(p.asOf||r.positionsAsOf))}</small></td></tr>`).join("");
    el("mexcUnresolved").innerHTML=r.unresolved.map(p=>`<p>${addr(p.address)}<br>${esc(p.reason)}${p.sourcePrincipalUpperRaw?` 来源本金上限 ${amount(p.sourcePrincipalUpperRaw)} USDT。`:""}</p>`).join("")+`<p>${esc(r.method)}</p>`+(r.version===2?`<p>全部来源本金联合上限 ${amount(r.totals.principalUpperRaw)} − 已确认下限 ${amount(r.totals.confirmedPrincipalRaw)} = 疑似新增本金上限 ${amount(r.totals.suspectedAdditionalUpperRaw)} USDT。已扣除 USDT / USDD 共用来源上限 ${amount(r.totals.overlapUpperAdjustmentRaw)} USDT；各笔上限不可相加。</p>`:`<p>同币路径总上限 ${amount(r.totals.sameAssetUpperRaw)} − 已确认还款 ${amount(r.totals.confirmedRepaymentRaw)} = 疑似新增本金上限 ${amount(r.totals.suspectedAdditionalUpperRaw)} USDT。</p>`)+`<p>原23笔 ${amount(r.totals.originalGrossRaw)} USDT 是含重复流转的交易额。</p>`;
  }
  function renderEvents() {
    if(!current)return;
    const all=current.events||[],cutoff=(Date.parse(current.until)||Date.now())-Number(el("mexcPeriod").value)*86400000;
    const rows=all.filter(e=>e.blockTs>=cutoff&&(el("mexcKind").value==="all"||e.kind===el("mexcKind").value)&&(el("mexcAsset").value==="all"||(e.asset||"USDT")===el("mexcAsset").value)&&(el("mexcStrength").value==="all"||(e.review?.status||"pending")===el("mexcStrength").value));
    el("mexcCount").textContent=`${rows.length} 条展示 / ${all.length} 条线索`;
    el("mexcEvents").innerHTML=rows.map(e=>{
      const status=e.review?.status||"pending",g=current.review?.groups.find(g=>g.id===e.review?.groupId),asset=e.asset||"USDT",decimals=e.decimals??6;
      const attribution=e.review?.lowerPrincipalRaw!=null?`本笔首次入金来源本金：${amount(e.review.lowerPrincipalRaw)} ～ ${amount(e.review.upperPrincipalRaw)} USDT；下限可确认，上限不是确认值。`:status==="confirmed"?`已确认来源本金：${amount(e.review.confirmedPrincipalRaw)} USDT（首次进入只计一次）。`:g?`该组 ${g.txids.length} 笔交易的去重来源本金区间：${amount(g.lowerRaw,g.principalAsset?6:g.decimals)} ～ ${amount(g.upperRaw,g.principalAsset?6:g.decimals)} ${g.principalAsset||g.asset}。不是本笔可单独累加的金额。`:"来源本金待复核，尚未计入顶部归因金额。";
      return `<details class="mexc-event"><summary><span><span class="pill ${status==="confirmed"?"mexc-confirmed":status==="diverted"?"mexc-review-muted":"amber"}">${esc(levels[status])}</span><strong>${rounded(e.amountRaw,decimals)} <small>${asset}</small></strong><small>${esc(kinds[e.kind]||e.kind)}</small></span><span>${esc(ops[e.operation]||e.operation)}<small>${esc(time(e.blockTs))}</small></span><span class="mexc-event-state">${e.verified?"终点回执已核验":"终点交易待核验"}<small>展开金额依据与路径 ↓</small></span></summary>
      <div class="mexc-evidence"><p class="mexc-principal">${esc(attribution)}</p><p>${esc(e.review?.note||e.note)}</p>
      ${g?.sourceEvidence?`<p>本组 ${g.txids.length} 笔首次入金本金合计 ${amount(g.lowerRaw)} ～ ${amount(g.upperRaw)} USDT；逐笔上限可能共享来源，不能相加。</p><details><summary>本组 MEXC 来源出款证据 · ${g.sourceEvidence.length} 笔</summary>${g.sourceEvidence.map(r=>`<p>${addr(r.from)} → ${addr(r.to)}<br>${amount(r.amountRaw)} USDT · ${esc(time(r.blockTs))} · ${tx(r.txid)}</p>`).join("")}</details>`:""}
      ${(e.evidence||[]).map((r,i)=>{const [symbol,d]=tokenInfo(r.contract);return `<div class="mexc-leg"><b>${i+1}</b><div>${addr(r.from)} <span>→</span> ${addr(r.to)}<small>${amount(r.amountRaw,d)} ${symbol} · ${esc(time(r.blockTs))} · ${tx(r.txid)} · 事件 ${esc(r.eventIndex??"待核")}</small></div></div>`;}).join("")}
      ${e.conversionTxid?`<p>同笔PSM换币证据 ${tx(e.conversionTxid)}；资产兑换不自动把整个钱包持仓归因于MEXC。</p>`:""}</div></details>`;
    }).join("")||`<div class="mexc-empty"><strong>当前筛选下暂无记录</strong><p>仅代表已核对地址与已扫描范围；不能据此判断没有流入。</p></div>`;
  }
  function render() {
    const d=current;if(!d)return;const c=d.coverage||{},s=d.summary,stale=d.runtime?.stale;
    const collector=d.runtime?.collector,enabled=collector?.enabled;
    const publishedMarkets=[d.runtime?.snapshotOrigin==="reviewed-publication"?"USDT":null,d.runtime?.usddSnapshotOrigin==="reviewed-publication"?"USDD":null].filter(Boolean);
    const publicationNote=publishedMarkets.length?`${publishedMarkets.join(" / ")} 显示已发布的复核快照，${enabled?"持续采集已启用，等待该市场首轮更新":"持续采集未启用"}；金额和留存以各自注明时点为准，刷新不会补采链上数据。`:"";
    const phase=collector?.heartbeatStale?"进程心跳过期，请检查服务":({starting:"启动中",running:`正在采集 ${collector?.currentMarket||""}`,waiting:"等待下一轮",paused:"已暂停，自动复查",stopped:"已停止"}[collector?.phase]||"状态待确认");
    el("mexcCollectorStatus").textContent=enabled?`持续采集：${phase}。${collector.pauseReason||"两个市场分进程串行运行，默认每 5 分钟调度；所有地址可能需要多轮补齐。"} 最近心跳 ${time(collector.heartbeatAt)}${collector.nextRunAt?` · 下轮 ${time(collector.nextRunAt)}`:""}。`:"持续采集尚未启用，当前展示已发布的复核快照。";
    const pending=c.status==="pending"||c.status==="sources-pending"||c.status==="sources-changed";
    el("mexcTime").textContent=d.generatedAt?`USDT采集：${time(d.generatedAt)}`:"尚无已完成快照";
    el("mexcNotice").classList.toggle("is-error",Boolean(fetchError));
    el("mexcNotice").textContent=fetchError?`读取失败：${fetchError}。${d.generatedAt?"下方保留上次快照，请勿作为最新状态。":"尚不能判断流入情况。"}`:
      pending?`${c.status==="sources-changed"?"地址清单已变更，等待重扫。":"首次扫描待完成。"}已核对 ${d.sources?.addresses?.length||0} 个地址，覆盖为子集；未命中不代表没有流入。`:
      c.scanComplete?`USDT市场已完成当前地址子集及追踪范围内的30天回查（USDD进度见下方）：${time(d.since)} 至 ${time(d.until)}。地址库非全量；这是固定历史窗口，不代表此刻的实时状态。`:
      `${stale?"快照已过期，请核查独立采集进程。":"已读取链上扫描快照。"} ${c.historyPending||0} 个地址历史回查未完成，${c.receiptPending||0} 笔交易待核验${c.errors?.length?`，${c.errors.length} 个地址读取失败`:""}；地址库为已核对子集。`;
    if(publicationNote)el("mexcNotice").textContent+=` ${publicationNote}`;
    renderReview();
    renderUSDTDeepening();
    renderDeepening();
    renderEvents();
    const p=d.positions||[];el("mexcPositionCount").textContent=`· ${p.length} 个钱包`;
    el("mexcPositionNote").textContent=`${c.pendingMembers||0} 个关联地址类型待核；${c.contractMembers||0} 个合约不计入钱包持仓。仅实时成功查询显示当前值；失败及过期不会显示为零。`;
    el("mexcPositions").innerHTML=p.map(r=>{
      const old=r.asset==="USDD"?d.runtime?.usddStale:stale;const ok=r.status==="ok"&&!old&&!fetchError;
      const label={ok:old||fetchError?"快照过期 / 待更新":"读取成功",pending:"待查询",error:"读取失败",stale:"数据过期"}[r.status]||"待核";
      return `<tr><td>${addr(r.address)}<small>${r.asset||"USDT"} 市场${r.reviewWatch?" · 复核观察地址，非来源标签":""}</small></td><td>${ok?amount(r.jTokenRaw,8):"待核"}</td><td>${ok?amount(r.underlyingRaw,r.decimals??6):"待核"}</td><td>${ok?amount(r.borrowRaw,r.decimals??6):"待核"}</td><td>${esc(label)}<br>${esc(time(r.checkedAt||r.attemptedAt))}${r.error?`<small>${esc(r.error)}</small>`:""}</td></tr>`;
    }).join("")||empty(5,"暂无可展示的关联钱包；不表示持仓为零。");
    function flowRows(rows){return rows.map(r=>`<tr><td>${esc(time(r.blockTs))}</td><td>${addr(r.from)}<br>→ ${addr(r.to)}</td><td>${amount(r.amountRaw,8)} j${r.asset||"USDT"}</td><td>${tx(r.txid)}</td></tr>`).join("")||empty(4,"暂无已识别记录；请结合扫描覆盖查看。");}
    el("mexcRights").innerHTML=flowRows(d.rights||[]);el("mexcRightsCount").textContent=`· ${(d.rights||[]).length} 条`;
    el("mexcObservedRights").innerHTML=flowRows(d.observedRights||[]);el("mexcObservedRightsCount").textContent=`· ${(d.observedRights||[]).length} 条`;
    el("mexcAmbiguous").innerHTML=flowRows(d.ambiguous||[]);el("mexcAmbiguousCount").textContent=`· ${(d.ambiguous||[]).length} 条`;
    el("mexcRedeemCount").textContent=`· ${(d.redemptions||[]).length} 条`;
    el("mexcRedeems").innerHTML=(d.redemptions||[]).map(r=>`<tr><td>${esc(time(r.blockTs))}</td><td>${addr(r.from)}</td><td>${amount(r.amountRaw,8)} j${r.asset||"USDT"}<br>${amount(r.underlyingRaw,r.decimals??6)} ${r.asset||"USDT"}</td><td>${r.kind==="redeem"?"Redeem 已核验":"仅转入市场 · 待核"}<br>${tx(r.txid)}</td></tr>`).join("")||empty(4,"暂无已识别赎回记录。");
    el("mexcSourceNote").textContent=d.sources?.note||"仅含已核对的 TRON 来源地址，不将交易对手自动纳入 MEXC 标签。";
    el("mexcSources").innerHTML=(d.sources?.addresses||[]).map(a=>`<tr><td>${addr(a.address)}</td><td>${esc(a.label)} · ${esc({verified:"已核对",predicted:"推测 / 未启用",removed:"已移除"}[a.status]||a.status)}<br>${/^https:\/\/(intel\.)?arkm\.com\//.test(a.source||"")?`<a href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">标签来源 ↗</a>`:""}</td><td>${esc(a.checkedAt)}</td><td>${a.frozen?.checkedAt && Date.now()-a.frozen.checkedAt>900000?"过期 / 待核":esc({blacklisted:"已冻结",clear:"未冻结",unknown:"未知"}[a.frozen?.status]||"待查询")}<br><small>${esc(time(a.frozen?.checkedAt))}</small></td></tr>`).join("")||empty(4,"等待核对来源地址。");
    el("mexcMarketCoverage").innerHTML=Object.entries(d.marketCoverage||{USDT:c}).map(([asset,m])=>`<div><strong>${asset} / j${asset}</strong><small>${m.continuous?"持续增量采集":m.scanComplete?"固定30天回查已完成":m.status==="pending"?"采集尚未完成":"回查进行中"} · 历史待查 ${m.historyPending??"待查询"} · 回执待核 ${m.receiptPending??"待查询"}</small><small>快照 ${time(m.generatedAt)} · 读取异常 ${(m.errors?.length||0)+(m.receiptErrors?.length||0)}${Object.values(m.limits||{}).some(Boolean)?" · 已触及上限，结果不完整":""}${m.displayTruncated?" · 明细到展示上限":""}</small>${m.continuous?`<small>市场入金已查至 ${time(m.marketThrough)} · 增量待补 ${m.headPending??"待查询"} · 复核观察地址 ${m.watchAccounts||0} 个</small>`:""}</div>`).join("");
    el("mexcCoverage").innerHTML=[["已入队地址",c.totalAccounts],["历史回查待完成",c.historyPending],["增量待追平",c.headPending],["交易证据待查",c.receiptPending],["地址读取失败",c.errors?.length],["追踪边界地址",c.stoppedAddresses]].map(([k,v])=>`<div><strong>${esc(v??"—")}</strong><span>${esc(k)}</span></div>`).join("");
    el("mexcLimitations").innerHTML=(d.limitations||[]).map(x=>`<li>${esc(x)}</li>`).join("")+`<li>${publicationNote?esc(publicationNote):`独立采集器配置周期 ${esc(c.refreshSeconds||300)} 秒；刷新按钮仅读取最新快照。`}交易列表金额为操作交易额；顶部为独立复核结果，不能相加或视作净流入。</li>`+
      (Object.values(c.limits||{}).some(Boolean)?"<li>已触及存储或遍历上限，结果不完整，需扩容或缩小范围后补扫。</li>":"")+(c.displayTruncated?"<li>明细已到展示上限，卡片包含全部已识别结果，列表仅展示部分。</li>":"");
    el("mexcErrors").innerHTML=Object.entries(d.marketCoverage||{USDT:c}).flatMap(([asset,m])=>[...(m.errors||[]),...(m.receiptErrors||[])].map(e=>`<p>${esc(asset)} · ${e.address?addr(e.address):tx(e.txid)} · ${esc(e.error)}</p>`)).join("");
  }
  async function load() {
    if(inflight||!active)return;inflight=true;el("mexcRefresh").disabled=true;
    try {
      const r=await fetch("./api/mexc",{cache:"no-store",signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();
      if(!["MEXC-USDT-jUSDT","MEXC-USDT-jUSDT-USDD-jUSDD"].includes(d.scope) || !Array.isArray(d.events))throw new Error("专项数据格式无效");
      current=d;fetchError="";render();
    }catch(e){fetchError=e.message;if(current)render();else {el("mexcNotice").classList.add("is-error");el("mexcNotice").textContent=`读取失败：${e.message}。暂无可用快照，不能判断流入情况。`;}}
    finally{inflight=false;el("mexcRefresh").disabled=false;}
  }
  el("mexcRefresh").addEventListener("click",load);
  for(const id of ["mexcKind","mexcPeriod","mexcStrength","mexcAsset"])el(id).addEventListener("change",renderEvents);
  document.addEventListener("dashboard:tab",e=>{active=e.detail==="mexc";if(active)load();});
  setInterval(()=>{if(active&&!document.hidden)load();},30000);
})();
