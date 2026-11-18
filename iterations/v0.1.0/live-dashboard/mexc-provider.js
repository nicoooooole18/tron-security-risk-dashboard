"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {address,validAddress,USDT,JUSDT,MARKETS,canonicalReceipt}=require("./mexc-core");
function loadEnv() {
  const file=path.join(__dirname,".env");if(!fs.existsSync(file))return;
  for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)) {
    const m=line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);if(m && process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,"$2");
  }
}
function addressHex(a) {
  if(!validAddress(a))throw new Error("Invalid TRON address");
  const abc="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n=0n;for(const c of a)n=n*58n+BigInt(abc.indexOf(c));
  return n.toString(16).padStart(50,"0").slice(0,42);
}
function createProvider({fetchImpl=fetch,delayMs=350,apiKey=process.env.TRON_PRO_API_KEY||process.env.TRONGRID_API_KEY||""}={}) {
  let next=0;
  async function request(route,body) {
    for(let attempt=0;attempt<3;attempt++) {
      const slot=Math.max(next,Date.now());next=slot+delayMs;
      await new Promise(r=>setTimeout(r,Math.max(0,slot-Date.now())));
      const response=await fetchImpl(`https://api.trongrid.io${route}`,{method:body?"POST":"GET",redirect:"error",
        headers:{"Content-Type":"application/json",...(apiKey?{"TRON-PRO-API-KEY":apiKey}:{})},
        body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
      if([429,502,503,504].includes(response.status) && attempt<2){next=Date.now()+1000*2**attempt;continue;}
      if(!response.ok)throw new Error(`TronGrid HTTP ${response.status}`);
      const result=await response.json();if(result.success===false || result.Error)throw new Error("TronGrid 请求未成功");return result;
    }
  }
  return {
    async solidBlock() {
      const d=await request("/walletsolidity/getnowblock",{}),b=d.block_header?.raw_data;
      if(!Number.isSafeInteger(b?.number)||!Number.isSafeInteger(b?.timestamp))throw new Error("已确认区块信息无效");
      return {number:b.number,timestamp:b.timestamp};
    },
    async balance(a,contract) {
      if(!Object.values(MARKETS).some(m=>m.underlying===contract))throw new Error("Unsupported underlying");
      const d=await request("/walletsolidity/triggerconstantcontract",{owner_address:a,contract_address:contract,function_selector:"balanceOf(address)",parameter:addressHex(a).slice(2).padStart(64,"0"),visible:true});
      if(d.result?.result!==true||!/^[0-9a-f]{64}$/i.test(d.constant_result?.[0]||""))throw new Error("资产余额返回格式错误");
      return BigInt(`0x${d.constant_result[0]}`).toString();
    },
    async page(a,stream) {
      const q=new URLSearchParams({only_confirmed:"true",limit:"200",order_by:"block_timestamp,desc",
        min_timestamp:String(stream.since),max_timestamp:String(stream.until)});
      if(stream.asset)q.set("contract_address",stream.asset);
      if(stream.incoming)q.set("only_to","true");
      if(stream.outgoing)q.set("only_from","true");
      if(stream.cursor)q.set("fingerprint",stream.cursor);
      const d=await request(`/v1/accounts/${a}/transactions/trc20?${q}`);
      if(!Array.isArray(d.data))throw new Error("转账分页响应缺失");
      return {rows:d.data,next:d.meta?.fingerprint||""};
    },
    async type(a) {
      const d=await request("/walletsolidity/getaccount",{address:a,visible:true});
      if(address(d.address)!==a)return "unknown";
      return d.type==="Contract" || d.type===2 ? "contract":"wallet";
    },
    async receipt(txid) {
      const info=await request("/walletsolidity/gettransactioninfobyid",{value:txid});
      const events=[];let cursor="";const seen=new Set();
      for(let page=0;page<5;page++) {
        const q=new URLSearchParams({only_confirmed:"true",limit:"200"});if(cursor)q.set("fingerprint",cursor);
        const d=await request(`/v1/transactions/${txid}/events?${q}`);
        if(!Array.isArray(d.data))throw new Error("交易事件响应缺失");
        events.push(...d.data.map(e=>({...e,event_index:e.event_index==null?null:Number(e.event_index)})));
        const next=d.meta?.fingerprint;
        if(!next)return canonicalReceipt(txid,events,info);
        if(seen.has(next)||!d.data.length)throw new Error("交易事件分页游标异常");
        seen.add(next);cursor=next;
      }
      throw new Error("交易事件分页未完成");
    },
    async position(a,market=MARKETS.USDT) {
      if(!Object.values(MARKETS).some(m=>m.jToken===market.jToken))throw new Error("Unsupported market");
      const d=await request("/walletsolidity/triggerconstantcontract",{owner_address:a,contract_address:market.jToken,
        function_selector:"getAccountSnapshot(address)",parameter:addressHex(a).slice(2).padStart(64,"0"),visible:true});
      const hex=d.constant_result?.[0];
      if(d.result?.result!==true || !/^(?:[0-9a-f]{256}|[0-9a-f]{384})$/i.test(hex||""))throw new Error("持仓返回格式错误");
      const w=hex.match(/.{64}/g).map(s=>BigInt(`0x${s}`));
      if(w[0]!==0n || w[3]<=0n || w.slice(4).some(n=>n!==0n))throw new Error("持仓读取失败");
      return {jTokenRaw:String(w[1]),borrowRaw:String(w[2]),exchangeRateRaw:String(w[3]),underlyingRaw:String(w[1]*w[3]/10n**18n)};
    },
    async frozen(a) {
      const d=await request("/walletsolidity/triggerconstantcontract",{owner_address:a,contract_address:USDT,
        function_selector:"getBlackListStatus(address)",parameter:addressHex(a).slice(2).padStart(64,"0"),visible:true});
      if(d.result?.result!==true || !/^[0-9a-f]{64}$/i.test(d.constant_result?.[0]||""))throw new Error("冻结状态读取失败");
      const n=BigInt(`0x${d.constant_result[0]}`);if(n>1n)throw new Error("冻结状态无效");return n===1n?"blacklisted":"clear";
    }
  };
}
module.exports={loadEnv,createProvider,addressHex};
