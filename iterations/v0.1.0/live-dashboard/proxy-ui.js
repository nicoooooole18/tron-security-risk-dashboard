/* Independent, read-only polling: no scan or notification dispatch from a page load. */
(() => {
  const el=id=>document.getElementById(id);
  const esc=x=>String(x??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const amt=x=>x==null?"未知":Number(x).toLocaleString("zh-CN",{maximumFractionDigits:6});
  const time=x=>x?new Date(x).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):"—";
  const addr=x=>/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(x||"")?`<a class="xinbi-address" href="https://tronscan.org/#/address/${x}" target="_blank" rel="noopener noreferrer">${x}</a>`:esc(x);
  const tx=x=>/^[a-f0-9]{64}$/i.test(x||"")?`<a href="https://tronscan.org/#/transaction/${x}" target="_blank" rel="noopener noreferrer">${x.slice(0,12)}…</a>`:"未知";
  const raw=x=>/^\d+$/.test(x||"")?`${BigInt(x)/100000000n}.${String(BigInt(x)%100000000n).padStart(8,"0")}`:"未知";
  const units=(value,decimals)=>{
    if(value==null || !Number.isInteger(decimals))return "未知";
    const n=BigInt(value),abs=n<0n?-n:n,digits=String(abs).padStart(decimals+1,"0");
    return `${n<0n?"-":""}${digits.slice(0,decimals?-decimals:undefined)}${decimals?"."+digits.slice(-decimals):""}`;
  };
  function renderTracking(d){
    const v=d.trackingView,c=v?.counts;
    el("proxyTrackingCoverage").textContent=!v?.ready?"地址持仓队列尚未初始化，不能判断资金退出":
      `所选时段关联及后续地址 ${c.addresses} 个；USDT 持仓查询：有效 ${c.queried} / 待查 ${c.pending} / 失败 ${c.failed} / 过期 ${c.stale}。流向待补或过期 ${c.transferPending} 个地址（失败 ${c.transferFailed}）。${v.complete&&d.coverage?.complete&&!d.runtime?.stale&&!d.runtime?.lastError?"已完成当前范围内 USDT／jUSDT 查询。":"覆盖不完整，以下仅为已读取部分，不能判断全部退出。"}${v.hopLimited?"已达追踪跳数上限。":""}${v.addressLimitReached||v.edgeLimitReached?"已达容量上限。":""} ${v.note||""}`;
    el("proxyTrackingTotals").innerHTML=(v?.totals||[]).map(t=>`<div><span>关联地址当前 USDT 存款余额 · ${t.covered}/${t.expected} 地址已读取</span><strong>${t.covered<t.expected?"已读取部分 · ":""}${t.covered?units(t.supplyRaw,t.decimals):"未知"} USDT</strong><p>借款 ${t.covered?units(t.borrowRaw,t.decimals):"未知"} USDT（另列，不从存款余额扣减）</p></div>`).join("");
    const labels={pending:"待查询",error:"查询失败",stale:"余额已过期",ok:"已读取；归因待核"};
    el("proxyTrackingRows").innerHTML=(v?.rows||[]).map(p=>`<tr><td>${addr(p.address)}<br>${esc(p.role)} · ${time(p.since)}<br>${p.upstream?addr(p.upstream)+" → ":""}${tx(p.txid)}</td><td>${p.status==="ok"?raw(p.jTokenRaw):"未知"}</td><td>${p.status==="ok"?units(p.underlyingRaw,p.decimals):"未知"}</td><td>${p.status==="ok"?units(p.borrowRaw,p.decimals):"未知"}</td><td>${time(p.checkedAt)}<br>${esc(labels[p.status])}${p.error?"："+esc(p.error):""}</td></tr>`).join("") || '<tr><td colspan="5">暂无可展示的关联持仓；请结合覆盖状态判断。</td></tr>';
  }
  function render(d) {
    renderTracking(d);
    const s=d.summary||{},r=d.runtime||{},c=d.coverage||{};
    const valid=d.generatedAt&&!r.stale&&!r.lastError&&c.complete;
    const decision=el("proxyDecision");decision.className="decision-banner warning";
    decision.textContent=valid?`所选时段发现 ${s.funderCount} 个出资地址，经 E 存入 ${amt(s.inflowUsdt)} USDT（${s.depositCount} 笔）。请核对来源与后续持仓；共用代理入金不自动定性为新币资金。`
      :`监测${r.lastError?"异常："+r.lastError:r.stale?"数据待更新":!c.windowCovered?"所选范围尚未完整覆盖":"覆盖未完整"}；以下为最近已获取结果，不能据此判断无入金或全部退出。`;
    if(valid&&s.depositCount)decision.className="decision-banner danger";
    el("proxySummary").innerHTML=[["出资地址",s.funderCount],["经 E 存入笔数",s.depositCount],["经 E 入金 USDT",s.inflowUsdt],
      ["H 再存 USDT（不叠加）",s.reentryUsdt],["jUSDT 接收地址",s.receiverCount]].map(([k,v])=>`<div><span>${k}</span><strong>${amt(v)}</strong></div>`).join("");
    el("proxyCoverage").textContent=`入金窗口：${time(d.since)} 至 ${time(d.until)}（北京时间）。数据截至：${time(d.dataThrough)}。最近完成：${time(d.generatedAt)}。扫描${r.running?"进行中":"待下一轮"}；每 5 分钟启动，分页${c.complete?"已覆盖窗口":"未完整/待核"}，持仓读取失败 ${c.balanceErrors??"—"} 个。${d.note||""}${s.unclassifiedHUsdt?` H 另有 ${amt(s.unclassifiedHUsdt)} USDT 入金尚未匹配来源，不计为已识别再存。`:""}`;
    el("proxyDays").innerHTML=(d.days||[]).map(x=>`<tr><td>${esc(x.date)}</td><td>${x.funderCount}</td><td>${x.count}</td><td>${amt(x.amount)}</td></tr>`).join("");
    const roles={E:"E 外部存款代理",H:"H 后续再存合约",I:"I 赎回执行地址"};
    el("proxyPositions").innerHTML=(d.positions||[]).map(p=>`<tr><td>${esc(roles[Object.entries(d.addresses||{}).find(([,a])=>a===p.address)?.[0]])} · ${addr(p.address)}</td><td>${p.status==="ok"?raw(p.jTokenRaw):"未知"}</td><td>${p.status==="ok"?amt(p.underlyingUsdt):"未知"}</td><td>${time(p.checkedAt)}<br>${esc(p.error||"已读取；混同资金")}</td></tr>`).join("");
    el("proxyDeposits").innerHTML=(d.deposits||[]).map(x=>`<tr><td>${time(x.blockTs)}</td><td>${x.funders.map(addr).join("<br>")||"⚠️ 来源待补"} → E → 市场</td><td>${amt(x.amount)}</td><td>${tx(x.txid)}</td><td>${x.evidenceComplete?"同交易 USDT 支付、入池及 jUSDT 到账匹配":"⚠️ 证据待补"}</td></tr>`).join("");
    el("proxyReentries").innerHTML=(d.reentries||[]).map(x=>`<tr><td>${time(x.blockTs)}</td><td>${x.funders.map(addr).join("<br>")} → H → 市场</td><td>${amt(x.amount)}</td><td>${tx(x.txid)}</td></tr>`).join("");
    el("proxyRights").innerHTML=(d.rights||[]).sort((a,b)=>b.blockTs-a.blockTs).map(x=>`<tr><td>${time(x.blockTs)}</td><td>E → ${addr(x.to)}</td><td>${raw(x.raw)}</td><td>${tx(x.txid)}</td></tr>`).join("");
  }
  const DAY=86400000;
  let activeRange=null,requestId=0;
  const localValue=ms=>new Date(ms+8*3600000).toISOString().slice(0,16);
  function resetInputs(){
    const now=Math.floor(Date.now()/60000)*60000;
    el("proxySince").value=localValue(now-7*DAY);
    el("proxyUntil").value=localValue(now);
    el("proxySince").max=el("proxyUntil").max=localValue(now);
  }
  function clearResults(){
    for(const id of ["proxySummary","proxyDays","proxyDeposits","proxyReentries","proxyRights","proxyTrackingTotals","proxyTrackingRows","proxyPositions"])
      el(id).innerHTML="";
    el("proxyCoverage").textContent="";
    el("proxyTrackingCoverage").textContent="等待所选时段持仓数据，不能判断资金退出。";
  }
  async function load(){
    const id=++requestId;
    const query=activeRange?`?since=${encodeURIComponent(activeRange.since)}&until=${encodeURIComponent(activeRange.until)}`:"";
    try{
      const r=await fetch("api/xinbi-proxy"+query,{cache:"no-store",signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      if(id!==requestId)return;
      render(data);
      for(const [key,columns] of [["Days",4],["Deposits",5],["Reentries",4],["Rights",4]]){
        if(!el("proxy"+key).innerHTML)el("proxy"+key).innerHTML=`<tr><td colspan="${columns}">${data.coverage?.complete?"所选时段暂无记录":"所选时段暂无已获取记录，数据覆盖未完整"}</td></tr>`;
      }
    }catch(e){
      if(id!==requestId)return;
      clearResults();
      el("proxyDecision").className="decision-banner warning";
      el("proxyDecision").textContent=`代理监测读取失败：${e.message}。请重试。`;
    }
  }
  el("proxyRangeForm").addEventListener("submit",event=>{
    event.preventDefault();
    const since=Date.parse(el("proxySince").value+":00+08:00"),until=Date.parse(el("proxyUntil").value+":00+08:00");
    if(!Number.isFinite(since)||!Number.isFinite(until)||since>=until||until-since>30*DAY||until>Date.now()){
      el("proxyRangeError").textContent="请选择有效的起止时间，结束时间不能晚于现在，范围最长 30 天。当前结果未变更。";return;
    }
    activeRange={since:new Date(since).toISOString(),until:new Date(until).toISOString()};
    el("proxyRangeError").textContent="";clearResults();
    el("proxyDecision").textContent="正在读取所选时段…";load();
  });
  el("proxyRecent").addEventListener("click",()=>{
    activeRange=null;resetInputs();el("proxyRangeError").textContent="";clearResults();
    el("proxyDecision").textContent="正在读取最近 7 天…";load();
  });
  resetInputs();load();setInterval(load,60000);
})();
