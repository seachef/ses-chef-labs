// NEPTUNE deployment sync 2026-09-29
async function fetchEvidenceCandles(lane,pool,timeframe,aggregate,limit) {
      const wait=Math.max(0,CHAIN_REQUEST_GAP_MS-(Date.now()-chainLastRequestAt));
      if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
      if(document.hidden) throw Error('Evidence check paused while page hidden');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      const candleStarted=Date.now();
      priceCheckActivity('candles:'+lane.api,1); chainLastRequestAt=candleStarted;
      try {
        const url=`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(lane.api)}/pools/${encodeURIComponent(pool.poolAddress)}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=base&include_empty_intervals=false`;
        const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
        if(response.status===429) {const e=Error('Evidence feed rate limited');e.rateLimited=true;throw e;}
        if(!response.ok) throw Error('Candle feed HTTP '+response.status);
        const payload=await response.json();
        if(candleStarted<marketWakeAt)throw Error('Refresh required after reopening');
        return parseClosedCandles(payload,lane,pool,timeframe==='hour'?3600:900);
      } finally {clearTimeout(timer);priceCheckActivity('candles:'+lane.api,-1);}
    }
    async function refreshPoolEvidence(maxPools=3) {
      // Called under the existing shared refresh lock. At most six extra GETs per cycle.
      if(document.hidden) return 0;
      const now=Date.now();
      const queue=CHAIN_LANES.flatMap(lane=>(chainPools[lane.key]||[]).filter(pool=>pool.change24h<=-10 && pool.change24h>-50 && now>=pool.observedAt && now-pool.observedAt<=20*60000).map(pool=>({lane,pool,key:candleEvidenceKey(lane,pool)})))
        .filter(x=>now-(poolCandleAttempts.get(x.key)||0)>=CHAIN_POOL_REFRESH_MS)
        .sort((a,b)=>(poolCandleAttempts.get(a.key)||0)-(poolCandleAttempts.get(b.key)||0)||b.pool.liquidity-a.pool.liquidity).slice(0,Math.min(3,Math.max(0,maxPools)));
      for(const {lane,pool,key} of queue) {
        if(document.hidden) break;
        poolCandleAttempts.set(key,Date.now());
        // Publish short candles first; a failed age-history request must not erase a valid chart.
        // Never carry old bars into a newly stamped evidence object.
        const attemptStarted=Date.now();
        const evidence={hour:[],quarter:[],observedAt:attemptStarted,errors:{}};
        poolCandleEvidence.delete(key);
        for(const [field,timeframe,aggregate,limit] of [['quarter','minute',15,100],['hour','hour',1,1000]]) {
          if(document.hidden)break;
          if(attemptStarted<marketWakeAt){poolCandleEvidence.delete(key);break;}
          try {
            evidence[field]=await fetchEvidenceCandles(lane,pool,timeframe,aggregate,limit);
            if(attemptStarted<marketWakeAt){poolCandleEvidence.delete(key);break;}
            evidence.observedAt=attemptStarted;
            poolCandleEvidence.set(key,evidence);
            if(evidence[field].length)sonarFresh('candles:'+lane.api,['marketSnapshot','scl-buy-setups']);
            refreshCompactCards();
          } catch(error) {
            evidence.errors[field]=String(error.message||'Candle request failed');
            poolCandleEvidence.set(key,evidence);
            if(error.rateLimited)throw error;
          }
        }
        refreshCompactCards();
      }
      // Bound session memory without changing owner history.
      if(poolCandleAttempts.size>500) {const keep=[...poolCandleAttempts].sort((a,b)=>b[1]-a[1]).slice(0,400);poolCandleAttempts.clear();keep.forEach(([k,v])=>poolCandleAttempts.set(k,v));}
      for(const [key,value] of poolCandleEvidence) if(Date.now()-value.observedAt>60*60000) poolCandleEvidence.delete(key);
      buildBuySetups();
      return queue.length;
    }
    function marketTakeaway(row,now=Date.now()) {
      const q=qualificationState(row,now);
      const messages={
        risk:["DOESN'T PASS","A public risk check found a serious restriction. Keep it out of a buy plan."],
        excluded:["OUTSIDE YOUR RULES",q.note],
        inactive:["DOESN'T PASS","Too little two-way trading was observed. Getting out could be difficult."],
        falling:["STILL FALLING","Selling is continuing. A cheaper price alone is not a recovery."],
        drop:["OUTSIDE DUMP OPPS","It is no longer down 10% over 24 hours. A watch pin can keep it here."],
        freshness:["STILL CHECKING","We need a recent price before judging this coin."],
        recovery:["LOOKING PROMISING","The chart has shown recovery. The sell route, costs and remaining risks still need checking."],
        mixed:["STILL CHECKING","The price has not settled into a clear recovery yet."]
      };
      const [title,reason]=messages[q.stage]||["STILL CHECKING","The drop is visible. We still need enough trading history, buyer and seller activity, and recovery evidence."];
      return {title,reason};
    }
    function marketEvidenceMarkup(row,now=Date.now()) {
      const hot=marketTakeaway(row,now);
      return `<div class="check-takeaway"><strong>${escapeHTML(hot.title)}</strong>${escapeHTML(hot.reason)}</div><details class="coin-plan"><summary>Show the evidence</summary>${marketEvidenceDetailsMarkup(row,now)}</details>`;
    }
    function marketEvidenceDetailsMarkup(row,now=Date.now()) {
      const match=evidencePool(row);
      if(!match) return '<div class="trade-note">Reference price only. Exact pool activity and trading age are unverified. This is WATCH, not an approved buy.</div>'+securityMarkup(row);
      const {lane,pool}=match,flow=pool.flow||{};
      const fmt=n=>n===null||n===undefined?'not supplied':Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
      const usd=n=>n===null||n===undefined?'not supplied':'US$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
      const rows=['m15','h1','h24'].map((p,i)=>{const f=flow[p]||{};return `<tr><td>${['15m','1h','24h'][i]}</td><td>${fmt(f.buys)} / ${fmt(f.sells)}</td><td>${fmt(f.buyers)} / ${fmt(f.sellers)}</td><td>${f.dollarShare===null||f.dollarShare===undefined?'not supplied':f.dollarShare.toFixed(1)+'% buy USD'}</td></tr>`;}).join('');
      const e=poolCandleEvidence.get(candleEvidenceKey(lane,pool));
      const fresh=e && now>=e.observedAt && now-e.observedAt<=20*60000;
      const s=fresh?closedCandleSummary(e.hour,e.quarter,now):null;
      const history=s?.sevenDays ? `At least ${Math.floor(s.ageDays)} days of traded history evidenced in this pool; not a launch date.` : 'Seven-day trading history not yet evidenced. A young pool does not prove a young token.';
      const recovery=!s?'Closed candles waiting for the bounded research queue.':!s.ready?'Recent closed 15m/1h candles incomplete.':s.recovery?'Closed candles meet the simple higher-low recovery screen; not a buy approval.':'Closed candles have not met the higher-low recovery screen.';
      const current=Number.isFinite(pool.observedAt)&&now>=pool.observedAt&&now-pool.observedAt<=20*60000;
      return `<div class="trade-note">${current?'Public pool snapshot':'Older snapshot - refresh needed'}: ${escapeHTML(new Date(pool.observedAt).toISOString())}. Exact base-token side; provider-reported addresses are not people.</div><div class="research" style="overflow-x:auto"><table><thead><tr><th>Period</th><th>Buy / sell trades</th><th>Buying / selling addresses</th><th>Dollar pressure</th></tr></thead><tbody>${rows}</tbody></table></div><div class="trade-note">Reported pool reserves ${usd(pool.liquidity)}; 24h turnover ${usd(pool.volume)}. Neither proves your sell price. Missing dollar splits are never calculated from trade counts.</div><div class="trade-note">${history} ${recovery}${s?.hourVolumeRatio!==null&&s?.hourVolumeRatio!==undefined?' Last closed-hour volume: '+s.hourVolumeRatio.toFixed(2)+'x the prior 24 closed-hour average.':''}</div>${securityMarkup(row)}<div class="trade-note">Use CHECK MY COSTS in your plan for current two-way route comparisons. Total wallet-specific costs, liquidity ownership/locks and unlock schedules remain unverified. No 100% qualification or automatic buy. Feed coverage is partial; no wash-trading diagnosis.</div>`;
    }
    function normalisePoolToken(pool, includedById, lane) {
      const attributes = pool?.attributes || {};
      const baseId = pool?.relationships?.base_token?.data?.id;
      const quoteId = pool?.relationships?.quote_token?.data?.id;
      const base = includedById.get(baseId)?.attributes || {};
      const quote = includedById.get(quoteId)?.attributes || {};
      const selected = base && !STABLE_SYMBOLS.has(String(base.symbol || '').toUpperCase())
        ? {token:base, price:Number(attributes.base_token_price_usd)}
        : null;
      const liquidity = Number(attributes.reserve_in_usd);
      const volume = Number(attributes.volume_usd?.h24);
      const rawChange = attributes.price_change_percentage?.h24;
      const change24h = rawChange === null || rawChange === undefined || rawChange === '' ? NaN : Number(rawChange);
      const address = String(attributes.address || '').trim();
      if (!selected || !validPoolAddress(lane,address) || !Number.isFinite(selected.price) || selected.price <= 0 || !Number.isFinite(liquidity) || liquidity < CHAIN_POOL_MIN_LIQUIDITY_USD || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(change24h)) return null;
      const symbol = String(selected.token.symbol || '').toUpperCase().trim();
      const tokenAddress = String(selected.token.address || '').trim();
      if (!/^[A-Z0-9._-]{1,15}$/.test(symbol) || STABLE_SYMBOLS.has(symbol)) return null;
      if (!validTokenAddress(lane,tokenAddress)) return null;
      const dexId = String(pool?.relationships?.dex?.data?.id || '');
      const venue = /^[a-zA-Z0-9_-]{1,80}$/.test(dexId) ? dexId.replace(/-/g,' ').toUpperCase() : 'Pool venue unconfirmed';
      const quoteAddress=String(quote.address || '').trim();
      if(!validTokenAddress(lane,quoteAddress)) return null;
      return {symbol, tokenAddress, quoteAddress, poolAddress:address, observedAt:Date.now(), flow:normalisePoolFlow(attributes), identity:`${lane.api}:${lane.api === 'solana' ? tokenAddress : tokenAddress.toLowerCase()}`, venue, price:selected.price, change24h, liquidity, volume, chart:`https://www.geckoterminal.com/${lane.api}/pools/${address}?locale=en`};
    }
    async function fetchChainPage(lane, page) {
      if (!Number.isInteger(page) || page < 1 || page > CHAIN_PUBLIC_PAGES) throw new Error('Page outside public coverage');
      const waitMs = Math.max(0, CHAIN_REQUEST_GAP_MS - (Date.now() - chainLastRequestAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve,waitMs));
      if (document.hidden) { const error=new Error('Page paused'); error.paused=true; throw error; }
      const pageStarted=Date.now();
      priceCheckActivity(lane.api,1);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(),15000);
      try {
      const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(lane.api)}/pools?page=${page}&include=base_token,quote_token`;
      chainLastRequestAt = Date.now();
      const response = await fetch(url, {cache:'no-store', credentials:'omit', redirect:'error', headers:{Accept:'application/json'}, signal:controller.signal});
      if (!response.ok) {
        const error = new Error(`${lane.name} pool feed HTTP ${response.status}`);
        error.status=response.status; error.rateLimited=response.status===429;
        const retry=response.headers?.get('Retry-After');
        error.retryMs=/^\d+$/.test(retry||'') ? Number(retry)*1000 : Math.max(0,Date.parse(retry||'')-Date.now());
        throw error;
      }
      const payload = await response.json();
      if(pageStarted<marketWakeAt){const e=Error('Refresh after reopening');e.paused=true;throw e;}
      if (!Array.isArray(payload?.data) || payload.data.length>CHAIN_PAGE_SIZE || (payload.data.length && !Array.isArray(payload?.included))) throw new Error(`${lane.name} pool feed invalid`);
      const includedById = new Map((payload.included||[]).filter(item=>item&&typeof item.id==='string').map(item => [item.id,item]));
      return {rows:payload.data.map(pool => normalisePoolToken(pool,includedById,lane)).filter(Boolean),rawCount:payload.data.length};
      } finally { clearTimeout(timeout); priceCheckActivity(lane.api,-1); }
    }
    function freshChainPool(pool,now=Date.now()) {
      return Boolean(pool && Number.isFinite(pool.observedAt) && pool.observedAt>0 && now>=pool.observedAt && now-pool.observedAt<=20*60000);
    }
    function discoveryState(lane) {
      if(!chainDiscovery.has(lane.key)) chainDiscovery.set(lane.key,{pages:new Map(),nextPage:1,checked:new Set(),startedAt:0,nextAt:0,status:'WAITING',lastCheckedAt:0});
      return chainDiscovery.get(lane.key);
    }
    function acceptDiscoveryPage(lane,page,result,now=Date.now()) {
      const state=discoveryState(lane);
      if(page===1) {state.checked.clear();state.startedAt=now;}
      state.pages.set(page,result);state.checked.add(page);state.lastCheckedAt=now;
      const ended=result.rawCount<CHAIN_PAGE_SIZE;
      const capped=page===CHAIN_PUBLIC_PAGES;
      if(ended||capped) {
        for(const cachedPage of state.pages.keys()) if(cachedPage>page)state.pages.delete(cachedPage);
        state.nextPage=1;state.nextAt=Math.max(now+60000,state.startedAt+CHAIN_POOL_REFRESH_MS);
        state.status=ended?'END OF AVAILABLE PAGES':'PUBLIC PAGE LIMIT';
      } else {state.nextPage=page+1;state.nextAt=0;state.status='SCANNING';}
      commitChainPools(lane,[...state.pages.values()].flatMap(result=>result.rows));
      if(result.rows.some(p=>freshChainPool(p))) sonarFresh(lane.api,['marketSnapshot','scl-buy-setups']);
    }
    function commitChainPools(lane, pages) {
      const unique = [];
      const seen = new Set();
      // Prefer the newly read exact identity; never relabel an older page as fresh.
      pages.slice().sort((a,b) => b.observedAt-a.observedAt || b.liquidity-a.liquidity || b.volume-a.volume).forEach(pool => {
        if (!seen.has(pool.identity)) { seen.add(pool.identity); unique.push(pool); }
      });
      unique.sort((a,b)=>b.liquidity-a.liquidity||b.volume-a.volume);
      chainPools[lane.key] = unique;
      chainPoolsUpdatedAt[lane.key] = Date.now();
      unique.forEach(pool => {
        const recordedAt=pool.observedAt;
        recordGaugeSample(pool.identity,pool.price,recordedAt);
        recordDeskSample(pool.identity,pool.price,recordedAt);
        const samples = Array.isArray(priceSamples[pool.identity]) ? priceSamples[pool.identity] : [];
        if(!samples.length || recordedAt>samples[samples.length-1].recordedAt) samples.push({price:pool.price,recordedAt});
        priceSamples[pool.identity] = samples.slice(-3);
      });
      
      buildBuySetups();
    }
    async function refreshChainPools() {
      if (chainRefreshInFlight || document.hidden) return;
      clearTimeout(chainRetryTimer);
      if(Date.now()<chainDiscoveryBackoffUntil) {chainRetryTimer=setTimeout(refreshChainPools,Math.min(2147483647,chainDiscoveryBackoffUntil-Date.now()));return;}
      chainRefreshInFlight = true;
      let candleBudget=Date.now()>=chainEvidenceDueAt?3:0;
      if(candleBudget)chainEvidenceDueAt=Date.now()+CHAIN_POOL_REFRESH_MS;
      async function checkOneChart() {
        if(!candleBudget||document.hidden||Date.now()<chainDiscoveryBackoffUntil)return;
        try {candleBudget-=await refreshPoolEvidence(1);}
        catch(error){if(error.rateLimited){chainDiscoveryBackoffUntil=Date.now()+60000;candleBudget=0;}}
      }
      try {
        // A known pool gets its chart before another full eight-chain sweep.
        await checkOneChart();
        // One round per batch, then yield. Each chain retains its own page cursor.
        for(let visit=0;visit<CHAIN_LANES.length&&!document.hidden&&Date.now()>=chainDiscoveryBackoffUntil;visit++) {
          const lane=CHAIN_LANES[chainDiscoveryCursor++ % CHAIN_LANES.length];
          const state=discoveryState(lane);
          if(Date.now()<state.nextAt)continue;
          const page=state.nextPage;
            try {
              acceptDiscoveryPage(lane,page,await fetchChainPage(lane,page));
              await checkOneChart();
            } catch (error) {
              console.warn(error.message);
              if(error.paused)break;
              state.status=error.rateLimited?'FEED COOLING DOWN':error.status===404?'PUBLIC MARKET FEED UNAVAILABLE':error.status===401||error.status===403?'PUBLIC ACCESS UNAVAILABLE':'FEED RETRY PENDING';
              state.nextAt=Date.now()+(error.rateLimited?60000:300000);
              
              if(error.rateLimited) {chainDiscoveryBackoffUntil=Date.now()+Math.max(60000,Number.isFinite(error.retryMs)?error.retryMs:0);break;}
            }
        }
      } finally {
        chainRefreshInFlight = false;
        const soonest=Math.min(...CHAIN_LANES.map(lane=>discoveryState(lane).nextAt));
        const delay=Math.max(1000,chainDiscoveryBackoffUntil-Date.now(),soonest-Date.now());
        if(!document.hidden) chainRetryTimer=setTimeout(refreshChainPools,Math.min(2147483647,delay));
      }
    }
    function liveChangeForCoin(cg) {
      const baseline = sessionBaseline[cg];
      const current = price(cg)?.current_price;
      if (baseline === undefined || baseline === null || baseline === 0 || current === undefined || current === null || !Number.isFinite(Number(baseline)) || !Number.isFinite(Number(current))) return 0;
      return ((Number(current) - Number(baseline)) / Number(baseline)) * 100;
    }

    function resetLiveSession() {
      sessionBaseline = {};
      [...deep, ...dumpCoins].forEach(item => {
        const current = price(item.cg)?.current_price;
        if (current !== undefined && current !== null && Number.isFinite(Number(current))) {
          sessionBaseline[item.cg] = Number(current);
        }
      });
      render();
      
      buildBuySetups();
    }

    function sliderPercentLabel(v) { return v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}%`; }
    
    function card(a) {
      const m = price(a.cg), p = m?.current_price || 0;
      const change = liveChangeForCoin(a.cg);
      const signal = signalForChange(change);
      const sliderValue = 0;
      return `
        <article class="card">
          <div class="card-head">
            <div class="name">${a.s} - ${a.n}</div>
            <span class="chain">${a.c}</span>
          </div>
          <div class="price-row">
            <div class="label" style="display:block; margin:0;">
              <span class="muted">LIVE PRICE</span>
              <div class="price" id="p-${a.id}">${money(p)}</div>
            </div>
          </div>
          <div class="label">
            <span>Session</span>
            <span class="status ${signal}" id="ch-${a.id}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>
          </div>
          <div class="info">
            <strong>Address:</strong> ${shortAddressMarkup(a.a)}<br>
            <strong>Dex:</strong> <a href="${a.dex}" target="_blank" rel="noopener noreferrer">Open DEX</a>
          </div>
          <div class="slider-wrap">
            <div class="label"><span>LIMIT RANGE</span><b id="lim-${a.id}">${sliderPercentLabel(sliderValue)}</b></div>
            <input class="slider" id="slider-${a.id}" type="range" min="-25" max="25" value="0" step="1" oninput="slide('${a.id}', this.value)" onchange="slide('${a.id}', this.value)">
            <div class="slider-labels">
              <span>-25</span><span>-20</span><span>-15</span><span>-10</span><span>-5</span><span>0</span><span>+5</span><span>+10</span><span>+15</span><span>+20</span><span>+25</span>
            </div>
          </div>
          <div class="buttons">
            <button class="btn" onclick="place('${a.id}')">Place Limit</button>
          </div>
          <div class="status ${signal}" id="msg-${a.id}">${textForSignal(change)}</div>
        </article>
      `;
    }

    function slide(id, v) {
      const current = Number(price(coin(id).cg)?.current_price);
      if (!Number.isFinite(current)) return;
      const pct = Number(v) || 0;
      const priceTarget = current * (1 + (pct / 100));
      $(`lim-${id}`).textContent = sliderPercentLabel(pct);
      $(`msg-${id}`).textContent = `${pct >= 0 ? 'Up' : 'Down'} ${Math.abs(pct).toFixed(0)}% target ${money(priceTarget)}`;
      $(`msg-${id}`).className = `status ${signalForChange(pct)}`;
    }

    function place(id) {
      const a = coin(id), slider = $(`slider-${id}`), m = price(a.cg);
      if (!a || !slider || !m) return alert('Price unavailable right now.');
      const observedAt = new Date(m.last_updated).getTime();
      if (!Number.isFinite(observedAt) || Date.now() - observedAt > 120000) {
        return alert('Price is stale. Refresh before preparing a limit order.');
      }
      const pct = Number(slider.value) || 0;
      if (pct > 0) return alert('For a limit buy, move the slider to 0% or below. Never chase above the live price.');
      const targetPrice = Number(m.current_price) * (1 + (pct / 100));
      const amount = Number(prompt('How many USDC do you want to use?', '10'));
      if (!Number.isFinite(amount) || amount <= 0) return alert('No valid amount entered. Nothing was prepared.');
      const expiryMinutes = Number(prompt('Cancel the draft after how many minutes? Choose 5, 10 or 15.', '10'));
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) return alert('Limit price is invalid.');
      if (![5, 10, 15].includes(expiryMinutes)) return alert('Choose a valid order expiry.');
      const createdAt = Date.now();
      const order = {
        id: a.id,
        sym: a.s,
        amount,
        limit: targetPrice,
        sourcePrice: Number(m.current_price),
        quantityEstimate: amount / targetPrice,
        createdAt,
        expiresAt: createdAt + expiryMinutes * 60000,
        status: 'DRAFT - CONFIRM AT VENUE',
        chain: a.c
      };
      orders.push(order); save(); render();
      const summary = `${a.s} limit-buy draft\nAmount: ${amount.toFixed(2)} USDC\nMaximum price: ${targetPrice}\nExpires: ${expiryMinutes} minutes\nConfirm spread, fees and the final order at the venue.`;
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(summary).catch(() => {});
      window.open(a.dex || 'https://jup.ag', '_blank', 'noopener,noreferrer');
    }

    function cancel(i) { orders.splice(i, 1); save(); render(); }
    
    function orderCard(o, i) {
      const a = coin(o.id);
      if (!a) return `<article class="order"><div class="order-head"><b>UNRECOGNIZED SAVED DRAFT</b></div><p class="muted">This older saved item is preserved but cannot be opened because its verified market identity is unavailable.</p><div class="buttons"><button class="btn danger" onclick="cancel(${i})">Remove draft</button></div></article>`;
      const expired = Number.isFinite(Number(o.expiresAt)) && Date.now() >= Number(o.expiresAt);
      const status = expired ? 'Expired - do not chase' : (o.status || 'Draft');
      return `
        <article class="order">
          <div class="order-head"><b>${o.sym} - ${a.n}</b><span class="chain">${a.c}</span></div>
          <p><span class="muted">Limit:</span> <b>${money(o.limit)}</b><br><span class="muted">Amount:</span> ${o.amount} USDC<br><span class="muted">Status:</span> ${status}</p>
          <div class="buttons">
            <button class="btn" onclick="window.open('${a.dex}', '_blank', 'noopener,noreferrer')">Open DEX</button>
            <button class="btn danger" onclick="cancel(${i})">Cancel</button>
          </div>
        </article>
      `;
    }

    function render() {
      // Legacy limit-order tray removed. Current desk renders through Dump opps.
    }

    function renderPool() {
      const hidden = deep.filter(a => !active.includes(a.id));
      $('poolGrid').innerHTML = hidden.map(a => `<div class="card"><div class="name">${a.s}</div><div class="muted">${a.n}</div><div class="info">${a.c}</div><div class="buttons"><button class="btn" onclick="active.push('${a.id}'); save(); render();">Bring in</button></div></div>`).join('') || '<div class="empty">All pairs are visible in the tray.</div>';
    }

    function togglePool() { $('pool').hidden = !$('pool').hidden; }
    function refillTray() { active = deep.slice(0, 8).map(x => x.id); save(); render(); }
    
    function updatePrices() {
      active.forEach(id => {
        const a = coin(id), m = price(a.cg);
        if (!m) return;
        const change = liveChangeForCoin(a.cg), signal = signalForChange(change);
        $(`p-${id}`).textContent = money(Number(m.current_price));
        $(`ch-${id}`).textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
        $(`ch-${id}`).className = `status ${signal}`;
        $(`msg-${id}`).textContent = textForSignal(change);
        $(`msg-${id}`).className = `status ${signal}`;
      });
    }

    // Scenario inputs are private to this tab and never submit or authorize an order.
    const gaugeSamples = new Map();
    function recordGaugeSample(key, priceValue, observedAt, now = Date.now()) {
      if (typeof key !== 'string' || !Number.isFinite(priceValue) || priceValue <= 0 || !Number.isFinite(observedAt) || observedAt > now) return;
      const samples = gaugeSamples.get(key) || [];
      const last = samples[samples.length-1];
      // Repeated provider observations and closely repeated pool-page reads
      // are not independent evidence of a recovery.
      if (last && observedAt-last.at < 30000) return;
      gaugeSamples.set(key,[...samples,{price:priceValue,at:observedAt}].slice(-3));
    }
    function sampleQualificationState(row, now = Date.now()) {
      const checking = {label:'CHECKING',tone:'checking',angle:0,note:'Fresh price evidence needed',stage:'freshness',sampleCount:0};
      if (!row || !rowRefreshedSinceWake(row)) return checking;
      let current, change, observedAt, maxAge;
      if (row.kind === 'named') {
        const m = price(row.key);
        if (!freshMarketItem(m,now)) return checking;
        current = Number(m.current_price); change = finiteChange(m.price_change_percentage_24h);
        observedAt = new Date(m.last_updated).getTime(); maxAge = 120000;
      } else if (row.kind === 'chain') {
        const lane = CHAIN_LANES.find(l => (chainPools[l.key] || []).some(p => p.identity === row.key));
        if (!lane) return checking;
        const pool = chainPools[lane.key].find(p => p.identity === row.key);
        observedAt = pool.observedAt; maxAge = 20*60*1000;
        if (!Number.isFinite(observedAt) || now < observedAt || now-observedAt > maxAge) return checking;
        current = pool.price; change = finiteChange(pool.change24h);
      } else return checking;
      if (!Number.isFinite(current) || current <= 0 || change === null || change <= -100) return checking;
      if (change > -10) return {label:'WAIT',tone:'wait',angle:0,note:'Outside the 10% drop rule',stage:'drop',sampleCount:0};
      const samples = gaugeSamples.get(row.key) || [];
      const valid = samples.length === 3 && samples.every((s,i) => Number.isFinite(s.price) && s.price > 0 && s.at <= now && now-s.at <= maxAge*3 && (!i || s.at-samples[i-1].at >= 30000)) && samples[2].at === observedAt && samples[2].price === current;
      const recentSamples = samples.filter((s,i) => Number.isFinite(s.price) && s.price > 0 && s.at <= now && now-s.at <= maxAge*3 && (!i || s.at-samples[i-1].at >= 30000));
      const lastSample = recentSamples[recentSamples.length-1];
      const sampleCount = lastSample?.at === observedAt && lastSample?.price === current ? recentSamples.length : 0;
      if (!valid) return {label:'WAIT',tone:'wait',angle:20,note:'10% drop seen  |  watching the next moves',stage:'samples',sampleCount};
      const [a,b,c] = samples;
      if (c.price < b.price) return {label:'WAIT',tone:'wait',angle:10,note:'Latest sampled price is falling',stage:'falling',sampleCount:3};
      if (c.price > b.price && b.price > a.price) return {label:'WATCH',tone:'watch',angle:90,note:'Two rising samples  |  more checks needed',stage:'rising',sampleCount:3};
      if (c.price === b.price && b.price === a.price) return {label:'WATCH',tone:'watch',angle:75,note:'Samples are level  |  recovery unconfirmed',stage:'level',sampleCount:3};
      return {label:'WAIT',tone:'wait',angle:35,note:'Mixed moves  |  waiting for stability',stage:'mixed',sampleCount:3};
      // These in-tab samples are not closed candles. The evidence wrapper below
      // adds candle checks; executable exit and security still cannot pass here.
    }
    // Owner exclusion policy. A watch pin preserves visibility, never eligibility.
    function dumpExclusionReason(row,now=Date.now()) {
      const change=planNumber(row?.change);
      if(change===null) return 'Current 24-hour change is missing.';
      if(change<=-50) return 'Extreme drop â down 50% or more in 24 hours.';
      const match=evidencePool(row);
      if(!match) return 'Seven days of trading history not yet verified.';
      const e=poolCandleEvidence.get(candleEvidenceKey(match.lane,match.pool));
      if(!e||!Number.isFinite(e.observedAt)||e.observedAt<marketWakeAt||now<e.observedAt||now-e.observedAt>20*60000||!Array.isArray(e.hour)||!Array.isArray(e.quarter)) return 'Seven days of trading history not yet verified.';
      const summary=closedCandleSummary(e.hour,e.quarter,now);
      if(!summary.sevenDays) return 'Seven days of trading history not yet verified.';
      return null;
    }
    function qualificationState(row,now=Date.now()) {
      const sampled=sampleQualificationState(row,now);
      const security=currentSecurity(row,now);
      if(security?.critical)return {...sampled,label:'AVOID',tone:'wait',stage:'risk',note:security.flags.find(f=>f.critical).label+' | public provider finding, not a scam verdict'};
      if(!rowRefreshedSinceWake(row)) return {...sampled,label:'WAIT',tone:'checking',stage:'freshness',note:'Fresh data needed after reopening',angle:0};
      const exclusion=dumpExclusionReason(row,now);
      if(exclusion) return {...sampled,label:'EXCLUDED',tone:'wait',stage:'excluded',note:exclusion,angle:0};
      if(['freshness','drop'].includes(sampled.stage)) return sampled;
      const watch=(stage,note)=>({...sampled,label:'WATCH',tone:'watch',stage,note,angle:35});
      const match=evidencePool(row);
      if(!match) return watch('evidence','Price screen only | pool, exit and security checks needed');
      const {lane,pool}=match;
      if(!Number.isFinite(pool.observedAt)||now<pool.observedAt||now-pool.observedAt>20*60000) return {...sampled,label:'CHECKING',tone:'checking',stage:'freshness',note:'Current pool evidence needed'};
      const f=pool.flow?.h1;
      if(f?.buys===0||f?.sells===0) return watch('inactive','No two-way trading observed in the last hour');
      if(!f||f.buys===null||f.sells===null||f.buyers===null||f.sellers===null) return watch('evidence','Buyer and seller evidence incomplete');
      const e=poolCandleEvidence.get(candleEvidenceKey(lane,pool));
      if(!e||now<e.observedAt||now-e.observedAt>20*60000) return watch('evidence','Activity seen | checking trading history and closed candles');
      const summary=closedCandleSummary(e.hour,e.quarter,now);
      if(!summary.sevenDays) return watch('evidence','Seven days of traded history not yet evidenced');
      if(!summary.ready) return watch('evidence','Recent closed 15m and 1h candles needed');
      if(sampled.stage==='falling') return watch('falling','Latest sampled price is falling | recovery needs rechecking');
      if(!summary.recovery) return watch('mixed','Activity seen | waiting for closed-candle recovery');
      return watch('recovery','Recovery screen met | exit and security still unverified');
    }
    function refreshQualificationGauges() {
      refreshCompactCards();
      document.querySelectorAll('[data-trade-plan]').forEach(planBox => {
        const row=visibleTradeRows.get(planBox.dataset.tradePlan);
        if (row) syncResultBuy(planBox,row,getTradePlan(row.key,row.price));
      });
    }
    const LAST_DESK_ROWS_KEY='seaChefLastDeskRowsV1', TRADE_PLANS_KEY='seaChefTradePlansV1', LAST_VIEW_KEY='seaChefLastViewV1';
    function validLastDeskRow(row) {
      if(!row||!['named','chain'].includes(row.kind)||typeof row.key!=='string'||row.key.length<1||row.key.length>180) return null;
      const symbol=String(row.symbol||'').toUpperCase(),chain=String(row.chain||''),contract=String(row.contract||''),venue=String(row.venue||'');
      const price=Number(row.price),change=Number(row.change),rating=Number(row.rating);
      if(!/^[A-Z0-9._-]{1,20}$/.test(symbol)||chain.length>40||contract.length>180||venue.length>120||!Number.isFinite(price)||price<=0||!Number.isFinite(change)||change<=-100||change>1000) return null;
      const clean={kind:row.kind,key:row.key,symbol,chain,contract,venue,price,change,state:String(row.state||'checking').slice(0,30),rating:Number.isFinite(rating)?Math.max(0,Math.min(100,rating)):0,lastOpen:true};
      if(row.kind==='chain'&&typeof row.chart==='string'&&/^https:\/\/www\.geckoterminal\.com\/[a-z0-9_-]+\/pools\/[a-zA-Z0-9_-]+\?locale=en$/.test(row.chart)) clean.chart=row.chart;
      return clean;
    }
    function readLastDeskRows() {
      try {
        const saved=JSON.parse(localStorage.getItem(LAST_DESK_ROWS_KEY)||'null');
        if(!saved||saved.version!==1||!Number.isFinite(saved.savedAt)||saved.savedAt>Date.now()||Date.now()-saved.savedAt>7*86400000||!Array.isArray(saved.rows)) return new Map();
        return new Map(saved.rows.map(validLastDeskRow).filter(Boolean).slice(0,100).map(row=>[row.key,row]));
      } catch(_) { return new Map(); }
    }
    function persistLastDeskRows(rows) {
      try { localStorage.setItem(LAST_DESK_ROWS_KEY,JSON.stringify({version:1,savedAt:Date.now(),rows:[...rows].slice(0,100)})); } catch(_) {}
    }
    function readTradePlans() {
      try {
        const saved=JSON.parse(localStorage.getItem(TRADE_PLANS_KEY)||'[]');
        if(!Array.isArray(saved)) return new Map();
        return new Map(saved.filter(item=>Array.isArray(item)&&typeof item[0]==='string'&&item[0].length<=180&&item[1]&&typeof item[1]==='object').slice(0,100));
      } catch(_) { return new Map(); }
    }
    function persistTradePlans() {
      try { localStorage.setItem(TRADE_PLANS_KEY,JSON.stringify([...tradePlans].slice(-100))); } catch(_) {}
    }
    let lastDeskRows=readLastDeskRows();
    const tradePlans = readTradePlans();
    const loadedCardCharts = new Set();
    let visibleTradeRows = new Map();
    function planNumber(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      if (typeof value === 'string' && !value.trim()) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    function tradeMath(priceUSD, plan) {
      const budget = planNumber(plan.budget), position = planNumber(plan.entryPosition), multiple = planNumber(plan.multiple);
      const anchor = planNumber(plan.anchor);
      if (budget === null || budget < 0 || budget > 1000 || budget % 50 !== 0) return {status:'Choose A$0-A$1,000 in A$50 steps'};
      if (!Number.isFinite(anchor) || anchor <= 0 || position === null || position < 50 || position > 100) return {status:'Entry price unavailable'};
      if (multiple === null || !Number.isInteger(multiple) || multiple < 1 || multiple > 100) return {status:'Choose 1x-100x'};
      const entry = anchor * position / 100, exit = entry * multiple;
      if (!Number.isFinite(entry) || !Number.isFinite(exit)) return {status:'Price exceeds supported range'};
      const result = {status:'Costs need a quote',budget,entry,exit,multiple,grossReturn:budget*multiple,grossProfit:budget*(multiple-1)};
      if (budget === 0) return {...result,status:'No allocation'};
      const feeIn = planNumber(plan.feeIn), feeOut = planNumber(plan.feeOut);
      const slipIn = planNumber(plan.slipIn), slipOut = planNumber(plan.slipOut);
      const gasIn = planNumber(plan.gasIn), gasOut = planNumber(plan.gasOut);
      if ([feeIn,feeOut,slipIn,slipOut,gasIn,gasOut].some(n => n === null)) return result;
      if ([feeIn,feeOut,slipIn,slipOut].some(n => n < 0 || n >= 100) || gasIn < 0 || gasOut < 0) return {...result,status:'Check the cost assumptions'};
      if (gasIn >= budget) return {...result,status:'Entry network cost uses the budget'};
      // AUD scenario at constant USD/AUD conversion. Fees are percentages of
      // each leg's value; execution allowances model adverse impact/slippage.
      const capital = (budget-gasIn)/((1+feeIn/100)*(1+slipIn/100));
      const buySlip = capital*slipIn/100;
      const buyFee = (capital+buySlip)*feeIn/100;
      const exitValue = capital*multiple;
      const sellSlip = exitValue*slipOut/100;
      const sellFee = (exitValue-sellSlip)*feeOut/100;
      const exitProceeds = exitValue-sellSlip-sellFee-gasOut;
      const entryCosts = buySlip+buyFee+gasIn, exitCosts = sellSlip+sellFee+gasOut;
      return {...result,status:'Manual cost scenario',capital,entryCosts,exitCosts,fees:buyFee+sellFee,
        execution:buySlip+sellSlip,network:gasIn+gasOut,totalCosts:entryCosts+exitCosts,
        netReturn:exitProceeds,netProfit:exitProceeds-budget,
        breakEven:entry*(budget+gasOut)/(capital*(1-slipOut/100)*(1-feeOut/100)),
        downsideProfit:capital*.9*(1-slipOut/100)*(1-feeOut/100)-gasOut-budget};
    }
    function getTradePlan(key,priceUSD) {
      if (!tradePlans.has(key)) tradePlans.set(key,{budget:'100',anchor:priceUSD,entryPosition:'100',multiple:'1',feeIn:'',feeOut:'',slipIn:'',slipOut:'',gasIn:'',gasOut:''});
      const plan = tradePlans.get(key);
      if (!(plan.anchor > 0) && priceUSD > 0) plan.anchor = priceUSD;
      return plan;
    }
    const audMoney = value => 'A$' + Number(value).toLocaleString('en-AU',{minimumFractionDigits:0,maximumFractionDigits:2});
    const usdPrice = value => displayCoinPrice(value);
    let priceCurrency = 'USD', requestedPriceCurrency = 'USD', displayFx = null, fxPromise = null, fxLastAttempt = 0;
    function validDisplayFx(data,now=Date.now()) {
      if (!data || data.base !== 'USD' || data.quote !== 'AUD' || typeof data.rate !== 'number' || !Number.isFinite(data.rate) || data.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return false;
      const t = Date.parse(data.date+'T00:00:00Z');
      return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === data.date && t <= now && now-t <= 7*86400000;
    }
    function displayCoinPrice(value) {
      if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '-';
      const aud = priceCurrency === 'AUD' && validDisplayFx(displayFx);
      const amount = Number(value)*(aud ? displayFx.rate : 1);
      // Display rounding only; prices, plan anchors and route identities retain full precision.
      const size=Math.abs(amount);
      const short = size>0 && size<0.000001
        ? amount.toExponential(2).replace('e-','e-')
        : amount.toLocaleString('en-AU',size>=1 || size===0 ? {maximumFractionDigits:2} : {maximumSignificantDigits:4});
      return (aud?'A$':'US$')+short;
    }
    function repaintCurrency() {
      if (priceCurrency === 'AUD' && !validDisplayFx(displayFx)) priceCurrency='USD';
      $('pricesUSD').setAttribute('aria-pressed',String(priceCurrency==='USD'));
      $('pricesAUD').setAttribute('aria-pressed',String(priceCurrency==='AUD'));
      $('currencyNote').textContent = priceCurrency==='AUD' ? 'Prices AUD  |  reference FX '+displayFx.date+'  |  not a trading quote' : 'Prices USD  |  spend and results AUD';
      render();   buildBuySetups(); renderTickerPrices();
    }
    async function fetchDisplayFx() {
      if (validDisplayFx(displayFx)) return displayFx;
      if (fxPromise) return fxPromise;
      if (Date.now()-fxLastAttempt < 60000) throw new Error('FX cooldown');
      fxLastAttempt=Date.now();
      fxPromise=(async()=>{
        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
        try {
          const response=await fetch('https://api.frankfurter.dev/v2/rate/USD/AUD',{headers:{Accept:'application/json'},signal:controller.signal});
          if (!response.ok) throw new Error('FX unavailable');
          const payload=await response.json();
          if (!validDisplayFx(payload)) throw new Error('FX stale or invalid');
          displayFx={base:payload.base,quote:payload.quote,date:payload.date,rate:payload.rate};
          return displayFx;
        } finally {clearTimeout(timer);}
      })();
      try {return await fxPromise;} finally {fxPromise=null;}
    }
    async function setPriceCurrency(currency) {
      if (!['USD','AUD'].includes(currency)) return;
      requestedPriceCurrency=currency;
      if (currency==='USD') {priceCurrency='USD';repaintCurrency();return;}
      $('currencyNote').textContent='Loading AUD reference exchange rate...';
      try {
        await fetchDisplayFx();
        if (requestedPriceCurrency!=='AUD') return;
        priceCurrency='AUD';repaintCurrency();
      } catch (_) {
        if (requestedPriceCurrency!=='AUD') return;
        priceCurrency='USD';repaintCurrency();
        $('currencyNote').textContent='AUD conversion unavailable  |  prices remain USD  |  retry after 60s';
      }
    }
    function resultBuyRoute(row) {
      if (!row) return null;
      if (row.kind === 'named') {
        const item = checkerCoins.find(c => c.cg === row.key);
        return item ? tradeRouteFor(item) : null;
      }
      if (row.kind !== 'chain') return null;
      for (const lane of CHAIN_LANES) {
        const pool = (chainPools[lane.key] || []).find(p => p.identity === row.key);
        if (!pool || !validTokenAddress(lane,pool.tokenAddress)) continue;
        const identity = lane.api+':'+(lane.api === 'solana' ? pool.tokenAddress : pool.tokenAddress.toLowerCase());
        if (identity !== row.key) return null;
        if (row.contract !== pool.tokenAddress) return null;
        if (typeof row.chart !== 'string' || row.chart !== pool.chart) return null;
        const item={cg:row.key,chain:lane.key,addr:pool.tokenAddress};
        const route=tradeRouteFor(item);
        return route && verifiedRouteMatchesItem(route,item) ? route : null;
      }
      return null;
    }
    function resultBuyStatus(row,plan) {
      const exclusion=dumpExclusionReason(row);
      if(exclusion) return {enabled:false,note:exclusion};
      if(!rowRefreshedSinceWake(row)) return {enabled:false,note:"Fresh data needed after reopening."};
      if(currentSecurity(row)?.critical) return {enabled:false,note:'Public provider reports a serious token restriction. Review Market checks before proceeding elsewhere.'};
      const route = resultBuyRoute(row);
      if (!route) return {enabled:false,note:'Trading route unavailable for this coin.'};
      const model = tradeMath(row.price,plan);
      if (!(model.budget > 0) || !Number.isFinite(model.entry) || !Number.isFinite(model.exit)) return {enabled:false,note:'Choose your spend and prices first.'};
      const q = qualificationState(row);
      if (q.stage !== 'recovery') return {enabled:false,note:q.stage === 'freshness'?'Waiting for a fresh price.':q.stage === 'drop'?'This coin has left the 10% drop window.':'Waiting for recovery evidence.'};
      return {enabled:true,route,note:'Opens '+route.venue+' for manual review. Set your amount, entry and exit there; no order is placed here.'};
    }
    function resultBuyMarkup(row,plan) {
      const status = resultBuyStatus(row,plan);
      return `<button type="button" class="result-buy" data-result-buy ${status.enabled ? '' : 'disabled'} aria-label="Open ${escapeHTML(row.symbol || 'coin')} market for manual review">OPEN MARKET</button><div class="result-buy-note" data-result-buy-note>${escapeHTML(status.note)}</div>`;
    }
    function syncResultBuy(box,row,plan) {
      const button = box.querySelector('[data-result-buy]');
      if (!button) return;
      const status = resultBuyStatus(row,plan);
      button.disabled = !status.enabled;
      box.querySelector('[data-result-buy-note]').textContent = status.note;
    }
    async function openResultBuy(event) {
      const button = event.target.closest('[data-result-buy]');
      if (!button || button.disabled) return;
      const box = button.closest('[data-trade-plan]');
      const row = box && visibleTradeRows.get(box.dataset.tradePlan);
      if (!row) return;
      const plan = getTradePlan(row.key,row.price);
      const status = resultBuyStatus(row,plan);
      syncResultBuy(box,row,plan);
      if (!status.enabled) return;
      // Open a blank user-initiated tab first so the wallet snapshot can finish
      // without a mobile popup blocker losing the market navigation.
      const marketTab=window.open('about:blank','_blank');
      if(marketTab) marketTab.opener=null;
      try {
        await armWalletBuyWatch(row,status.route);
        if(marketTab) marketTab.location.replace(status.route.url); else window.location.href=status.route.url;
      } catch (error) {
        if(marketTab) marketTab.location.replace(status.route.url); else window.open(status.route.url,'_blank','noopener,noreferrer');
        setTimeout(()=>alert((error?.message||'Wallet watch unavailable')+'. Market opened, but this purchase is not being tracked.'),0);
      }
    }
    function tradeSummaryMarkup(row, plan) {
      const m=tradeMath(row.price,plan);
      if(!m.budget) return '<span class="trade-note">'+escapeHTML(m.status)+'</span>';
      const known=m.netProfit!==undefined;
      const cell=(label,value)=>`<div class="decision-cell"><small>${label}</small><strong>${escapeHTML(value)}</strong></div>`;
      const exit=freshRouteEvidence(row,plan);
      return `<div class="decision-grid">${cell('BUY COST',known?audMoney(m.entryCosts):'Needs your costs')}${cell('BREAK-EVEN PRICE',known?usdPrice(m.breakEven):'Needs your costs')}${cell('TARGET PROFIT',known?audMoney(m.netProfit):'Net unknown')}${cell('EXIT CHECK',exit?'Two-way quote seen':'Not checked / needs update')}</div>
        <div class="trade-note">${known?'If price falls 10% below your entry: '+escapeHTML(audMoney(m.downsideProfit))+' modeled profit/loss.':'Target before costs: '+escapeHTML(audMoney(m.grossProfit))+' profit. '+escapeHTML(m.status)+'. Enter costs below to see break-even.'}</div>
        <div class="trade-note">${known?'Uses your fee, slippage and network estimates. ':''}Future fills and liquidity are unknown; unchanged USD/AUD assumed. Before tax. This does not place a stop or sell order.</div>`;
    }
    function entryControlConfig(plan) {
      const anchor = Number(plan.anchor);
      if (!Number.isFinite(anchor) || anchor <= 0) return {step:1,count:1,index:1,min:0,max:0};
      // Price-sized planning increments, not a claim about a venue's tick size.
      const step = 10 ** Math.min(0,Math.floor(Math.log10(anchor))-2);
      const count = Math.max(1,Math.floor(anchor*.5/step));
      const below = Math.min(count,Math.max(0,Math.round(anchor*(100-Number(plan.entryPosition))/100/step)));
      return {step,count,index:count-below,min:anchor-count*step,max:anchor};
    }
    function entryPriceFromIndex(plan,index) {
      const c = entryControlConfig(plan);
      const selected = Math.min(c.count,Math.max(0,Math.round(Number(index))));
      return Math.min(c.max,Number((c.max-(c.count-selected)*c.step).toPrecision(15)));
    }
    function entrySliderMarkup(plan,index) {
      const c = entryControlConfig(plan);
      return `<label class="trade-note" for="plan-${index}-entrySteps">Reference price or lower</label>
        <div class="step-control" data-entry-control>
          <button type="button" class="step-button" data-step-field="entrySteps" data-step-direction="-1" aria-label="Lower entry price" ${c.index===0?'disabled':''}>-</button>
          <input class="slider" id="plan-${index}-entrySteps" type="range" min="0" max="${c.count}" step="1" value="${c.index}" data-plan-field="entrySteps" aria-valuetext="${escapeHTML(usdPrice(entryPriceFromIndex(plan,c.index)))}">
          <button type="button" class="step-button" data-step-field="entrySteps" data-step-direction="1" aria-label="Raise entry price up to reference" ${c.index===c.count?'disabled':''}>+</button>
        </div>
        <div class="slider-labels"><span data-entry-min>${escapeHTML(usdPrice(c.min))}</span><span data-entry-reference>Reference ${escapeHTML(usdPrice(c.max))}</span></div>
        <div class="trade-note" data-entry-step>${escapeHTML(usdPrice(c.step))} per click  |  planning step</div>`;
    }
    function syncEntryControl(box,plan) {
      const control = box.querySelector('[data-entry-control]');
      if (!control) return;
      const c = entryControlConfig(plan), slider = control.querySelector('input');
      slider.max = String(c.count); slider.value = String(c.index);
      slider.setAttribute('aria-valuetext',usdPrice(entryPriceFromIndex(plan,c.index)));
      control.querySelector('[data-step-direction="-1"]').disabled = c.index===0;
      control.querySelector('[data-step-direction="1"]').disabled = c.index===c.count;
      box.querySelector('[data-entry-min]').textContent = usdPrice(c.min);
      box.querySelector('[data-entry-reference]').textContent = 'Reference '+usdPrice(c.max);
      box.querySelector('[data-entry-step]').textContent = usdPrice(c.step)+' per click  |  planning step';
    }
    function stepSliderMarkup(field,index,value) {
      const budget = field === 'budget';
      const min = budget ? 0 : 1, max = budget ? 1000 : 100, step = budget ? 50 : 1;
      const count = (max-min)/step+1, gap = budget ? 68 : 44;
      const label = n => budget ? 'A$'+n.toLocaleString('en-AU') : n+'x';
      const ticks = Array.from({length:count},(_,i) => min+i*step).map(n => `<span data-scale-value="${n}" class="${Number(value) === n ? 'selected' : ''}">${label(n)}</span>`).join('');
      return `<div class="step-control" data-step-control="${field}">
        <button type="button" class="step-button" data-step-field="${field}" data-step-direction="-1" aria-label="${budget ? 'Decrease spend by A$50' : 'Decrease sell target by 1 times entry price'}" ${Number(value)<=min ? 'disabled' : ''}>-</button>
        <div class="plan-ruler" style="--scale-count:${count};--scale-gap:${gap}px">
          <input class="slider" id="plan-${index}-${field}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHTML(value)}" data-plan-field="${field}" aria-valuetext="${label(Number(value))}">
          <div class="trade-note">Selected value highlighted  |  swipe numbers to browse</div><div class="scale-scroll"><div class="scale-ticks" aria-hidden="true">${ticks}</div></div>
        </div>
        <button type="button" class="step-button" data-step-field="${field}" data-step-direction="1" aria-label="${budget ? 'Increase spend by A$50' : 'Increase sell target by 1 times entry price'}" ${Number(value)>=max ? 'disabled' : ''}>+</button>
      </div>`;
    }
    function syncStepControl(box,field,center) {
      const control = box.querySelector(`[data-step-control="${field}"]`);
      if (!control) return;
      const slider = control.querySelector('input'), value = Number(slider.value);
      control.querySelector('[data-step-direction="-1"]').disabled = value <= Number(slider.min);
      control.querySelector('[data-step-direction="1"]').disabled = value >= Number(slider.max);
      const ticks = Array.from(control.querySelectorAll('[data-scale-value]'));
      ticks.forEach(tick => tick.classList.toggle('selected',Number(tick.dataset.scaleValue) === value));
      if (center) {
        const scroll = control.querySelector('.scale-scroll'), gap = field === 'budget' ? 68 : 44;
        const index = (value-Number(slider.min))/Number(slider.step);
        scroll.scrollLeft = Math.max(0,(index+.5)*gap-scroll.clientWidth/2);
      }
    }
    function stepTradePlan(event) {
      const button = event.target.closest('[data-step-field]');
      if (!button || button.disabled) return;
      const field = button.dataset.stepField, direction = Number(button.dataset.stepDirection);
      if (!['budget','multiple','entrySteps'].includes(field) || ![-1,1].includes(direction)) return;
      const box = button.closest('[data-trade-plan]');
      const slider = box?.querySelector(`[data-plan-field="${field}"]`);
      if (!slider) return;
      slider.value = String(Math.min(Number(slider.max),Math.max(Number(slider.min),Number(slider.value)+direction*Number(slider.step))));
      updateTradePlan({target:slider});
      syncStepControl(box,field,true);
    }
    function tradePlanMarkup(row,index) {
      const plan = getTradePlan(row.key,row.price), model = tradeMath(row.price,plan);
      const field = (name,label,min,placeholder) => `<label for="plan-${index}-${name}">${label}<input class="input" id="plan-${index}-${name}" type="number" inputmode="decimal" step="any" min="${min}" placeholder="${placeholder}" data-plan-field="${name}" value="${escapeHTML(plan[name])}"></label>`;
      return `<div data-trade-plan="${escapeHTML(row.key)}">
        <div class="trade-note">${escapeHTML(row.chain)}  |  ${escapeHTML(row.venue || 'Trading route not selected')}</div>
        <div class="trade-choice"><label class="label" for="plan-${index}-budget"><span>MY SPEND</span><strong data-budget-label>${escapeHTML(audMoney(Number(plan.budget)))}</strong></label>
        ${stepSliderMarkup('budget',index,plan.budget)}</div>
        <div class="trade-windows">
          <section class="trade-window"><h3>ENTRY  |  MY BUY PRICE</h3>
            <div class="trade-big" data-entry-label>${escapeHTML(usdPrice(model.entry))}</div>
            ${entrySliderMarkup(plan,index)}
            <div class="trade-choice"><span class="trade-note" data-plan-sampled-price>Sampled price ${escapeHTML(usdPrice(row.price))}</span> <button type="button" data-use-price>Use latest price</button></div>
            <div class="trade-total" data-entry-total>${escapeHTML(audMoney(model.budget || 0))} budget  |  ${model.entryCosts !== undefined ? escapeHTML(audMoney(model.entryCosts))+' estimated entry costs' : 'entry costs need a quote'}</div>
          </section>
          <section class="trade-window exit"><h3>EXIT  |  MY SELL TARGET</h3>
            <div class="trade-big" data-exit-label>${escapeHTML(usdPrice(model.exit))}</div>
            <label class="label" for="plan-${index}-multiple"><span>MY MULTIPLIER</span><strong data-multiple-label>${model.multiple}x</strong></label>
            ${stepSliderMarkup('multiple',index,plan.multiple)}
            <div class="trade-note">1x = same price  |  2x = double  |  chosen target, not a forecast</div>
            <div class="trade-total" data-exit-total>${model.netReturn !== undefined ? escapeHTML(audMoney(model.netReturn))+' after entered costs' : escapeHTML(audMoney(model.grossReturn || 0))+' at target before costs'}</div>
          </section>
        </div>
        <section class="trade-result"><h3>MY RESULT</h3><div data-trade-summary>${tradeSummaryMarkup(row,plan)}</div><div data-route-check="${escapeHTML(row.key)}">${routeCheckMarkup(row,plan)}</div>${resultBuyMarkup(row,plan)}</section>
        <details class="trade-assumptions" data-manual-costs><summary>Fees &amp; slippage estimate</summary>
          <div class="trade-note">CHECK MY COSTS shows a separate current-route comparison where available. These optional future-price assumptions are not auto-filled from quotes. Blank means unknown, not free; do not count the same fee or price impact twice.</div>
          <div class="trade-fields">
          ${field('feeIn','Entry fees / token tax (%)',0,'From your venue')}
          ${field('feeOut','Exit fees / token tax (%)',0,'At the chosen exit value')}
          ${field('slipIn','Entry execution allowance (%)',0,'Impact + adverse slippage')}
          ${field('slipOut','Exit execution allowance (%)',0,'Impact + adverse slippage')}
          ${field('gasIn','Entry gas + approval / wallet costs (AUD)',0,'From the selected route')}
          ${field('gasOut','Exit gas + wallet costs (AUD)',0,'Scenario estimate')}
          </div><small>These are manual estimates, not measured chain averages. Entry costs fit within your budget; sell fees scale with the exit value. Future liquidity and exit costs are unknown. No order is placed. Selections last for this tab session.</small>
        </details>
      </div>`;
    }
    function redrawTradePlan(box,row,plan) {
      const m = tradeMath(row.price,plan);
      const label = (selector,value) => { box.querySelector(selector).textContent = value; };
      label('[data-budget-label]',audMoney(Number(plan.budget)));
      label('[data-entry-label]',m.entry ? usdPrice(m.entry) : 'Choose entry');
      label('[data-exit-label]',m.exit ? usdPrice(m.exit) : 'Choose target');
      label('[data-multiple-label]',plan.multiple+'x');
      label('[data-entry-total]',audMoney(m.budget || 0)+' budget  |  '+(m.entryCosts !== undefined ? audMoney(m.entryCosts)+' estimated entry costs' : m.status));
      label('[data-exit-total]',m.netReturn !== undefined ? audMoney(m.netReturn)+' after entered costs' : audMoney(m.grossReturn || 0)+' at target before costs');
      box.querySelector('[data-trade-summary]').innerHTML = tradeSummaryMarkup(row,plan);
      box.querySelector('[data-plan-field="budget"]').setAttribute('aria-valuetext',audMoney(Number(plan.budget)));
      syncEntryControl(box,plan);
      box.querySelector('[data-plan-field="multiple"]').setAttribute('aria-valuetext',plan.multiple+' times entry price');
      syncResultBuy(box,row,plan);
      const quoteBox=box.querySelector('[data-route-check]');
      if(quoteBox)quoteBox.innerHTML=routeCheckMarkup(row,plan);
    }
    function updateTradePlan(event) {
      const field = event.target.dataset?.planField;
      if (!['budget','entrySteps','multiple','feeIn','feeOut','slipIn','slipOut','gasIn','gasOut'].includes(field)) return;
      const box = event.target.closest('[data-trade-plan]');
      if (!box) return;
      const row = visibleTradeRows.get(box.dataset.tradePlan);
      if (!row) return;
      const plan = getTradePlan(row.key,row.price);
      if (field === 'entrySteps') {
        if (!Number.isFinite(Number(event.target.value))) return;
        plan.entryPosition = String(Math.min(100,entryPriceFromIndex(plan,event.target.value)/plan.anchor*100));
      } else plan[field] = event.target.value;
      persistTradePlans();
      redrawTradePlan(box,row,plan);
      if (field === 'budget' || field === 'multiple') syncStepControl(box,field,false);
    }

    // --- BUY SETUPS LOGIC (Strict 24H Filter) ---
    function buildBuySetups() {
      // Don't discard the owner's focused field while a background feed refreshes.
      refreshQualificationGauges();
      if (document.activeElement?.closest('#buySetupRows')) return;
      const now = Date.now();
      const namedAvailable = market.map(m => { const item=checkerCoins.find(c => c.cg === m.id); return {kind:'named',key:m.id,symbol:String(m.symbol || '').toUpperCase(),chain:String(item?.chain || 'MARKET').toUpperCase(),contract:String(item?.addr || ''),venue:'Reference price  |  route not selected',price:Number(m.current_price),change:finiteChange(m.price_change_percentage_24h),state:entryStateFor(m.id),rating:screeningRating(m)}; });
      const namedQualified = market.filter(m => {
        const change = finiteChange(m.price_change_percentage_24h);
        return (
          change !== null &&
          change <= -10 && change > -100 &&
          freshMarketItem(m, now)
        );
      }).map(m => { const item=checkerCoins.find(c => c.cg === m.id); return {kind:'named',key:m.id,symbol:String(m.symbol || '').toUpperCase(),chain:String(item?.chain || 'MARKET').toUpperCase(),contract:String(item?.addr || ''),venue:'Reference price  |  route not selected',price:Number(m.current_price),change:Number(m.price_change_percentage_24h),state:entryStateFor(m.id),rating:screeningRating(m)}; });
      const discoveredAvailable = [];
      const discoveredQualified = CHAIN_LANES.flatMap(lane => {
        const rows = (chainPools[lane.key] || []).map(pool => {
          const state = entryStateFor(pool.identity);
          const directionPoints = state === 'recovering' ? 20 : state === 'stabilising' ? 10 : state === 'checking' ? 5 : 0;
          const rating = Math.round(Math.min(100,Math.min(70,Math.max(0,-pool.change24h * 4)) + directionPoints + 10));
          return {kind:'chain',key:pool.identity,symbol:pool.symbol,chain:lane.name,contract:pool.tokenAddress,venue:pool.venue,price:pool.price,change:pool.change24h,state,rating,chart:pool.chart};
        });
        discoveredAvailable.push(...rows);
        const recentIds=new Set((chainPools[lane.key]||[]).filter(pool=>freshChainPool(pool,now)).map(pool=>pool.identity));
        return rows.filter(row=>recentIds.has(row.key)&&Number.isFinite(row.change)&&row.change<=-10&&row.change>-100);
      });
      const pinned=retainWatchedRows([...namedAvailable,...discoveredAvailable]);
      const qualifyingRows=[...namedQualified,...discoveredQualified].filter(row=>!pumpDumpExclusions.has(pumpDumpKeyForRow(row))&&!currentSecurity(row)?.critical&&!dumpExclusionReason(row,now));
      const publicDataReady=marketReceivedAt>0 || Object.values(chainPoolsUpdatedAt).some(at=>Number.isFinite(at)&&at>0);
      updateDumpEntryState(qualifyingRows,publicDataReady,now);
      const merged=new Map(qualifyingRows.map(row=>[row.key,row]));
      pinned.forEach(row=>merged.set(row.key,row));
      if(!publicDataReady) lastDeskRows.forEach((row,key)=>{if(!merged.has(key))merged.set(key,row);});
      const qualified = [...merged.values()].filter(row => !pumpDumpExclusions.has(pumpDumpKeyForRow(row))&&(!currentSecurity(row)?.critical||watchedDumpRows.has(row.key))).sort((a,b)=>Number(watchedDumpRows.has(b.key))-Number(watchedDumpRows.has(a.key)) || compareDeskRows(a,b));
      visibleTradeRows = new Map(qualified.map(row => [row.key,row]));
      if(publicDataReady){lastDeskRows=new Map(qualified.map(row=>[row.key,{...row,lastOpen:false}]));persistLastDeskRows(lastDeskRows.values());}
      refreshMarketPulse();
      renderDumpGlance();
      const expandedCards=new Set(Array.from($('buySetupRows').querySelectorAll('details.coin-plan[open]')).map(d=>d.dataset.planKey));
      const openEvidence=new Set(Array.from($('buySetupRows').querySelectorAll('details.market-evidence[open]')).map(d=>d.dataset.evidenceKey));
      const openPlans = new Set(Array.from($('buySetupRows').querySelectorAll('details[data-manual-costs][open]')).map(details => details.closest('[data-trade-plan]')?.dataset.tradePlan));

      if (qualified.length === 0) {
        $('buySetupRows').innerHTML = `<div class="empty">No fresh setups pass yet. We need a 10% to under 50% drop and seven verified days of trading. Your WATCH pins stay visible.</div>`;
        return;
      }

      const rows = qualified.map((m, index) => {
        const change = m.change;
        const state = m.state;
        const stateSignal = entryStateSignal(state);
        const rating = m.rating;
        const chart = m.kind === 'chain' ? m.chart : `https://www.coingecko.com/en/coins/${encodeURIComponent(m.key)}`;
        const action = `<div class="buttons"><button type="button" class="watch-button" data-watch-key="${escapeHTML(m.key)}" aria-pressed="${watchedDumpRows.has(m.key)}" aria-label="${watchedDumpRows.has(m.key)?'Unpin':'Watch'} ${escapeHTML(m.symbol)}">${watchedDumpRows.has(m.key)?'WATCHING':'WATCH'}</button><a class="btn" href="${escapeHTML(chart)}" target="_blank" rel="noopener noreferrer">CHART</a><button type="button" class="pnd-button" data-pump-dump-key="${escapeHTML(pumpDumpKeyForRow(m))}" data-pump-dump-symbol="${escapeHTML(m.symbol)}">PUMPNDUMP</button></div>`;
        const compact=compactState(m);
        return `<article class="opportunity-card" data-feed-active="${compact.q.stage!=='freshness' && compact.q.stage!=='drop'}" data-desk-key="${escapeHTML(m.key)}" aria-label="${escapeHTML(m.symbol)} trade plan">
          <div class="opportunity-head"><div><h3>${escapeHTML(m.symbol)}</h3><span class="trade-note">${escapeHTML(m.chain)}</span></div>${action}</div>
          ${contractMarkup(m)}
          <div class="opportunity-price"><span><span class="trade-note">Sampled price</span><b data-card-price>${escapeHTML(usdPrice(m.price))}</b></span><span class="decline" data-card-change>${Number.isFinite(change)?'24H '+change.toFixed(2)+'%':'24H unavailable'}</span></div>
          <div data-card-chart>${loadedCardCharts.has(m.key)?sampleChartMarkup(m):`<button type="button" class="btn" data-load-card-chart="${escapeHTML(m.key)}">LOAD CHART</button>`}</div>
          <span class="card-state" data-card-state data-tone="${compact.tone}">${compact.label}</span>
          <div class="card-reason" data-card-reason>${escapeHTML(compact.q.note)}</div>
          <div class="card-freshness" data-card-age>${escapeHTML(compactFreshness(m))}</div>
          <details class="coin-plan market-evidence" data-evidence-key="${escapeHTML(m.key)}" ${openEvidence.has(m.key)?'open':''}><summary>Market checks</summary><div data-market-evidence>${marketEvidenceMarkup(m)}</div></details>
          <details class="coin-plan" data-plan-key="${escapeHTML(m.key)}" ${expandedCards.has(m.key)?'open':''}><summary>My entry &amp; exit plan</summary>${tradePlanMarkup(m,index)}</details>
        </article>`;
      }).join('');
      $('buySetupRows').innerHTML = rows;
      $('buySetupRows').querySelectorAll('[data-trade-plan]').forEach(box => { if (openPlans.has(box.dataset.tradePlan)) box.querySelector('details[data-manual-costs]').open = true; });
      $('buySetupRows').querySelectorAll('[data-trade-plan]').forEach(box => { syncStepControl(box,'budget',true); syncStepControl(box,'multiple',true); });
    }

    // --- DUMP-A-THON LOGIC (Direct Links & Visible Addresses) ---
    function getDexLink(item) {
      if (item.chart) return item.chart;
      if (item.addr === 'Native') return `https://dexscreener.com/${item.chain}`;
      return `https://dexscreener.com/${item.chain}/${item.addr}`;
    }

    function openQualifiedTicker(event,key) {
      event.stopPropagation();
      const row=visibleTradeRows.get(key);
      if(!row)return;
      const shell=$('tickerShell');
      if(!shell.classList.contains('paused')) {
        toggleTickerPause();
        $('tickerStatus').textContent='Banner paused - tap a qualified coin again to open its verified chart';
        return;
      }
      if(row.kind==='named')return openCoinWindow(row.key);
      const url=String(row.chart||'');
      if(!/^https:\/\/www\.geckoterminal\.com\/[a-z0-9_-]+\/pools\/[a-zA-Z0-9_-]+\?locale=en$/.test(url))return alert('Verified English chart route unavailable. Nothing was opened.');
      window.open(url,'_blank','noopener,noreferrer');
    }
    function renderTickerPrices() {
      const qualified=[...visibleTradeRows.values()]
        .filter(row=>snapshotBucket(row)==='qualified')
        .sort(compareDeskRows);
      const paused=$('tickerShell').classList.contains('paused');
      const tickerRows=paused?qualified.slice(0,12):qualified;
      if(!tickerRows.length) {
        $('ticker').innerHTML='<span class="item"><b>NO QUALIFYING COINS RIGHT NOW</b></span>';
        $('tickerStatus').textContent='0 qualified - tap Sonar or pull down when you want fresh data';
        return;
      }
      const tickerHtml=tickerRows.map((row,index)=>{
        const change=finiteChange(row.change)??0;
        const signal=signalForChange(change);
        const direction=change>0?'positive':(change<0?'negative':'flat');
        return `<button type="button" class="item scanning ${direction}" style="--scan-order:${index}" data-qualified-ticker-key="${escapeHTML(row.key)}" onclick="openQualifiedTicker(event,this.dataset.qualifiedTickerKey)" aria-label="${escapeHTML(row.symbol)}: ${money(row.price)}, 24 hour change ${change.toFixed(2)} percent. Qualified recovery evidence."><b>${escapeHTML(row.symbol)}</b> <span class="price">${money(row.price)}</span> <span class="${signal}">${change>=0?'+':''}${change.toFixed(2)}%</span></button>`;
      }).join('');
      $('ticker').innerHTML=paused?tickerHtml:tickerHtml+tickerHtml;
      $('tickerStatus').textContent=`${qualified.length} qualified - saved desk only; refresh when you choose`;
    }
    let feedPromise=null,feedRetryAt=0,manualRefreshAt=0,manualRefreshing=false;
    function load(force=false) {
      if(document.hidden)return Promise.resolve('paused');
      if(feedPromise) return feedPromise;
      if(!force&&Date.now()<feedRetryAt) return Promise.resolve('cooldown');
      feedPromise=performLoad().finally(()=>{feedPromise=null;});
      return feedPromise;
    }
    async function performLoad() {
      priceCheckActivity('watchlist',1);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try {
        const requestStarted = Date.now();
        const endpoint = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids.join(',') + '&order=market_cap_desc&per_page=250&sparkline=false&price_change_percentage=24h&precision=full&locale=en&_scl=' + requestStarted;
        const r = await fetch(endpoint, {cache:'no-store', headers:{Accept:'application/json'},signal:controller.signal});
        if (r.status === 429) {
          feedRetryAt=Date.now()+60000;
          $('tickerStatus').textContent = 'Rate limit reached - cooling down; automatic retry pending';
          
          buildBuySetups();
          return 'cooldown';
        }
        if (!r.ok) throw new Error(`Public feed returned HTTP ${r.status}`);
        const payload = await r.json();
        if (!Array.isArray(payload)) throw new Error('Public feed returned an invalid payload');
        if(requestStarted<marketWakeAt)return 'superseded';
        market = validMarketRows(payload,false);
        if(!market.length)throw new Error('Public feed returned no usable prices');
        marketReceivedAt = Date.now();
        feedRetryAt=0;saveMarketSnapshot(market);
        if (Object.keys(sessionBaseline).length === 0) {
          resetLiveSession();
        }
        recordPriceSamples();
        render();
        buildBuySetups();
        renderTickerPrices();
        const fresh=market.some(m=>freshMarketItem(m));
        if(fresh)sonarFresh('watchlist',['tickerShell']);
        return fresh?'updated':'stale';
      } catch (e) {
        feedRetryAt=Date.now()+60000;
        if(!market.length)$('ticker').textContent = 'Public prices unavailable';
        $('tickerStatus').textContent = market.length?'Showing last saved prices - automatic retry pending':'Price feed unavailable - automatic retry pending';
        
        buildBuySetups();
        
        return 'unavailable';
      } finally { clearTimeout(timer); priceCheckActivity('watchlist',-1); }
    }
    async function refreshDesk() {
      if(manualRefreshing || document.hidden)return;
      const status=$('refreshStatus');
      if(Date.now()-manualRefreshAt<15000){status.textContent='Please wait a few seconds between refreshes';return;}
      manualRefreshAt=Date.now();manualRefreshing=true;
      try {
        status.textContent='Refreshing prices only | your desk stays in place';
        feedRetryAt=0;
        await load(true);
        status.textContent='Prices refreshed | other checks update only when opened';
      } finally {manualRefreshing=false;}
    }
    function installPullRefresh() {
      let start=null,distance=0,armed=false;
      const cue=$('pullCue');
      const reset=()=>{start=null;distance=0;armed=false;cue.style.height='0px';};
      document.addEventListener('touchstart',event=>{
        reset();
        if(event.touches.length!==1 || window.scrollY>0 || manualRefreshing || event.target.closest('input,button,a,select,textarea,summary,.scale-scroll,.ticker,.chain-banner')) return;
        start={x:event.touches[0].clientX,y:event.touches[0].clientY};
      },{passive:true});
      document.addEventListener('touchmove',event=>{
        if(!start) return;
        if(event.touches.length!==1 || window.scrollY>0) return reset();
        const dx=event.touches[0].clientX-start.x,dy=event.touches[0].clientY-start.y;
        if(Math.abs(dx)>20 && Math.abs(dx)>Math.abs(dy)) return reset();
        if(dy<0) return reset();
        if(dy<10) { armed=false;distance=0;cue.style.height='0px';return; }
        if(event.cancelable) event.preventDefault();
        distance=Math.min(110,dy*.55);armed=dy>=110;
        cue.style.height=distance+'px';cue.textContent=armed?'REFRESH Release to refresh':'PULL Pull to refresh';
      },{passive:false});
      document.addEventListener('touchend',()=>{const go=armed;reset();if(go) refreshDesk();},{passive:true});
      document.addEventListener('touchcancel',reset,{passive:true});
    }

    $('buySetupRows').addEventListener('click',event=>{
      const loadChartButton=event.target.closest('[data-load-card-chart]');
      if(loadChartButton){
        event.preventDefault();
        const key=loadChartButton.dataset.loadCardChart,row=visibleTradeRows.get(key),host=loadChartButton.closest('[data-card-chart]');
        if(!row||!host)return;
        loadedCardCharts.add(key);
        host.innerHTML=sampleChartMarkup(row);
        return;
      }
      const intervalButton=event.target.closest('[data-candle-interval]');
      if(intervalButton){
        event.preventDefault();const key=intervalButton.dataset.candleKey,interval=intervalButton.dataset.candleInterval;
        const row=visibleTradeRows.get(key),host=intervalButton.closest('[data-card-chart]');
        if(!row||!host||!Object.hasOwn(candleIntervals,interval))return;
        if(selectedCandleIntervals.size>=500&&!selectedCandleIntervals.has(key))selectedCandleIntervals.delete(selectedCandleIntervals.keys().next().value);
        selectedCandleIntervals.set(key,interval);host.innerHTML=sampleChartMarkup(row);
        host.querySelector(`[data-candle-interval="${interval}"]`)?.focus({preventScroll:true});return;
      }
      const button=event.target.closest('[data-pool-chart]');
      if(button){event.preventDefault();openPoolChart(button.dataset.poolChart);}
    });
    $('poolChartDialog').addEventListener('close',()=>{$('poolChartFrame').removeAttribute('src');});
    render();
    const restoredLastDesk=restoreMarketSnapshot();
    if(market.length) renderTickerPrices();
    if(restoredLastDesk) $('refreshStatus').textContent='Last open restored | tap Sonar or pull down to refresh prices';
    
    installPullRefresh();
    $('buySetupRows').addEventListener('toggle',event=>{
      if(event.target.matches('details.market-evidence') && event.target.open) {
        const row=visibleTradeRows.get(event.target.dataset.evidenceKey),asset=row&&assetContext(row);
        if(asset)void checkAssetSecurity(asset).then(()=>{refreshCompactCards();buildBuySetups();});
      }
      if(event.target.matches('details.coin-plan') && event.target.open) {
        const box=event.target.querySelector('[data-trade-plan]');
        if(box) { syncStepControl(box,'budget',true); syncStepControl(box,'multiple',true); }
      }
    },true);
    $('buySetupRows').addEventListener('input',updateTradePlan);
    $('buySetupRows').addEventListener('click',stepTradePlan);
    $('buySetupRows').addEventListener('click',openResultBuy);
    $('buySetupRows').addEventListener('click',event => {
      const button=event.target.closest('[data-copy-contract]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      copyContractAddress(button.dataset.copyContract,button);
    });
    $('buySetupRows').addEventListener('click',event => {
      const button=event.target.closest('[data-pump-dump-key]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      const key=button.dataset.pumpDumpKey, symbol=button.dataset.pumpDumpSymbol || 'This coin';
      if (!key || key.length>180) return alert('Coin identity is invalid. Nothing was removed.');
      if (!confirm('Remove '+symbol+' from the Dump opps lineup as Pump & Dump?')) return;
      pumpDumpExclusions.add(key); savePumpDumpExclusions(); button.blur(); setTimeout(buildBuySetups,0);
    });
    $('buySetupRows').addEventListener('click',event=>{
      const button=event.target.closest('[data-watch-key]'); if(!button) return;
      event.preventDefault();event.stopPropagation();
      toggleDumpWatch(button.dataset.watchKey); button.blur(); setTimeout(buildBuySetups,0);
    });
    $('dumpGlanceRows').addEventListener('click',event=>{
      const row=event.target.closest('[data-glance-key]');
      if(row) openGlanceCard(row.dataset.glanceKey);
    });
    document.addEventListener('visibilitychange',refreshCheckDots);
    $('buySetupRows').addEventListener('focusout',() => setTimeout(buildBuySetups,0));
    $('buySetupRows').addEventListener('click',event => {
      if (!event.target.closest('[data-use-price]')) return;
      const box = event.target.closest('[data-trade-plan]');
      const row = box && visibleTradeRows.get(box.dataset.tradePlan);
      if (!row) return;
      let sample;
      if (row.kind === 'named') {
        const m = price(row.key);
        if (freshMarketItem(m)) sample = Number(m.current_price);
      } else {
        for (const lane of CHAIN_LANES) {
          const pool = (chainPools[lane.key] || []).find(p => p.identity === row.key);
          if(!freshChainPool(pool))continue;
          sample = pool.price;
          if (sample > 0) break;
        }
      }
      if (!(sample > 0)) return alert('A fresh price is unavailable. Your chosen entry is unchanged.');
      const plan = getTradePlan(row.key,sample);
      plan.anchor = sample;
      plan.entryPosition = '100';
      persistTradePlans();
      redrawTradePlan(box,row,plan);
    });

    $('buySetupRows').addEventListener('click', event => {
      const quoteButton=event.target.closest('[data-check-route]');
      if(quoteButton) {event.preventDefault();if(!quoteButton.disabled)requestRouteCheck(quoteButton.dataset.checkRoute);return;}
      const button = event.target.closest('[data-opportunity-url]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const url = button.dataset.opportunityUrl;
      if (!/^https:\/\/www\.geckoterminal\.com\/[a-z0-9_-]+\/pools\/[a-zA-Z0-9_-]+\?locale=en$/.test(url)) return alert('Verified English chart route unavailable. Nothing was opened.');
      window.open(url,'_blank','noopener,noreferrer');
    },true);
    $('walletLedger').addEventListener('click',event=>{
      const add=event.target.closest('[data-add-position]'); if(add)return addDetectedPosition(add.dataset.addPosition);
      const dismiss=event.target.closest('[data-dismiss-wallet-record]'); if(dismiss)return dismissWalletRecord(dismiss.dataset.dismissWalletRecord);
      const sold=event.target.closest('[data-mark-sold]'); if(sold&&confirm('Move this position into History as sold?'))return markPositionSold(sold.dataset.markSold);
    });
    savePumpDumpExclusions();
    renderWalletLedger();
    function saveLastView() {
      try {
        const open=[...document.querySelectorAll('details[open]')].map(node=>node.id||node.dataset.planKey||node.dataset.evidenceKey).filter(value=>typeof value==='string'&&value.length<=180).slice(0,100);
        localStorage.setItem(LAST_VIEW_KEY,JSON.stringify({version:1,scrollY:Math.max(0,Math.round(window.scrollY)),tickerPaused:$('tickerShell').classList.contains('paused'),open}));
      } catch(_) {}
    }
    function restoreLastView() {
      try {
        const saved=JSON.parse(localStorage.getItem(LAST_VIEW_KEY)||'null');if(!saved||saved.version!==1)return;
        if(saved.tickerPaused===false&&$('tickerShell').classList.contains('paused'))toggleTickerPause();
        const wanted=new Set(Array.isArray(saved.open)?saved.open:[]);
        document.querySelectorAll('details').forEach(node=>{const key=node.id||node.dataset.planKey||node.dataset.evidenceKey;if(key&&wanted.has(key))node.open=true;});
        if(Number.isFinite(saved.scrollY))requestAnimationFrame(()=>window.scrollTo({top:Math.max(0,saved.scrollY),behavior:'instant'}));
      } catch(_) {}
    }
    restoreLastView();
    // Reopen exactly where Craig left off. No automatic network request or timed full refresh.
    if(!restoredLastDesk) {
      $('refreshStatus').textContent='First opening | loading one lightweight price update';
      setTimeout(()=>load(true),0);
    }
    setInterval(refreshQualificationGauges, 15000);
    setInterval(()=>{if(!document.hidden)paintRouteChecks();},2000);
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('gauge-motion-paused',document.hidden);
      if(document.hidden){lastHiddenAt=Date.now();saveLastView();refreshSonar();}
      else refreshSonar();
    });
    window.addEventListener('pagehide',saveLastView);
  
