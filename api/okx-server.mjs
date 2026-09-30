import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoClient,makeDemoOrder,DemoError} from './okx-demo.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createDemoServer({env=process.env,client=createDemoClient(env),journalPath=path.join(root,'.okx-demo-orders.json'),readFeed=()=>JSON.parse(fs.readFileSync(path.join(root,'data/bacon-intelligence.json'),'utf8'))}={}){
  let ledger=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):[];
  if(!Array.isArray(ledger))throw Error('Invalid order journal');
  const persist=()=>{fs.writeFileSync(journalPath+'.tmp',JSON.stringify(ledger),{mode:0o600});fs.renameSync(journalPath+'.tmp',journalPath);};
  const digest=s=>crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
  const findSetup=pair=>(readFeed().setups||[]).find(s=>s.pair===pair);
  function cap(amount,id){
    if(!Number.isFinite(amount)||amount<=0||amount>client.cfg.cap)throw new DemoError('ORDER_CAP');
    const day=new Date().toISOString().slice(0,10),spent=ledger.filter(x=>x.id!==id&&x.day===day&&['submitting','unknown','accepted'].includes(x.status)).reduce((n,x)=>n+x.amount,0);
    if(spent+amount>client.cfg.daily)throw new DemoError('DAILY_CAP');
  }
  async function build(pair,amount,id){
    cap(Number(amount),id);const setup=findSetup(pair);if(!setup)throw new DemoError('SETUP_UNAVAILABLE');
    const instId=pair.replace('/','-');
    const [instruments,tickers,balances]=await Promise.all([client.request('/api/v5/public/instruments?instType=SPOT&instId='+instId),client.request('/api/v5/market/ticker?instId='+instId),client.balance()]);
    const available=Number(balances?.[0]?.details?.find(x=>x.ccy==='USDT')?.availBal);
    if(!Number.isFinite(available)||available<Number(amount)*1.002)throw new DemoError('INSUFFICIENT_BALANCE');
    return {request:makeDemoOrder(setup,String(amount),instruments?.[0]||{},tickers?.[0]||{}),setupHash:digest(setup)};
  }
  const server=http.createServer(async(req,res)=>{
    const address=server.address(),host=req.headers.host;
    const allowed=new Set(['127.0.0.1:'+address.port,'localhost:'+address.port]);
    const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(!allowed.has(host))return reply(403,{error:'LOCAL_ACCESS_ONLY'});
    const url=new URL(req.url,'http://'+host);
    if(req.method==='POST'&&(req.headers.origin!=='http://'+host||req.headers['content-type']!=='application/json'))return reply(403,{error:'INVALID_ORIGIN'});
    try{
      if(req.method==='GET'&&url.pathname==='/api/okx/status')return reply(200,{demo:true,live:false,configured:client.configured,capUsdt:client.cfg.cap});
      if(req.method==='GET'&&url.pathname==='/api/okx/balance')return reply(200,{demo:true,balances:(await client.balance())?.[0]?.details?.map(x=>({currency:x.ccy,available:x.availBal}))||[]});
      if(req.method==='GET'&&url.pathname==='/api/okx/orders'){
        const rows=[];for(const item of ledger.filter(x=>['accepted','unknown','submitting'].includes(x.status)).slice(-20)){
          try{const data=(await client.order(item.request.instId,item.id))?.[0];if(data){item.status='accepted';item.exchange=data;persist();}}catch{}
          rows.push({id:item.id,pair:item.request.instId,status:item.exchange?.state||item.status,filled:item.exchange?.accFillSz||'0',price:item.exchange?.avgPx||item.request.px});
        }return reply(200,{demo:true,orders:rows});
      }
      if(req.method==='POST'){
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new DemoError('BODY_TOO_LARGE');}const input=JSON.parse(raw);
        if(url.pathname==='/api/okx/preview'){
          const built=await build(String(input.pair),input.amount);
          ledger=ledger.filter(x=>x.status!=='preview'||x.expires>Date.now());
          const item={id:'scl'+crypto.randomBytes(12).toString('hex'),pair:input.pair,amount:Number(input.amount),day:new Date().toISOString().slice(0,10),expires:Date.now()+30000,status:'preview',...built};ledger.push(item);persist();
          return reply(200,{demo:true,id:item.id,expires:item.expires,order:item.request,amount:item.amount});
        }
        const item=ledger.find(x=>x.id===input.id);if(!item)throw new DemoError('ORDER_NOT_FOUND');
        if(url.pathname==='/api/okx/confirm'){
          if(input.confirm!==true)throw new DemoError('CONFIRMATION_REQUIRED');
          if(item.status!=='preview')return reply(200,{demo:true,id:item.id,status:item.status});
          const current=findSetup(item.pair);
          if(item.expires<Date.now()||!current||digest(current)!==item.setupHash)throw new DemoError('PREVIEW_EXPIRED');
          item.status='submitting';persist(); // Reserve before any asynchronous work.
          try{
            cap(item.amount,item.id);const built=await build(item.pair,item.amount,item.id);
            if(JSON.stringify(built.request)!==JSON.stringify(item.request))throw new DemoError('PREVIEW_CHANGED');
            const data=await client.submit({...item.request,clOrdId:item.id});
            if(!data?.[0]||String(data[0].sCode)!=='0'||!data[0].ordId)throw new DemoError('ORDER_REJECTED');
            item.status='accepted';item.ordId=data[0].ordId;persist();return reply(200,{demo:true,id:item.id,status:item.status});
          }catch(error){item.status=error.code==='ORDER_STATUS_UNKNOWN'?'unknown':'rejected';persist();throw error;}
        }
        if(url.pathname==='/api/okx/cancel'){
          if(!['accepted','unknown','submitting'].includes(item.status))throw new DemoError('ORDER_NOT_ACTIVE');
          const result=await client.cancel(item.request.instId,item.id);if(String(result?.[0]?.sCode)!=='0')throw new DemoError('CANCEL_REJECTED');
          return reply(200,{demo:true,status:'Cancellation requested'});
        }
      }
      if(req.method==='GET'){
        const files={'/':'index.html','/data/bacon-intelligence.json':'data/bacon-intelligence.json','/data/bacon-history.json':'data/bacon-history.json'};
        if(files[url.pathname]&&fs.existsSync(path.join(root,files[url.pathname]))){res.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html; charset=utf-8':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(root,files[url.pathname])));}
      }
      reply(404,{error:'NOT_FOUND'});
    }catch(error){reply(400,{error:error instanceof DemoError?error.code:'REQUEST_FAILED'});}
  });return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.SCL_DEMO_PORT||8787);
  createDemoServer().listen(port,'127.0.0.1',()=>console.log('OKX demo desk: http://127.0.0.1:'+port+' · live trading disabled'));
}
