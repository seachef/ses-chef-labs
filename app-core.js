    // --- WALLET CONNECTIONS ---
    const walletSession={evm:null,evmProvider:null,solana:null};
    const announcedWallets=[];
    window.addEventListener('eip6963:announceProvider',event=>{
      const detail=event && event.detail;
      if(!detail?.provider || !detail?.info?.uuid || announcedWallets.some(item=>item.info.uuid===detail.info.uuid)) return;
      announcedWallets.push(detail);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    function toggleWalletTracking() {
      const choices=$('trackWalletChoices'),button=$('trackWalletButton');
      choices.hidden=!choices.hidden;button.setAttribute('aria-expanded',String(!choices.hidden));
    }
    function closeWalletTracking() {
      $('trackWalletChoices').hidden=true;$('trackWalletButton').setAttribute('aria-expanded','false');
      $('trackWalletButton').focus({preventScroll:true});
    }
    async function connectRabby() {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const announced=announcedWallets.find(item=>item.info?.rdns==='io.rabby' || item.provider?.isRabby);
      const provider=announced?.provider || (window.ethereum?.isRabby ? window.ethereum : null);
      if (!provider) {
        alert('Rabby is not available in this browser. On Windows, open Sea Chef Labs in the browser containing the Rabby extension. On mobile, open this page from Rabby\'s own dapp browser if your Rabby version provides one. Nothing was connected.');
        return;
      }
      try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        walletSession.evmProvider=provider;
        walletSession.evm=String(accounts[0] || '').toLowerCase();
        renderWalletLedger();closeWalletTracking();
        alert('Rabby Connected: ' + accounts[0].substring(0, 6) + '...' + accounts[0].substring(38) + '. Public activity detection is ready.');
      } catch (e) { alert('Connection failed or rejected.'); }
    }
    async function connectPhantom() {
      if (!window.solana?.isPhantom) {
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
          const here=location.href.split('#')[0],ref=location.origin;
          location.href=`https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`;
          return;
        }
        alert('Phantom is not available in this browser. Open Sea Chef Labs in the browser containing the Phantom extension. Nothing was connected.');
        return;
      }
      try {
        const resp = await window.solana.connect();
        walletSession.solana=resp.publicKey.toString();
        renderWalletLedger();closeWalletTracking();
        alert('Phantom Connected: ' + walletSession.solana.substring(0, 6) + '...' + walletSession.solana.slice(-4) + '. Public activity detection is ready.');
      } catch (e) { alert('Connection failed or rejected.'); }
    }


    // Local, public-wallet activity tracking. No signing, keys or approvals.
    function readLocalArray(name) { try { const value=JSON.parse(localStorage.getItem(name)||'[]'); return Array.isArray(value)?value:[]; } catch (_) { return []; } }
    let pendingWalletBuys=readLocalArray('seaChefPendingWalletBuys');
    let openWalletPositions=readLocalArray('seaChefOpenWalletPositions');
    let walletTradeHistory=readLocalArray('seaChefWalletTradeHistory');
    function saveWalletLedger() {
      localStorage.setItem('seaChefPendingWalletBuys',JSON.stringify(pendingWalletBuys));
      localStorage.setItem('seaChefOpenWalletPositions',JSON.stringify(openWalletPositions));
      localStorage.setItem('seaChefWalletTradeHistory',JSON.stringify(walletTradeHistory));
      renderWalletLedger();
    }
    function walletRecordMarkup(record,type) {
      const detected=record.status==='detected';
      const price=record.entryPrice>0 ? 'Entry '+Number(record.entryPrice).toPrecision(6)+' USDC' : 'Entry cost waiting';
      const controls=type==='pending'
        ? detected ? `<button class="btn" data-add-position="${escapeHTML(record.id)}">ADD POSITION</button><button class="pnd-button" data-dismiss-wallet-record="${escapeHTML(record.id)}">DISMISS</button>` : `<button class="pnd-button" data-dismiss-wallet-record="${escapeHTML(record.id)}">CANCEL WATCH</button>`
        : type==='open' ? `<button class="btn danger" data-mark-sold="${escapeHTML(record.id)}">I SOLD IT</button>` : '';
      return `<article class="wallet-record"><h3>${escapeHTML(record.symbol)}</h3><div class="trade-note">${escapeHTML(record.chain)}  |  ${type==='pending'?(detected?'PURCHASE DETECTED':'WATCHING WALLET'):type==='open'?'OPEN POSITION':'HISTORY'}</div><code>${escapeHTML(record.contract)}</code><div class="trade-note">${record.quantity>0?Number(record.quantity).toPrecision(7)+' coins  |  ':''}${escapeHTML(price)}<br>${new Date(record.detectedAt||record.openedAt||record.closedAt).toLocaleString()}</div><div class="buttons">${controls}</div></article>`;
    }
    function renderWalletLedger() {
      if (!document.getElementById('pendingBuys')) return;
      $('walletLedgerStatus').textContent=(walletSession.evm?'Rabby connected  |  ':'')+(walletSession.solana?'Phantom connected  |  ':'')+pendingWalletBuys.length+' watched';
      $('pendingBuys').innerHTML=pendingWalletBuys.map(r=>walletRecordMarkup(r,'pending')).join('') || '<div class="empty">No wallet purchase waiting.</div>';
      $('openPositions').innerHTML=openWalletPositions.map(r=>walletRecordMarkup(r,'open')).join('') || '<div class="empty">No open positions recorded.</div>';
      $('tradeHistory').innerHTML=walletTradeHistory.map(r=>walletRecordMarkup(r,'history')).join('') || '<div class="empty">No completed history recorded.</div>';
    }
    const EVM_CHAIN_IDS=Object.freeze({mainnet:'0x1',arbitrum:'0xa4b1',optimism:'0xa',polygon:'0x89',avalanche:'0xa86a',bnb:'0x38'});
    const EVM_USDC=Object.freeze({mainnet:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',arbitrum:'0xaf88d065e77c8cc2239327c5edb3a432268e5831',optimism:'0x0b2c639c533813f4aa9d7837caf62653d097ff85',polygon:'0x3c499c542cef5e3811e1192ce70d8cc03c5c3359c',avalanche:'0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',bnb:'0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'});
    function evmBalanceCallData(wallet) { return '0x70a08231'+String(wallet).toLowerCase().replace(/^0x/,'').padStart(64,'0'); }
    async function evmTokenBalance(contract,wallet) {
      const provider=walletSession.evmProvider || window.ethereum;
      if(!provider?.request) throw new Error('EVM wallet provider unavailable');
      const raw=await provider.request({method:'eth_call',params:[{to:contract,data:evmBalanceCallData(wallet)},'latest']});
      const decimalsRaw=await provider.request({method:'eth_call',params:[{to:contract,data:'0x313ce567'},'latest']});
      const decimals=Number(BigInt(decimalsRaw));
      if (!Number.isInteger(decimals)||decimals<0||decimals>36) throw new Error('Invalid token decimals');
      return Number(BigInt(raw))/10**decimals;
    }
    async function solanaRpc(method,params) {
      const response=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      if(!response.ok) throw new Error('Solana public RPC unavailable');
      const payload=await response.json(); if(payload.error) throw new Error('Solana public RPC rejected request'); return payload.result;
    }
    async function solanaTokenBalance(owner,mint) {
      const result=await solanaRpc('getTokenAccountsByOwner',[owner,{mint},{encoding:'jsonParsed',commitment:'confirmed'}]);
      return (result?.value||[]).reduce((sum,item)=>sum+Number(item?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString||0),0);
    }
    async function walletBalanceSnapshot(route,contract) {
      if(route.wallet==='PHANTOM') {
        if(!walletSession.solana) throw new Error('Connect Phantom first');
        return {walletType:'PHANTOM',wallet:walletSession.solana,token:await solanaTokenBalance(walletSession.solana,contract),usdc:await solanaTokenBalance(walletSession.solana,SOLANA_USDC_MINT)};
      }
      if(route.wallet==='RABBY') {
        if(!walletSession.evm) throw new Error('Connect Rabby first');
        const chainId=EVM_CHAIN_IDS[route.chain],usdc=EVM_USDC[route.chain];
        if(!chainId||!usdc) throw new Error('Wallet detection unsupported on this chain');
        const provider=walletSession.evmProvider || window.ethereum;
        if(!provider?.request) throw new Error('EVM wallet provider unavailable');
        await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
        return {walletType:'RABBY',wallet:walletSession.evm,token:await evmTokenBalance(contract,walletSession.evm),usdc:await evmTokenBalance(usdc,walletSession.evm)};
      }
      throw new Error('Wallet detection unavailable');
    }
    async function armWalletBuyWatch(row,route) {
      const contract=contractIdentityForRow(row);
      if(!contract) throw new Error('Exact contract unavailable');
      const snapshot=await walletBalanceSnapshot(route,contract);
      const id='buy-'+Date.now()+'-'+Math.random().toString(16).slice(2);
      pendingWalletBuys=pendingWalletBuys.filter(item=>!(item.key===row.key&&item.status==='watching'));
      pendingWalletBuys.unshift({id,key:row.key,symbol:row.symbol,chain:row.chain,contract,routeVenue:route.venue,openedAt:Date.now(),status:'watching',...snapshot});
      saveWalletLedger(); return id;
    }
    async function checkPendingWalletBuys() {
      for(const record of pendingWalletBuys.filter(item=>item.status==='watching')) {
        try {
          const route=record.walletType==='PHANTOM'?{wallet:'PHANTOM'}:{wallet:'RABBY',chain:Object.keys(EVM_CHAIN_IDS).find(key=>record.chain.toLowerCase().includes(key==='mainnet'?'ethereum':key))};
          if(record.walletType==='PHANTOM') walletSession.solana=record.wallet; else walletSession.evm=record.wallet;
          const current=await walletBalanceSnapshot(route,record.contract);
          const quantity=current.token-Number(record.token),spent=Number(record.usdc)-current.usdc;
          if(quantity>0) { record.status='detected';record.quantity=quantity;record.spentUsdc=spent>0?spent:null;record.entryPrice=spent>0?spent/quantity:null;record.detectedAt=Date.now();record.lastWalletBalance=current.token; }
        } catch (_) {}
      }
      saveWalletLedger();
    }
    function addDetectedPosition(id) {
      const index=pendingWalletBuys.findIndex(r=>r.id===id&&r.status==='detected'); if(index<0)return;
      openWalletPositions.unshift({...pendingWalletBuys[index],status:'open',addedAt:Date.now()}); pendingWalletBuys.splice(index,1);saveWalletLedger();
    }
    function dismissWalletRecord(id) { pendingWalletBuys=pendingWalletBuys.filter(r=>r.id!==id);saveWalletLedger(); }
    function markPositionSold(id) { const index=openWalletPositions.findIndex(r=>r.id===id);if(index<0)return;walletTradeHistory.unshift({...openWalletPositions[index],status:'closed',closedAt:Date.now()});openWalletPositions.splice(index,1);saveWalletLedger(); }

    // --- VERIFIED CATALOGS ---
    const deep = [
      {id:'solana',s:'SOL',n:'Solana',c:'Solana',a:'Native SOL',cg:'solana',chain:'solana',addr:'Native',dex:'https://dexscreener.com/solana/solana'},
      {id:'dogwifcoin',s:'WIF',n:'dogwifhat',c:'Solana',a:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',cg:'dogwifcoin',chain:'solana',addr:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',dex:'https://dexscreener.com/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'},
      {id:'jupiter-exchange-solana',s:'JUP',n:'Jupiter',c:'Solana',a:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',cg:'jupiter-exchange-solana',chain:'solana',addr:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',dex:'https://dexscreener.com/solana/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'},
      {id:'matic-network',s:'POL',n:'POL',c:'Polygon',a:'0x0000000000000000000000000000000000001010',cg:'matic-network',chain:'polygon',addr:'0x0000000000000000000000000000000000001010',dex:'https://dexscreener.com/polygon/polygon'},
      {id:'bonk',s:'BONK',n:'Bonk',c:'Solana',a:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',cg:'bonk',chain:'solana',addr:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',dex:'https://dexscreener.com/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'},
      {id:'raydium',s:'RAY',n:'Raydium',c:'Solana',a:'4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',cg:'raydium',chain:'solana',addr:'4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',dex:'https://dexscreener.com/solana/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'},
      {id:'pyth-network',s:'PYTH',n:'Pyth Network',c:'Solana',a:'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',cg:'pyth-network',chain:'solana',addr:'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',dex:'https://dexscreener.com/solana/HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'},
      {id:'render-token',s:'RENDER',n:'Render',c:'Solana',a:'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',cg:'render-token',chain:'solana',addr:'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',dex:'https://dexscreener.com/solana/rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof'},
      {id:'chainlink',s:'LINK',n:'Chainlink',c:'Ethereum',a:'0x514910771AF9Ca656af840dff83E8264EcF986CA',cg:'chainlink',chain:'ethereum',addr:'0x514910771AF9Ca656af840dff83E8264EcF986CA',dex:'https://dexscreener.com/ethereum/0x514910771AF9Ca656af840dff83E8264EcF986CA'},
      {id:'arbitrum',s:'ARB',n:'Arbitrum',c:'Arbitrum',a:'0x912CE59144191C1204E64559FE8253a0e49E6548',cg:'arbitrum',chain:'arbitrum',addr:'0x912CE59144191C1204E64559FE8253a0e49E6548',dex:'https://dexscreener.com/arbitrum/0x912CE59144191C1204E64559FE8253a0e49E6548'},
      {id:'optimism',s:'OP',n:'Optimism',c:'Optimism',a:'0x4200000000000000000000000000000000000042',cg:'optimism',chain:'optimism',addr:'0x4200000000000000000000000000000000000042',dex:'https://dexscreener.com/optimism'},
      {id:'avalanche-2',s:'AVAX',n:'Avalanche',c:'Avalanche',a:'Native AVAX',cg:'avalanche-2',chain:'avalanche',addr:'Native',dex:'https://dexscreener.com/avalanche'},
      {id:'aave',s:'AAVE',n:'Aave',c:'Ethereum',a:'0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAe9',cg:'aave',chain:'ethereum',addr:'0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAe9',dex:'https://dexscreener.com/ethereum/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAe9'}
    ];

    const dumpCoins = [
      {symbol:'HYPE', cg:'hyperliquid', chain:'hyperliquid', addr:'Native'},
      {symbol:'ONDO', cg:'ondo', chain:'ethereum', addr:'0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3'},
      {symbol:'SUI', cg:'sui', chain:'sui', addr:'Native'},
      {symbol:'LINK', cg:'chainlink', chain:'ethereum', addr:'0x514910771AF9Ca656af840dff83E8264EcF986CA'},
      {symbol:'AAVE', cg:'aave', chain:'ethereum', addr:'0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAe9'},
      {symbol:'INJ', cg:'injective-protocol', chain:'injective', addr:'Native'},
      {symbol:'PENDLE', cg:'pendle', chain:'ethereum', addr:'0x808507121B80c02388fAd14726482e061B8da827'},
      {symbol:'TAO', cg:'bittensor', chain:'bittensor', addr:'Native'},
      {symbol:'NEAR', cg:'near', chain:'near', addr:'Native'},
      {symbol:'TIA', cg:'celestia', chain:'celestia', addr:'Native'},
      {symbol:'SEI', cg:'sei-network', chain:'sei', addr:'Native'},
      {symbol:'JUP', cg:'jupiter-exchange-solana', chain:'solana', addr:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'},
      {symbol:'RUNE', cg:'thorchain', chain:'thorchain', addr:'Native'},
      {symbol:'ARB', cg:'arbitrum', chain:'arbitrum', addr:'0x912CE59144191C1204E64559FE8253a0e49E6548'},
      {symbol:'OP', cg:'optimism', chain:'optimism', addr:'0x4200000000000000000000000000000000000042'},
      {symbol:'ZRO', cg:'layerzero', chain:'ethereum', addr:'0x6985884C4392D348587B19cb9eAAf157F13271cd'},
      {symbol:'PYTH', cg:'pyth-network', chain:'solana', addr:'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'},
      {symbol:'ENA', cg:'ena', chain:'ethereum', addr:'0x57e114B691Db790C35207b2e685D4A43181e6061'},
      {symbol:'WIF', cg:'dogwifcoin', chain:'solana', addr:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'},
      {symbol:'BONK', cg:'bonk', chain:'solana', addr:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'},
      {symbol:'FLOKI', cg:'floki', chain:'ethereum', addr:'0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E'},
      {symbol:'PEPE', cg:'pepe', chain:'ethereum', addr:'0x6982508145454Ce325dDbE47a25d4ec3d2311933'},
      {symbol:'JASMY', cg:'jasmy', chain:'ethereum', addr:'0x7420B4b9a0110cdC71fB720908340C03F9Bc03EC'},
      {symbol:'HBAR', cg:'hedera-hashgraph', chain:'hedera', addr:'Native'},
      {symbol:'XLM', cg:'stellar', chain:'stellar', addr:'Native'},
      {symbol:'ADA', cg:'cardano', chain:'cardano', addr:'Native'},
      {symbol:'AVAX', cg:'avalanche-2', chain:'avalanche', addr:'Native'},
      {symbol:'APT', cg:'aptos', chain:'aptos', addr:'Native'},
      {symbol:'ATOM', cg:'cosmos', chain:'cosmos', addr:'Native'},
      {symbol:'FIL', cg:'filecoin', chain:'filecoin', addr:'Native'},
      {symbol:'ICP', cg:'internet-computer', chain:'internet-computer', addr:'Native'},
      {symbol:'FET', cg:'fetch-ai', chain:'ethereum', addr:'0xaea46A60368A7Db0442f9926649aB438D1819d9a'},
      {symbol:'AKT', cg:'akash-network', chain:'cosmos', addr:'Native'},
      {symbol:'IMX', cg:'immutable-x', chain:'ethereum', addr:'0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF'},
      {symbol:'GRT', cg:'the-graph', chain:'ethereum', addr:'0xc944E90C64B2c07662A292be6244BDf05Cda44a7'},
      {symbol:'OMI', cg:'ecomi', chain:'multichain', addr:'Identity check required', chart:'https://www.coingecko.com/en/coins/ecomi'},
      {symbol:'PLUME', cg:'plume', chain:'plume', addr:'Native'},
      {symbol:'LTC', cg:'litecoin', chain:'litecoin', addr:'Native'},
      {symbol:'ALGO', cg:'algorand', chain:'algorand', addr:'Native'},
      {symbol:'ZEN', cg:'zen', chain:'zen', addr:'Native'},
      {symbol:'ROSE', cg:'oasis-network', chain:'oasis', addr:'Native'},
      {symbol:'MATIC', cg:'matic-network', chain:'polygon', addr:'0x0000000000000000000000000000000000001010'},
      {symbol:'XRP', cg:'ripple', chain:'xrp-ledger', addr:'Native', chart:'https://www.coingecko.com/en/coins/xrp'},
      {symbol:'AXL', cg:'axelar', chain:'axelar', addr:'Native', chart:'https://www.coingecko.com/en/coins/axelar'},
      {symbol:'AR', cg:'arweave', chain:'arweave', addr:'Native', chart:'https://www.coingecko.com/en/coins/arweave'},
      {symbol:'STX', cg:'blockstack', chain:'stacks', addr:'Native', chart:'https://www.coingecko.com/en/coins/stacks'},
      {symbol:'KAS', cg:'kaspa', chain:'kaspa', addr:'Native', chart:'https://www.coingecko.com/en/coins/kaspa'},
      {symbol:'METIS', cg:'metis-token', chain:'metis', addr:'Native', chart:'https://www.coingecko.com/en/coins/metis-token'},
      {symbol:'BNB', cg:'binancecoin', chain:'bnb', addr:'Native', chart:'https://www.coingecko.com/en/coins/bnb'},
      {symbol:'DOGE', cg:'dogecoin', chain:'dogecoin', addr:'Native', chart:'https://www.coingecko.com/en/coins/dogecoin'},
      {symbol:'TRX', cg:'tron', chain:'tron', addr:'Native', chart:'https://www.coingecko.com/en/coins/tron'},
      {symbol:'DOT', cg:'polkadot', chain:'polkadot', addr:'Native', chart:'https://www.coingecko.com/en/coins/polkadot'},
      {symbol:'BCH', cg:'bitcoin-cash', chain:'bitcoin-cash', addr:'Native', chart:'https://www.coingecko.com/en/coins/bitcoin-cash'},
      {symbol:'ETC', cg:'ethereum-classic', chain:'ethereum-classic', addr:'Native', chart:'https://www.coingecko.com/en/coins/ethereum-classic'},
      {symbol:'UNI', cg:'uniswap', chain:'ethereum', addr:'0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', chart:'https://www.coingecko.com/en/coins/uniswap'},
      {symbol:'XMR', cg:'monero', chain:'monero', addr:'Native', chart:'https://www.coingecko.com/en/coins/monero'},
      {symbol:'TON', cg:'the-open-network', chain:'ton', addr:'Native', chart:'https://www.coingecko.com/en/coins/toncoin'},
      {symbol:'SHIB', cg:'shiba-inu', chain:'ethereum', addr:'0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', chart:'https://www.coingecko.com/en/coins/shiba-inu'},
      {symbol:'BTC', cg:'bitcoin', chain:'bitcoin', addr:'Native'},
      {symbol:'ETH', cg:'ethereum', chain:'ethereum', addr:'Native'}
    ];

    const checkerCoins = [...dumpCoins];
    deep.forEach(item => {
      if (!checkerCoins.some(existing => existing.cg === item.cg)) {
        checkerCoins.push({symbol:item.s, cg:item.cg, chain:item.chain, addr:item.addr, chart:item.dex});
      }
    });
    const ids = checkerCoins.map(x => x.cg);
    const BLUE_CHIPS = new Set(['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','TRX','LINK','AVAX','DOT','LTC','BCH','XMR','TON','SHIB']);
    const CHAIN_LANES = Object.freeze([
      {key:'ethereum', api:'eth', name:'ETHEREUM', gas:'ETH', wallet:'RABBY'},
      {key:'solana', api:'solana', name:'SOLANA', gas:'SOL', wallet:'PHANTOM'},
      {key:'bnb', api:'bsc', name:'BNB CHAIN', gas:'BNB', wallet:'RABBY'},
      {key:'robinhood', api:'robinhood', name:'ROBINHOOD CHAIN', gas:'ETH', wallet:'ROBINHOOD / RABBY'},
      {key:'arbitrum', api:'arbitrum', name:'ARBITRUM', gas:'ETH', wallet:'RABBY'},
      {key:'optimism', api:'optimism', name:'OPTIMISM', gas:'ETH', wallet:'RABBY'},
      {key:'polygon', api:'polygon_pos', name:'POLYGON', gas:'POL', wallet:'RABBY'},
      {key:'avalanche', api:'avax', name:'AVALANCHE', gas:'AVAX', wallet:'RABBY'}
    ]);
    const CHAIN_POOL_REFRESH_MS = 10 * 60 * 1000;
    const CHAIN_REQUEST_GAP_MS = 8000;
    const CHAIN_POOL_MIN_LIQUIDITY_USD = 25000;
    // Public network-pool pagination is bounded by the provider, not a 25-token UI cap.
    const CHAIN_PUBLIC_PAGES = 10;
    const CHAIN_PAGE_SIZE = 20;
    const chainDiscovery = new Map();
    let chainDiscoveryCursor = 0, chainDiscoveryBackoffUntil = 0, chainEvidenceDueAt = 0;
    const STABLE_SYMBOLS = new Set(['USDT','USDC','USDE','DAI','FDUSD','TUSD','USDS','FRAX','LUSD','PYUSD','EURC','USDG','RLUSD','GHO','USDT0','USD1','USR','DEUSD','USDF','USDB','DOLA','MIM','CRVUSD','USDP','USDD']);
    function readSavedOrders() {
      try {
        const parsed = JSON.parse(localStorage.getItem('seaChefOrders') || '[]');
        return Array.isArray(parsed) ? parsed.filter(o => o && typeof o === 'object' && typeof o.id === 'string') : [];
      } catch (_) { return []; }
    }
    function readPumpDumpExclusions() {
      try {
        const values=JSON.parse(localStorage.getItem('seaChefPumpDumpExclusions') || '[]');
        return new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string' && value.length <= 180) : []);
      } catch (_) { return new Set(); }
    }
    let pumpDumpExclusions=readPumpDumpExclusions();
    const MARKET_SNAPSHOT_KEY='seaChefLastMarketSnapshotV1', MARKET_SNAPSHOT_MAX_AGE=6*60*60*1000;
    let market = [], marketReceivedAt = 0, active = deep.slice(0, 8).map(x => x.id), orders = readSavedOrders(), sessionBaseline = {}, priceSamples = {}, chainPools = {}, chainPoolsUpdatedAt = {}, chainRefreshInFlight = false, chainLastRequestAt = 0, chainRetryTimer = null;
    const $ = id => document.getElementById(id);
    const money = p => displayCoinPrice(p);
    const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

    // WATCH pins display identity only. It never changes qualification or order checks.
    function validatedWatchRow(row) {
      if (!row || !['named','chain'].includes(row.kind) || typeof row.key!=='string') return null;
      if (!/^[A-Z0-9._-]{1,20}$/.test(row.symbol || '')) return null;
      if (!Number.isFinite(row.price) || row.price<=0) return null;
      let chain,contract,chart;
      if (row.kind==='named') {
        const item=checkerCoins.find(item=>item.cg===row.key);
        if (!item || item.symbol!==row.symbol) return null;
        chain=String(item.chain || 'MARKET').toUpperCase(); contract=String(item.addr || '');
        chart=`https://www.coingecko.com/en/coins/${encodeURIComponent(row.key)}`;
      } else {
        const lane=CHAIN_LANES.find(lane=>row.key.startsWith(lane.api+':'));
        if (!lane || !validTokenAddress(lane,String(row.contract || ''))) return null;
        contract=String(row.contract);
        if (row.key!==lane.api+':'+(lane.api==='solana'?contract:contract.toLowerCase())) return null;
        let url; try { url=new URL(row.chart); } catch (_) { return null; }
        const parts=url.pathname.split('/');
        if(url.origin!=='https://www.geckoterminal.com' || parts.length!==4 || parts[1]!==lane.api || parts[2]!=='pools' || !validPoolAddress(lane,parts[3])) return null;
        chain=lane.name; chart=`https://www.geckoterminal.com/${lane.api}/pools/${parts[3]}?locale=en`;
      }
      return {kind:row.kind,key:row.key,symbol:row.symbol,chain,contract,chart,
        venue:String(row.venue || '').slice(0,100),price:row.price,
        change:typeof row.change==='number' && Number.isFinite(row.change)?row.change:null,
        state:'checking',rating:0,
        savedAt:Number.isFinite(row.savedAt) && row.savedAt>0 && row.savedAt<=Date.now()?row.savedAt:null};
    }
    function readWatchedRows() {
      try {
        const list=JSON.parse(localStorage.getItem('seaChefWatchedDumpOpps') || '[]');
        return new Map((Array.isArray(list)?list:[]).map(validatedWatchRow).filter(Boolean).map(row=>[row.key,row]));
      } catch (_) { return new Map(); }
    }
    const watchedDumpRows=readWatchedRows();
    const DUMP_ENTRY_STATE_KEY='seaChefDumpEntryStateV1', DUMP_NEW_MS=24*60*60*1000;
    function readDumpEntryState() {
      try {
        const parsed=JSON.parse(localStorage.getItem(DUMP_ENTRY_STATE_KEY)||'null');
        if(!parsed || parsed.version!==1 || !Array.isArray(parsed.active) || !parsed.newUntil || typeof parsed.newUntil!=='object') return {version:1,initialised:false,active:[],newUntil:{}};
        const active=parsed.active.filter(key=>typeof key==='string'&&key.length<=180).slice(0,500);
        const newUntil={};
        Object.entries(parsed.newUntil).slice(0,2500).forEach(([key,value])=>{ if(typeof key==='string'&&key.length<=180&&Number.isFinite(value)&&value>0) newUntil[key]=value; });
        return {version:1,initialised:Boolean(parsed.initialised),active:[...new Set(active)],newUntil};
      } catch(_) { return {version:1,initialised:false,active:[],newUntil:{}}; }
    }
    let dumpEntryState=readDumpEntryState();
    function updateDumpEntryState(rows,dataReady,now=Date.now()) {
      if(!dataReady) return;
      const keys=[...new Set(rows.map(row=>row.key).filter(key=>typeof key==='string'&&key.length<=180))];
      if(!dumpEntryState.initialised) {
        dumpEntryState={version:1,initialised:true,active:keys,newUntil:Object.fromEntries(keys.map(key=>[key,now]))};
      } else {
        const previous=new Set(dumpEntryState.active);
        const newUntil={};
        Object.entries(dumpEntryState.newUntil).forEach(([key,until])=>{ if(Number.isFinite(until)&&until>0) newUntil[key]=until; });
        keys.forEach(key=>{ if(!previous.has(key) && !watchedDumpRows.has(key) && !Object.prototype.hasOwnProperty.call(newUntil,key)) newUntil[key]=now+DUMP_NEW_MS; });
        dumpEntryState={version:1,initialised:true,active:keys,newUntil};
      }
      try { localStorage.setItem(DUMP_ENTRY_STATE_KEY,JSON.stringify(dumpEntryState)); } catch(_) {}
    }
    function isNewDumpEntry(key,now=Date.now()) { return Number(dumpEntryState.newUntil?.[key])>now; }
    function persistWatchedRows(rows=watchedDumpRows) {
      try { localStorage.setItem('seaChefWatchedDumpOpps',JSON.stringify([...rows.values()])); return true; }
      catch (_) { return false; }
    }
    function toggleDumpWatch(key) {
      const next=new Map(watchedDumpRows);
      if(next.has(key)) next.delete(key);
      else {
        const row=validatedWatchRow({...visibleTradeRows.get(key),savedAt:Date.now()});
        if(!row) return alert('This coin identity cannot be pinned. Nothing changed.');
        next.set(key,row);
      }
      if(!persistWatchedRows(next)) return alert('Your browser could not save WATCH. Free some browser storage and try again.');
      watchedDumpRows.clear(); next.forEach((row,key)=>watchedDumpRows.set(key,row));
    }
    function retainWatchedRows(currentRows) {
      const live=new Map(currentRows.map(row=>[row.key,row]));
      let changed=false;
      const pinned=[...watchedDumpRows.values()].map(saved=>{
        const current=live.get(saved.key);
        // A symbol alone must never redirect a pin to a different token or pool.
        const clean=current && validatedWatchRow({...current,savedAt:Date.now()});
        if(clean && clean.contract===saved.contract && clean.chart===saved.chart) {
          watchedDumpRows.set(saved.key,clean); changed=true; return current;
        }
        return {...saved};
      });
      if(changed) persistWatchedRows();
      return pinned;
    }

    function shortAddressMarkup(value) {
      const full=String(value || '');
      const isAddress=/^0x[a-fA-F0-9]{40}$/.test(full) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(full);
      return isAddress ? `<span title="${escapeHTML(full)}">${escapeHTML(full.slice(0,6))}...${escapeHTML(full.slice(-4))}</span>` : escapeHTML(full);
    }
    function coin(id) { return deep.find(x => x.id === id); }
    function price(id) { return market.find(x => x.id === id); }
    function save() { localStorage.setItem('seaChefOrders', JSON.stringify(orders)); }
    function next() { return deep.find(x => !active.includes(x.id) && !orders.some(o => o.id === x.id)); }
    function signalForChange(change) { if (change < 0) return 'red'; if (change > 0) return 'green'; return 'flat'; }
    function textForSignal(change) { if (change < 0) return 'Red'; if (change > 0) return 'Green'; return 'Neutral'; }
    function finiteChange(value) { return value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
    function pumpDumpKeyForRow(row) {
      if (!row || typeof row.key !== 'string') return null;
      if (row.kind === 'chain') return 'chain:'+row.key;
      const item=checkerCoins.find(candidate => candidate.cg === row.key);
      if (!item) return 'named:'+row.key;
      const address=String(item.addr || '').trim();
      const identity=/^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : address;
      return 'named:'+String(item.chain || 'market').toLowerCase()+':'+identity+':'+row.key;
    }
    function contractIdentityForRow(row) {
      if (!row) return null;
      if (row.kind === 'chain') return typeof row.contract === 'string' && row.contract ? row.contract : null;
      const item=checkerCoins.find(candidate => candidate.cg === row.key);
      if (!item) return null;
      const address=String(item.addr || '').trim();
      if (!address || address === 'Native' || /^Native\b/i.test(address)) return null;
      return /^0x[a-fA-F0-9]{40}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
    }
    async function copyContractAddress(address,button) {
      if (!address || !(/^0x[a-fA-F0-9]{40}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))) return alert('A verified contract address is unavailable.');
      try {
        await navigator.clipboard.writeText(address);
        const old=button.textContent; button.textContent='COPIED'; setTimeout(()=>button.textContent=old,1200);
      } catch (_) { window.prompt('Copy this exact contract address:',address); }
    }
    function contractMarkup(row) {
      const address=contractIdentityForRow(row);
      if (!address) return `<div class="contract-box"><span class="trade-note">CONTRACT</span><code>Native asset - no token contract</code></div>`;
      return `<div class="contract-box"><span class="trade-note">EXACT CONTRACT / MINT</span><code>${escapeHTML(address)}</code><button type="button" class="copy-contract" data-copy-contract="${escapeHTML(address)}">COPY CONTRACT</button></div>`;
    }
    function savePumpDumpExclusions() {
      localStorage.setItem('seaChefPumpDumpExclusions',JSON.stringify([...pumpDumpExclusions].sort()));
      const count=$('pndRemovedCount');
      if (count) count.textContent=pumpDumpExclusions.size+' removed from Dump opps';
    }
    function restorePumpDumpCoins() {
      if (!pumpDumpExclusions.size) return alert('No Pump & Dump removals are saved.');
      if (!confirm('Restore every coin you removed from Dump opps?')) return;
      pumpDumpExclusions.clear(); savePumpDumpExclusions(); buildBuySetups();
    }
    function freshMarketItem(m, now = Date.now()) {
      if (!m || m._scl_cached===true || !Number.isFinite(Number(m.current_price)) || Number(m.current_price) <= 0) return false;
      const observedAt = new Date(m.last_updated).getTime();
      return Number.isFinite(observedAt) && now >= observedAt && now - observedAt <= 120000;
    }
    function validMarketRows(rows,cached=false) {
      if(!Array.isArray(rows))return [];
      const allowed=new Set(ids);
      return rows.filter(m=>m&&typeof m.id==='string'&&allowed.has(m.id)&&typeof m.symbol==='string'&&/^[a-z0-9._-]{1,30}$/i.test(m.symbol)&&Number.isFinite(Number(m.current_price))&&Number(m.current_price)>0)
        .slice(0,ids.length).map(m=>({...m,_scl_cached:cached}));
    }
    function saveMarketSnapshot(rows) {
      try {localStorage.setItem(MARKET_SNAPSHOT_KEY,JSON.stringify({version:1,savedAt:Date.now(),rows:rows.map(({_scl_cached,...m})=>m)}));} catch(_) {}
    }
    function restoreMarketSnapshot() {
      try {
        const saved=JSON.parse(localStorage.getItem(MARKET_SNAPSHOT_KEY)||'null');
        if(!saved||saved.version!==1||!Number.isFinite(saved.savedAt)||saved.savedAt>Date.now()||Date.now()-saved.savedAt>MARKET_SNAPSHOT_MAX_AGE)return false;
        const rows=validMarketRows(saved.rows,true);if(!rows.length)return false;
        market=rows;marketReceivedAt=0;renderTickerPrices();render();buildBuySetups();
        $('tickerStatus').textContent=`Last saved prices ${localClock(saved.savedAt)} - refreshing now`;
        return true;
      } catch(_) {return false;}
    }
    function newestFeedTime(items = market) {
      const times = items.map(item => new Date(item.last_updated).getTime()).filter(Number.isFinite);
      return times.length ? Math.max(...times) : null;
    }
    function localClock(milliseconds) {
      return Number.isFinite(milliseconds) ? new Date(milliseconds).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : 'unknown';
    }
    const deskSamples = new Map();
    function recordDeskSample(key,value,at) {
      const now = Date.now();
      if (typeof key !== 'string' || !Number.isFinite(value) || value <= 0 || !Number.isFinite(at) || at > now || now-at > 20*60*1000) return;
      const list = deskSamples.get(key) || [];
      if (list.length && at <= list[list.length-1].at) return;
      deskSamples.set(key,[...list,{price:value,at}].slice(-32));
    }
    function watchlistBreadth(now=Date.now()) {
      const unique = [...new Set(ids)];
      let up=0,down=0,flat=0,unknown=0;
      const feedCurrent = Number.isFinite(marketReceivedAt) && marketReceivedAt > 0 && now >= marketReceivedAt && now-marketReceivedAt <= 120000;
      unique.forEach(id => {
        const item = price(id), change = finiteChange(item?.price_change_percentage_24h);
        const usable = feedCurrent && item && Number.isFinite(Number(item.current_price)) && Number(item.current_price)>0 && change !== null;
        if (!usable) unknown++;
        else if (change>0) up++;
        else if (change<0) down++;
        else flat++;
      });
      return {up,down,flat,unknown,total:unique.length,measured:up+down+flat,feedCurrent};
    }
    function snapshotBucket(row,now=Date.now()) {
      const q=qualificationState(row,now);
      if(['risk','excluded','drop','falling','inactive'].includes(q.stage)) return 'failed';
      if(q.stage==='freshness') return null;
      // Recovery is progress, not a complete qualification pass or buy instruction.
      if(q.stage==='recovery') return 'qualified';
      const candles=chartCandles(row,now);
      const last=candles?.rows.slice(-4);
      if(last?.length===4 && last.every((c,i)=>c.volume>0 && (!i||c.at-last[i-1].at===900000))) {
        const hi=Math.max(...last.map(c=>c.high)),lo=Math.min(...last.map(c=>c.low));
        if((hi-lo)/lo<=0.005) return 'static';
      }
      return null;
    }
    function refreshMarketPulse() {
      if(!$('snapshotFailed')) return;
      const counts={failed:0,qualified:0,static:0},rows=[...visibleTradeRows.values()];
      for(const row of rows) {const bucket=snapshotBucket(row);if(bucket)counts[bucket]++;}
      $('snapshotFailed').textContent=String(counts.failed);
      $('snapshotQualified').textContent=String(counts.qualified);
      $('snapshotStatic').textContent=String(counts.static);
      const uncounted=rows.length-counts.failed-counts.qualified-counts.static;
      $('pulseCoverage').textContent=rows.length+' coins in your windows'+(uncounted?' | '+uncounted+' not counted yet':'');
    }
    function compactState(row,now=Date.now()) {
      const q=qualificationState(row,now);
      const names={freshness:'DATA NEEDED',drop:'OUTSIDE DROP RULE',samples:'WATCHING',falling:'STILL FALLING',rising:'RISING SAMPLES',level:'LEVEL SAMPLES',mixed:'MIXED MOVES',evidence:'WATCH | CHECKS NEEDED',inactive:'WAIT | QUIET MARKET',recovery:'WATCH | RECOVERY SEEN',risk:'AVOID | REPORTED RESTRICTION',excluded:'EXCLUDED'};
      return {q,label:names[q.stage] || 'WATCHING',tone:q.stage || 'freshness'};
    }
    function recoveryPriority(row) {
      const q=qualificationState(row);
      return {recovery:0,rising:1,level:2,mixed:3,samples:4,evidence:4,falling:5,inactive:6,drop:7,freshness:8}[q.stage] ?? 8;
    }
    function compareDeskRows(a,b) {
      return recoveryPriority(a)-recoveryPriority(b) || a.symbol.localeCompare(b.symbol) || a.key.localeCompare(b.key);
    }
    function chartLink(row) {
      const match=evidencePool(row);
      if(match && /^https:\/\/www\.geckoterminal\.com\/[a-z0-9_-]+\/pools\/[a-zA-Z0-9_-]+\?locale=en$/.test(match.pool.chart)) return {url:match.pool.chart,label:'Open chart'};
      if(row.kind==='chain' && /^https:\/\/www\.geckoterminal\.com\/[a-z0-9_-]+\/pools\/[a-zA-Z0-9_-]+\?locale=en$/.test(String(row.chart||''))) return {url:row.chart,label:'Open chart'};
      if(row.kind==='named' && checkerCoins.some(c=>c.cg===row.key)) return {url:'https://www.coingecko.com/en/coins/'+encodeURIComponent(row.key),label:'Open coin chart'};
      return null;
    }
    const candleIntervals=Object.freeze({'15m':{step:900000,label:'15-minute'},'4h':{step:14400000,label:'4-hour'},'3d':{step:259200000,label:'3-day'}});
    const selectedCandleIntervals=new Map();
    function validChartBars(rows,step,now) {
      return Array.isArray(rows) && rows.length<=1000 && rows.every((c,i)=>c&&[c.at,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&Number.isSafeInteger(c.at)&&c.at>0&&c.at%step===0&&c.at+step<=now&&c.volume>=0&&Math.min(c.open,c.high,c.low,c.close)>0&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close,c.high)&&(!i||c.at>rows[i-1].at));
    }
    function aggregateChartHours(hours,step,now=Date.now()) {
      if(![14400000,259200000].includes(step)||!validChartBars(hours,3600000,now))return [];
      const groups=new Map(),count=step/3600000,result=[];
      // Fixed UTC buckets anchored to 1970-01-01. Missing hours never become invented candles.
      for(const c of hours){const at=Math.floor(c.at/step)*step;if(!groups.has(at))groups.set(at,[]);groups.get(at).push(c);}
      for(const [at,bars] of groups){
        if(at+step>now||bars.length!==count||!bars.every((c,i)=>c.at===at+i*3600000))continue;
        const volume=bars.reduce((n,c)=>n+c.volume,0);if(!Number.isFinite(volume))continue;
        result.push({at,open:bars[0].open,high:Math.max(...bars.map(c=>c.high)),low:Math.min(...bars.map(c=>c.low)),close:bars[bars.length-1].close,volume});
      }
      return result;
    }
    function chartCandles(row,now=Date.now(),interval='15m') {
      const settings=candleIntervals[interval];if(!settings)return null;
      const match=evidencePool(row);if(!match) return null;
      const e=poolCandleEvidence.get(candleEvidenceKey(match.lane,match.pool));
      if(!e || e.observedAt<marketWakeAt || now<e.observedAt || now-e.observedAt>20*60000)return null;
      const source=interval==='15m'?e.quarter:aggregateChartHours(e.hour,settings.step,now);
      if(!validChartBars(source,settings.step,now))return null;
      const rows=source.slice(-48);
      if(rows.length<2||now-(rows[rows.length-1].at+settings.step)>settings.step)return null;
      return {rows,observedAt:e.observedAt,match,step:settings.step,interval,label:settings.label};
    }
    function chartIntervalControls(row,interval) {
      return `<div class="candle-actions candle-intervals" role="group" aria-label="${escapeHTML(row.symbol)} candle length">${Object.keys(candleIntervals).map(key=>`<button type="button" class="btn" data-candle-key="${escapeHTML(row.key)}" data-candle-interval="${key}" aria-pressed="${key===interval}">${key==='3d'?'3 days':key}</button>`).join('')}</div>`;
    }
    // Official embed route: https://about.geckoterminal.com/embed-charts
    // One on-demand frame, outside card rerenders. No iframe load event qualifies a coin.
    function poolEmbedURL(row) {
      const match=evidencePool(row),link=chartLink(row);
      if(!match || !link || link.url!==match.pool.chart)return null;
      const url=new URL(link.url);
      url.searchParams.set('embed','1');url.searchParams.set('info','0');url.searchParams.set('swaps','0');
      url.searchParams.set('light_chart','0');url.searchParams.set('chart_type','price');url.searchParams.set('bg_color','100d18');
      return url.href;
    }
    function openPoolChart(key) {
      const row=visibleTradeRows.get(key),url=row&&poolEmbedURL(row);
      if(!url)return;
      const dialog=$('poolChartDialog'),link=chartLink(row);
      if(typeof dialog.showModal!=='function'){window.open(link.url,'_blank','noopener,noreferrer');return;}
      $('poolChartTitle').textContent=row.symbol+' | '+row.chain+' | Pool chart';
      $('poolChartExternal').href=link.url;
      if($('poolChartFrame').getAttribute('src')!==url)$('poolChartFrame').src=url;
      if(!dialog.open)dialog.showModal();
    }
    function closePoolChart() {
      const dialog=$('poolChartDialog');if(dialog.open)dialog.close();
      $('poolChartFrame').removeAttribute('src');
    }
    function sampleChartMarkup(row) {
      const interval=selectedCandleIntervals.get(row.key)||'15m';
      const controls=chartIntervalControls(row,interval),data=chartCandles(row,Date.now(),interval),link=chartLink(row);
      const action=link?`<span class="candle-actions">${poolEmbedURL(row)?`<button type="button" class="btn candle-link" data-pool-chart="${escapeHTML(row.key)}">View chart</button>`:''}<a class="btn candle-link" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">${link.label}</a></span>`:'<span class="trade-note">Exact chart link unavailable</span>';
      if(!data)return `${controls}<div class="candle-empty"><span class="trade-note">${candleIntervals[interval].label} candles need fresh, complete history.</span>${action}</div>`;
      const rows=data.rows,low=Math.min(...rows.map(c=>c.low)),high=Math.max(...rows.map(c=>c.high));
      const padding=Math.max((high-low)*.08,high*.0001),lo=low-padding,hi=high+padding;
      const y=v=>12+(hi-v)/(hi-lo)*100,first=rows[0].at,last=rows[rows.length-1].at;
      const x=t=>10+(t-first)/(last-first)*296,width=Math.max(1,Math.min(7,296*data.step/(last-first)*.65));
      const bodies=rows.map(c=>{const top=y(Math.max(c.open,c.close)),bottom=y(Math.min(c.open,c.close)),colour=c.close>=c.open?'#8ddbd5':'#e7a0af';return `<g stroke="${colour}" stroke-width="1.25"><line x1="${x(c.at)}" x2="${x(c.at)}" y1="${y(c.high)}" y2="${y(c.low)}"/><rect x="${x(c.at)-width/2}" y="${top}" width="${width}" height="${Math.max(.8,bottom-top)}" fill="none"/></g>`;}).join('');
      return `${controls}<svg class="hollow-chart" viewBox="0 0 320 124" role="img" aria-label="${escapeHTML(row.symbol)}: exact pool, closed ${data.label} candles in USD"><path d="M6 114H314" stroke="#39323f"/>${bodies}</svg><div class="candle-caption"><span>${interval==='3d'?'3-day':interval} closed | USD | ${escapeHTML(new Date(first).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))} - ${escapeHTML(new Date(last+data.step).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</span>${action}</div><div class="trade-note candle-key">Hollow candles: aqua closed higher, rose lower. Chart colours are price direction, not buy approval.</div>`;
    }
    function compactFreshness(row) {
      let at=null;
      if(row.kind==='named') at=new Date(price(row.key)?.last_updated).getTime();
      else { const lane=CHAIN_LANES.find(l=>(chainPools[l.key]||[]).some(p=>p.identity===row.key)); if(lane) at=chainPools[lane.key].find(p=>p.identity===row.key)?.observedAt; }
      if(!Number.isFinite(at)||Date.now()<at) return watchedDumpRows.has(row.key)?'WATCHING | Last saved price - fresh data unavailable':'Observation time unavailable';
      const seconds=Math.floor((Date.now()-at)/1000);
      const age=seconds<60?seconds+'s':Math.floor(seconds/60)+'m';
      return (row.kind==='chain'?'Feed received ':'Price observed ')+age+' ago';
    }
    // The neutral dot reflects actual public-price requests, never buy qualification.
    let marketWakeAt=0,lastHiddenAt=0,lastWakeAttempt=0,wakePromise=null;
    const sonarFeeds=new Map();
    function rowRefreshedSinceWake(row) {
      if(!marketWakeAt)return true;
      if(row?.kind==='named')return marketReceivedAt>=marketWakeAt;
      const m=evidencePool(row);return Boolean(m&&m.pool.observedAt>=marketWakeAt);
    }
    function sonarLabel(scope) {
      if(scope==='watchlist')return 'Watchlist prices';
      if(scope==='evidence')return 'Public risk and quote checks';
      const api=scope.replace('candles:',''),lane=CHAIN_LANES.find(l=>l.api===api);
      return (lane?.name||'Market')+(scope.startsWith('candles:')?' candles':' prices');
    }
    function sonarActivity(scope,delta) {
      const state=sonarFeeds.get(scope)||{phase:'idle',at:0};
      if(delta>0 && (activePriceChecks.get(scope)||0)===1){state.phase='running';state.accepted=false;}
      if(delta<0 && !(activePriceChecks.get(scope)||0))state.phase=state.accepted?'received':'unavailable';
      sonarFeeds.set(scope,state);refreshSonar();
    }
    function sonarFresh(scope,ids=[]) {
      const state=sonarFeeds.get(scope)||{};state.accepted=true;state.at=Date.now();
      state.phase=(activePriceChecks.get(scope)||0)>0?'running':'received';sonarFeeds.set(scope,state);
      if(!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for(const id of ids){const box=$(id);box?.animate?.([{outline:'1px solid transparent',outlineOffset:'0px'},{outline:'2px solid #85d7d1',outlineOffset:'3px'},{outline:'1px solid transparent',outlineOffset:'5px'}],{duration:1600,easing:'ease-out'});}
      }
      refreshSonar();
    }
    function refreshSonar() {
      const button=$('sonarWake'),status=$('sonarStatus'),details=$('sonarFeeds');if(!button||!status)return;
      const busy=!document.hidden&&activePriceChecks.size>0;
      button.classList.toggle('sonar-busy',busy);button.setAttribute('aria-busy',String(busy));
      const entries=[...sonarFeeds],received=entries.filter(([,v])=>v.phase==='received').length;
      status.textContent=document.hidden?'Paused while closed':busy?'Waking your market...':received?received+' feeds updated | tap to refresh':'Tap to wake my market';
      if(details)details.innerHTML=entries.length?entries.map(([key,v])=>`<div class="sonar-feed"><span>${escapeHTML(sonarLabel(key))}</span><span>${document.hidden&&v.phase==='running'?'Paused':v.phase==='running'?'Receiving...':v.phase==='received'?'Updated '+escapeHTML(localClock(v.at)):'Unavailable / waiting'}</span></div>`).join(''):'No requests yet.';
    }
    async function wakeMarket() {
      if(document.hidden)return;
      if(wakePromise)return wakePromise;
      if(Date.now()-lastWakeAttempt<15000)return;
      lastWakeAttempt=Date.now();marketWakeAt=Date.now();sonarFeeds.clear();
      // Keep owner pins, plans, positions and negative risk findings. Invalidate old positives.
      routeEvidence.clear();priceSamples={};gaugeSamples.clear();
      for(const [key,value] of securityEvidence)if(!value.critical)securityEvidence.delete(key);
      for(const lane of CHAIN_LANES){const state=discoveryState(lane);if(['WAITING','SCANNING','END OF AVAILABLE PAGES','PUBLIC PAGE LIMIT'].includes(state.status)){state.nextAt=0;state.nextPage=1;}}
      chainEvidenceDueAt=0;refreshQualificationGauges();refreshSonar();
      $('refreshStatus').textContent='Waking your market | fresh checks first';
      wakePromise=(async()=>{
        // Existing locks and provider backoffs are retained. No duplicate scans.
        await Promise.allSettled([(async()=>{await load();if(marketReceivedAt<marketWakeAt && !document.hidden&&Date.now()>=feedRetryAt)await load();})()]);
        // Slower chain/security checks continue without holding the visible refresh.
        setTimeout(()=>{if(!document.hidden)void refreshChainPools();},500);
        buildBuySetups();refreshQualificationGauges();
        $('refreshStatus').textContent='Refresh cycle finished | see Sonar feed status';
      })().finally(()=>{wakePromise=null;refreshSonar();});
      return wakePromise;
    }

    const activePriceChecks=new Map();
    function priceCheckActivity(scope,delta) {
      const count=Math.max(0,(activePriceChecks.get(scope)||0)+delta);
      if(count) activePriceChecks.set(scope,count); else activePriceChecks.delete(scope);
      refreshCheckDots();
      sonarActivity(scope,delta);
    }
    function checkingRow(row) {
      return ((activePriceChecks.get(row.kind==='named'?'watchlist':row.key.split(':')[0])||0)+(activePriceChecks.get('candles:'+row.key.split(':')[0])||0))>0;
    }
    function refreshCheckDots() {
      const dot=$('dumpCheckDot'); if(!dot) return;
      const busy=activePriceChecks.size>0 && !document.hidden;
      dot.classList.toggle('is-checking',busy);
      const label=busy?'Checking public prices':'No price request running';
      dot.setAttribute('aria-label',label); dot.title=label;
      document.querySelectorAll('[data-glance-dot]').forEach(el=>{
        const row=visibleTradeRows.get(el.dataset.glanceDot);
        const checking=Boolean(row && checkingRow(row) && !document.hidden);
        el.classList.toggle('is-checking',checking);
        const label=checking?'Checking public price':(row?compactFreshness(row):'Price unavailable');
        el.setAttribute('aria-label',label);el.title=label;
      });
    }
    function glancePriceTone(row) {
      if(qualificationState(row).stage==='freshness') return 'glance-muted';
      const samples=deskSamples.get(row.key)||[];
      if(samples.length<2) return 'glance-muted';
      const a=samples[samples.length-2],b=samples[samples.length-1];
      return b.price>a.price?'glance-up':b.price<a.price?'glance-down':'glance-muted';
    }
    function renderDumpGlance() {
      const host=$('dumpGlanceRows'); if(!host) return;
      const focused=document.activeElement?.closest('[data-glance-key]')?.dataset.glanceKey;
      const rows=[...visibleTradeRows.values()].sort((a,b)=>Number(!watchedDumpRows.has(b.key)&&isNewDumpEntry(b.key))-Number(!watchedDumpRows.has(a.key)&&isNewDumpEntry(a.key))||Number(watchedDumpRows.has(b.key))-Number(watchedDumpRows.has(a.key))||compareDeskRows(a,b));
      host.innerHTML=rows.length?rows.map(row=>{
        const fresh=qualificationState(row).stage!=='freshness';
        const change=Number.isFinite(row.change)?row.change:null;
        const tone=!fresh||change===null?'glance-muted':change<0?'glance-down':change>0?'glance-up':'glance-muted';
        const label=change===null?'â':(change>0?'+':'')+change.toFixed(2)+'%';
        const watching=watchedDumpRows.has(row.key);
        const watch=watching?' Â· WATCHING':'';
        const newLabel=isNewDumpEntry(row.key)?'<span class="glance-new">NEW</span>':'';
        const watchLabel=watching?'<span class="glance-watching">WATCHING</span>':'';
        return `<button type="button" class="glance-row" data-glance-key="${escapeHTML(row.key)}" aria-label="Open ${escapeHTML(row.symbol)} on ${escapeHTML(row.chain)}${watch}">
          <span class="glance-coin"><strong>${escapeHTML(row.symbol)}</strong>${newLabel}${watchLabel}<small>${escapeHTML(row.chain)}</small></span>
          <span class="glance-price ${glancePriceTone(row)}" title="${escapeHTML(compactFreshness(row))}">${escapeHTML(usdPrice(row.price))}</span>
          <span class="glance-change ${tone}">${label}</span>
          <span class="check-dot" role="img" data-glance-dot="${escapeHTML(row.key)}"></span>
        </button>`;
      }).join(''):'<div class="trade-note">No Dump opps to show.</div>';
      refreshCheckDots();
      if(focused) [...host.querySelectorAll('[data-glance-key]')].find(el=>el.dataset.glanceKey===focused)?.focus({preventScroll:true});
    }
    function openGlanceCard(key) {
      const card=[...document.querySelectorAll('[data-desk-key]')].find(el=>el.dataset.deskKey===key);
      if(!card) return;
      card.setAttribute('tabindex','-1');card.focus({preventScroll:true});
      card.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }
    function refreshCompactCards() {
      refreshMarketPulse();
      document.querySelectorAll('[data-desk-key]').forEach(host=>{
        const row=visibleTradeRows.get(host.dataset.deskKey); if(!row) return;
        const current=row.kind==='named' ? price(row.key) : Object.values(chainPools).flat().find(p=>p.identity===row.key);
        if(current) {
          const value=Number(row.kind==='named'?current.current_price:current.price);
          const change=finiteChange(row.kind==='named'?current.price_change_percentage_24h:current.change24h);
          if(Number.isFinite(value)&&value>0) row.price=value;
          row.change=change;
          host.querySelector('[data-card-price]').textContent=usdPrice(row.price);
          host.querySelector('[data-card-change]').textContent=change===null?'24H unavailable':'24H '+change.toFixed(2)+'%';
          const latest=host.querySelector('[data-plan-sampled-price]');
          if(latest) latest.textContent='Sampled price '+usdPrice(row.price);
        }
        host.querySelector('[data-card-chart]').innerHTML=sampleChartMarkup(row);
        const c=compactState(row);
        host.dataset.feedActive=String(c.q.stage!=='freshness' && c.q.stage!=='drop');
        const badge=host.querySelector('[data-card-state]');
        badge.textContent=c.label;badge.dataset.tone=c.tone;
        host.querySelector('[data-card-reason]').textContent=c.q.note;
        host.querySelector('[data-card-age]').textContent=compactFreshness(row);
        const evidence=host.querySelector('[data-market-evidence]');
        if(evidence) evidence.innerHTML=marketEvidenceMarkup(row);
      });
      renderDumpGlance();
      refreshMarketPulse();
    }
    function recordPriceSamples() {
      const recordedAt = Date.now();
      market.forEach(m => {
        const current = Number(m.current_price);
        if (!Number.isFinite(current) || current <= 0) return;
        if (freshMarketItem(m)) {
          const at=new Date(m.last_updated).getTime();
          recordGaugeSample(m.id,current,at); recordDeskSample(m.id,current,at);
        }
        const samples = Array.isArray(priceSamples[m.id]) ? priceSamples[m.id] : [];
        samples.push({ price: current, recordedAt });
        priceSamples[m.id] = samples.slice(-3);
      });
    }
    function entryStateFor(cg) {
      const samples = priceSamples[cg] || [];
      if (samples.length < 3) return 'checking';
      const [older, previous, current] = samples;
      if (current.price > previous.price && previous.price >= older.price) return 'recovering';
      if (current.price < previous.price && previous.price <= older.price) return 'falling';
      return 'stabilising';
    }
    function screeningRating(m) {
      const change = finiteChange(m?.price_change_percentage_24h);
      if (change === null || !freshMarketItem(m)) return 0;
      const declinePoints = change < 0 ? Math.min(70, Math.max(0, -change * 4)) : 0;
      const state = entryStateFor(m.id);
      const directionPoints = state === 'recovering' ? 20 : state === 'stabilising' ? 10 : state === 'checking' ? 5 : 0;
      return Math.round(Math.min(100, declinePoints + directionPoints + 10));
    }
    function entryStateLabel(state) {
      if (state === 'recovering') return 'RISING SAMPLES - REVIEW';
      if (state === 'falling') return 'WAIT - STILL DUMPING';
      if (state === 'stabilising') return 'WATCH CLOSELY';
      return 'CHECKING - NEEDS 2 MOVES';
    }
    function entryStateSignal(state) {
      if (state === 'recovering') return 'green';
      if (state === 'falling') return 'red';
      return 'flat';
    }
    const UNISWAP_CHAINS = Object.freeze({
      ethereum:'mainnet',
      arbitrum:'arbitrum',
      optimism:'optimism',
      polygon:'polygon',
      avalanche:'avalanche',
      bnb:'bnb'
    });
    const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    function safeSolanaMint(value) {
      const mint=String(value || '').trim();
      return mint === 'SOL' || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? mint : null;
    }
    function verifiedRouteMatchesItem(route,item) {
      if (!route || !item) return false;
      if (route.venue === 'JUPITER') {
        const expected=item.addr === 'Native' ? 'SOL' : safeSolanaMint(item.addr);
        if (!(item.chain === 'solana' && expected !== null && route.chain === 'solana' && route.outputIdentity === expected)) return false;
        try {
          const url=new URL(route.url);
          return url.protocol === 'https:' && ['jup.ag','www.jup.ag'].includes(url.hostname) && url.searchParams.get('buy') === expected && url.searchParams.get('sell') === SOLANA_USDC_MINT;
        } catch (_) { return false; }
      }
      if (route.venue === 'UNISWAP') {
        const expected=String(item.addr || '').toLowerCase();
        return UNISWAP_CHAINS[item.chain] === route.chain && /^0x[a-f0-9]{40}$/.test(expected) && route.outputIdentity === expected;
      }
      return false;
    }
    function tradeRouteFor(item) {
      if (!item || typeof item.cg !== 'string') return null;
      if (item.chain === 'solana') {
        const output = item.addr === 'Native' ? 'SOL' : safeSolanaMint(item.addr);
        if (!output) return null;
        // Jupiter's current page route receives both exact mint identities.
        const route={venue:'JUPITER',wallet:'PHANTOM',chain:'solana',inputIdentity:SOLANA_USDC_MINT,outputIdentity:output,url:`https://jup.ag/?buy=${encodeURIComponent(output)}&sell=${encodeURIComponent(SOLANA_USDC_MINT)}`};
        return verifiedRouteMatchesItem(route,item) ? route : null;
      }
      const uniswapChain = UNISWAP_CHAINS[item.chain];
      if (uniswapChain && /^0x[a-fA-F0-9]{40}$/.test(String(item.addr || ''))) {
        const output=String(item.addr).toLowerCase();
        const route={venue:'UNISWAP',wallet:'RABBY',chain:uniswapChain,outputIdentity:output,url:`https://app.uniswap.org/swap?chain=${encodeURIComponent(uniswapChain)}&outputCurrency=${encodeURIComponent(output)}`};
        return verifiedRouteMatchesItem(route,item) ? route : null;
      }
      return null;
    }
    function openTradingRoute(cg) {
      const item = checkerCoins.find(candidate => candidate.cg === cg);
      const route = tradeRouteFor(item);
      if (!route) return alert('A verified Jupiter or Uniswap route is not available for this coin. Nothing was opened.');
      if (!verifiedRouteMatchesItem(route,item)) return alert('Market identity check failed. Nothing was opened.');
      window.open(route.url, '_blank', 'noopener,noreferrer');
    }
    function openCoinWindow(cg) {
      const item = checkerCoins.find(candidate => candidate.cg === cg);
      const route = tradeRouteFor(item);
      if (route) return openTradingRoute(cg);
      const chart = item ? getDexLink(item) : null;
      if (!chart) return alert('No verified route is available. Nothing was opened.');
      window.open(chart, '_blank', 'noopener,noreferrer');
    }
    function openTickerCoin(event, cg) {
      event.stopPropagation();
      const shell = $('tickerShell');
      if (!shell.classList.contains('paused')) {
        toggleTickerPause();
        $('tickerStatus').textContent = 'Banner paused - press the coin again to open its verified route';
        return;
      }
      openCoinWindow(cg);
    }
    function toggleTickerPause() {
      const shell = $('tickerShell');
      const paused = shell.classList.toggle('paused');
      shell.setAttribute('aria-pressed', String(paused));
      shell.setAttribute('aria-label', paused ? 'Resume moving coin banner' : 'Pause moving coin banner');
      $('tickerControlLabel').textContent = paused ? 'BANNER PAUSED  |  TAP TO RESUME' : 'CHECKING EVERY CONFIGURED COIN  |  TAP TO PAUSE';
    }
    function validTokenAddress(lane, address) {
      if (lane.api === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
    function validPoolAddress(lane, address) {
      if (lane.api === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      return /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(address);
    }
    // Evidence is session-only and bound to the exact chain, pool and base token.
    // Neither imported watch pins nor research text can grant a qualification.
    const poolCandleEvidence = new Map();
    const poolCandleAttempts = new Map();
    // Read-only risk and route evidence. No transaction building, wallet address,
    // API key, approval, signature or account-dependent simulation is used here.
    const securityEvidence = new Map(), securityAttempts = new Map(), securityPending = new Map();
    const routeEvidence = new Map(), routeCheckPending = new Set(), routeLastAttempt = new Map();
    const publicServiceCooldown = new Map();
    let securitySweepRunning=false, routeQueue=Promise.resolve();
    const PUBLIC_CHAIN_IDS=Object.freeze({ethereum:'1',bnb:'56',arbitrum:'42161',optimism:'10',polygon:'137',avalanche:'43114'});
    // Circle-issued USDC addresses, checked against Circle documentation 2026-09-28.
    // BNB and Robinhood are deliberately not assigned a guessed USDC contract.
    const QUOTE_NETWORKS=Object.freeze({
      ethereum:{provider:'KyberSwap',slug:'ethereum',usdc:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'},
      arbitrum:{provider:'KyberSwap',slug:'arbitrum',usdc:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831'},
      optimism:{provider:'KyberSwap',slug:'optimism',usdc:'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'},
      polygon:{provider:'KyberSwap',slug:'polygon',usdc:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'},
      avalanche:{provider:'KyberSwap',slug:'avalanche',usdc:'0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'},
      solana:{provider:'Raydium',slug:'solana',usdc:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}
    });
    function assetContext(row) {
      if(!row) return null;
      const match=evidencePool(row);
      if(match) return {chain:match.lane.key,address:match.pool.tokenAddress,symbol:match.pool.symbol,pool:match.pool.poolAddress};
      if(row.kind!=='named') return null;
      const item=checkerCoins.find(c=>c.cg===row.key && c.symbol===row.symbol);
      const lane=item && CHAIN_LANES.find(l=>l.key===item.chain);
      // Native balances are not silently replaced with a wrapped-token contract.
      if(!lane || !validTokenAddress(lane,String(item.addr||'')) || row.contract!==item.addr) return null;
      return {chain:lane.key,address:item.addr,symbol:item.symbol,pool:null};
    }
    function assetKey(asset) { return asset.chain+':'+(asset.chain==='solana'?asset.address:asset.address.toLowerCase()); }
    function sameQuoteToken(a,b,chain) {return typeof a==='string' && typeof b==='string' && (chain==='solana'?a===b:a.toLowerCase()===b.toLowerCase());}
    async function publicEvidenceGET(url) {
      const u=new URL(url);
      const permitted=u.protocol==='https:' && !u.username && !u.password && (
        (u.hostname==='api.gopluslabs.io' && /^\/api\/v1\/(?:solana\/token_security|token_security\/(?:1|56|42161|10|137|43114))$/.test(u.pathname)) ||
        (u.hostname==='aggregator-api.kyberswap.com' && /^\/(?:ethereum|arbitrum|optimism|polygon|avalanche)\/api\/v1\/routes$/.test(u.pathname)) ||
        (u.hostname==='transaction-v1.raydium.io' && u.pathname==='/compute/swap-base-in'));
      if(!permitted) throw Error('Unsupported public evidence endpoint');
      if(document.hidden) throw Error('Checks pause while the page is hidden');
      if(Date.now()<(publicServiceCooldown.get(u.hostname)||0)) throw Error('Provider cooling down; retry later');
      const evidenceStarted=Date.now();
      priceCheckActivity('evidence',1);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      try {
        const response=await fetch(u.href,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
        if([401,403,429].includes(response.status)) {
          const seconds=Number(response.headers?.get('Retry-After'));
          publicServiceCooldown.set(u.hostname,Date.now()+(response.status===429?Math.max(60000,Math.min(900000,(Number.isFinite(seconds)?seconds:60)*1000)):900000));
        }
        if(!response.ok) throw Error('Public provider unavailable (HTTP '+response.status+')');
        const body=await response.text();
        if(body.length>1500000) throw Error('Public response too large');
        if(evidenceStarted<marketWakeAt)throw Error('Refresh required after reopening');
        return JSON.parse(body);
      } finally {clearTimeout(timer);priceCheckActivity('evidence',-1);}
    }
    function securityBit(value) {return value===1||value==='1'?true:value===0||value==='0'?false:null;}
    function securityFraction(value) {const n=evidenceNumber(value);return n!==null&&n<=1?n:null;}
    function parseSecurity(payload,asset,now=Date.now()) {
      if(payload?.code!==1||!payload.result||typeof payload.result!=='object') throw Error('Security provider returned no evidence');
      const entries=Object.entries(payload.result).filter(([address])=>sameQuoteToken(address,asset.address,asset.chain));
      if(entries.length!==1 || !entries[0][1] || typeof entries[0][1]!=='object') throw Error('Security token identity mismatch');
      const r=entries[0][1],sol=asset.chain==='solana';
      const symbol=sol?r.metadata?.symbol:r.token_symbol;
      if(typeof symbol!=='string'||symbol.toUpperCase()!==asset.symbol.toUpperCase()) throw Error('Security symbol and selected contract disagree');
      const flags=[],missing=[];
      const check=(value,label,critical=false)=>{const b=securityBit(value);if(b===true)flags.push({label,critical});else if(b===null)missing.push(label);};
      if(sol) {
        check(r.non_transferable,'Non-transferable token',true);
        if(r.default_account_state==='2'||r.default_account_state===2) flags.push({label:'New token accounts are frozen',critical:true});
        else if(r.default_account_state!=='1'&&r.default_account_state!==1) missing.push('Account transfer state');
        for(const [key,label] of [['freezable','Freeze authority'],['mintable','Mint authority'],['balance_mutable_authority','Balance-changing authority'],['closable','Token close authority'],['transfer_fee_upgradable','Changeable transfer fee'],['transfer_hook_upgradable','Changeable transfer hook']]) check(r[key]?.status,label);
        if(Array.isArray(r.transfer_hook)) {if(r.transfer_hook.length) flags.push({label:'Transfer hook needs review',critical:false});} else missing.push('Transfer hook');
      } else {
        for(const [key,label,critical] of [['is_honeypot','Provider reports honeypot risk',true],['cannot_buy','Provider reports buy restriction',true],['cannot_sell_all','Provider reports full-sale restriction',true],['is_blacklisted','Blacklist capability',false],['is_whitelisted','Whitelist capability',false],['transfer_pausable','Transfer pause capability',false],['owner_change_balance','Balance-changing owner',true],['slippage_modifiable','Changeable token tax',false],['personal_slippage_modifiable','Address-specific token tax',false],['is_mintable','Mint capability',false],['is_proxy','Upgradeable proxy',false],['hidden_owner','Hidden ownership reported',false],['selfdestruct','Self-destruct capability',true],['trading_cooldown','Trading cooldown',false]]) check(r[key],label,critical);
        if(securityBit(r.is_open_source)!==true) missing.push('Verified contract source');
      }
      let buyTax=sol?null:securityFraction(r.buy_tax),sellTax=sol?null:securityFraction(r.sell_tax);
      if(!sol) for(const [tax,label] of [[buyTax,'Buy tax'],[sellTax,'Sell tax']]) {if(tax===null)missing.push(label);else if(tax>0)flags.push({label:label+' '+(tax*100).toFixed(2)+'%',critical:tax>=1});}
      let transferBps=null;
      if(sol) {
        transferBps=evidenceNumber(r.transfer_fee?.current_fee_rate?.fee_rate);
        if(transferBps===null || transferBps>10000) {transferBps=null;missing.push('Current transfer fee');}
        else if(transferBps>0) flags.push({label:'Transfer fee '+(transferBps/100).toFixed(2)+'% (cap may apply)',critical:transferBps>=10000});
        if(r.transfer_fee?.scheduled_fee_rate) flags.push({label:'Scheduled transfer fee change',critical:false});
      }
      // Holdings include exchanges, pools and contracts: do not label them insiders.
      let topShare=null,holderRows=0;
      if(Array.isArray(r.holders)&&r.holders.length>0&&r.holders.length<=100) {
        const seen=new Set();let total=0,valid=true;
        for(const h of r.holders) {const address=sol?(h.token_account||h.account):h.address;const pct=securityFraction(h.percent);if(typeof address!=='string'||seen.has(address)||pct===null){valid=false;break;}seen.add(address);total+=pct;}
        if(valid&&total<=1.001) {topShare=Math.min(1,total);holderRows=r.holders.length;}
      }
      if(topShare===null) missing.push('Holder concentration');
      const holders=evidenceNumber(r.holder_count);
      return {asset:assetKey(asset),context:{...asset},at:now,flags,missing,buyTax,sellTax,transferBps,topShare,holderRows,holders:Number.isSafeInteger(holders)?holders:null,critical:flags.some(f=>f.critical),source:'GoPlus public token report'};
    }
    function currentSecurity(row,now=Date.now()) {
      const asset=assetContext(row);if(!asset)return null;
      const s=securityEvidence.get(assetKey(asset));
      // An old adverse finding remains unresolved until a new valid report supersedes it.
      return s&&s.asset===assetKey(asset)&&now>=s.at&&(s.critical||(s.at>=marketWakeAt&&now-s.at<=15*60000))?s:null;
    }
    async function checkAssetSecurity(asset) {
      const key=assetKey(asset),cached=securityEvidence.get(key);
      if(cached&&cached.at>=marketWakeAt&&Date.now()>=cached.at&&Date.now()-cached.at<10*60000)return cached;
      if(securityPending.has(key))return securityPending.get(key);
      if(Date.now()-(securityAttempts.get(key)||0)<60000)return null;
      const chainId=PUBLIC_CHAIN_IDS[asset.chain];
      if(asset.chain!=='solana'&&!chainId)return null;
      securityAttempts.set(key,Date.now());
      const work=(async()=>{try {
        const endpoint=asset.chain==='solana'?'solana/token_security':'token_security/'+chainId;
        const data=await publicEvidenceGET('https://api.gopluslabs.io/api/v1/'+endpoint+'?contract_addresses='+encodeURIComponent(asset.address));
        const result=parseSecurity(data,asset);securityEvidence.set(key,result);sonarFresh('evidence',['scl-buy-setups']);return result;
      } catch(_) {if(!securityEvidence.get(key)?.critical)securityEvidence.delete(key);return null;}finally{securityPending.delete(key);}})();
      securityPending.set(key,work);return work;
    }
    async function refreshSecuritySweep() {
      if(securitySweepRunning||document.hidden)return;
      securitySweepRunning=true;
      try {
        const unique=new Map();
        for(const row of visibleTradeRows.values()) {const a=assetContext(row);if(a&&(a.chain==='solana'||PUBLIC_CHAIN_IDS[a.chain]))unique.set(assetKey(a),a);}
        for(const s of securityEvidence.values())if(s.critical&&s.context)unique.set(s.asset,s.context);
        const queue=[...unique.values()].filter(a=>Date.now()-(securityAttempts.get(assetKey(a))||0)>=10*60000).sort((a,b)=>(securityAttempts.get(assetKey(a))||0)-(securityAttempts.get(assetKey(b))||0)).slice(0,8);
        for(const asset of queue) {if(document.hidden||Date.now()<(publicServiceCooldown.get('api.gopluslabs.io')||0))break;await checkAssetSecurity(asset);refreshCompactCards();await new Promise(resolve=>setTimeout(resolve,1500));}
        for(const [key,s] of securityEvidence)if(!s.critical&&Date.now()-s.at>60*60000)securityEvidence.delete(key);
        if(securityAttempts.size>500) {const keep=[...securityAttempts].sort((a,b)=>b[1]-a[1]).slice(0,400);securityAttempts.clear();keep.forEach(([k,v])=>securityAttempts.set(k,v));}
        if(queue.length) buildBuySetups();
      } finally {securitySweepRunning=false;}
    }
    function securityMarkup(row) {
      const s=currentSecurity(row);
      if(!s)return '<div class="trade-note">Security report waiting or unavailable. Nothing is assumed safe.</div>';
      const top=s.topShare===null?'Concentration unavailable':`Reported top ${s.holderRows} holdings: ${(s.topShare*100).toFixed(1)}% of supply; custody and pool accounts included, ownership not resolved.`;
      const warnings=(Date.now()-s.at>15*60000?'Earlier adverse finding still unresolved; current recheck needed. ':'')+(s.flags.length?s.flags.map(f=>escapeHTML(f.label)).join(' | '):'No listed flag reported; not a safety guarantee.');
      return `<div class="trade-note"><strong>${s.critical?'AVOID | provider restriction reported':'Security report | manual review'}</strong><br>${warnings}<br>${escapeHTML(top)}<br>${s.holders===null?'Holder count unavailable':s.holders.toLocaleString('en-US')+' reported holding addresses'} | ${escapeHTML(new Date(s.at).toISOString())}<br>${s.missing.length?'Missing: '+escapeHTML(s.missing.join(', '))+'. ':''}Liquidity locks, linked ownership and future unlocks are not verified. A public report cannot prove your wallet can sell.</div>`;
    }
    function positiveAtomic(value) {return typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)?value:null;}
    function parseRouteQuote(payload,asset,tokenIn,tokenOut,amount,startedAt,now=Date.now()) {
      const config=QUOTE_NETWORKS[asset.chain];if(!config||!positiveAtomic(amount))throw Error('Quote request invalid');
      let data,out,gasUSD=null,at=startedAt;
      if(config.provider==='KyberSwap') {
        data=payload?.data?.routeSummary;
        if(payload?.code!==0||!data||!sameQuoteToken(data.tokenIn,tokenIn,asset.chain)||!sameQuoteToken(data.tokenOut,tokenOut,asset.chain)||data.amountIn!==amount||!Array.isArray(data.route)||!data.route.length)throw Error('Quote identity or amount mismatch');
        if(data.route.length>20 || data.route.some(path=>!Array.isArray(path)||!path.length||path.length>10||!sameQuoteToken(path[0]?.tokenIn,tokenIn,asset.chain)||!sameQuoteToken(path[path.length-1]?.tokenOut,tokenOut,asset.chain)||path.some((leg,i)=>!leg||!/^0x[a-fA-F0-9]{40}$/.test(leg.tokenIn)||!/^0x[a-fA-F0-9]{40}$/.test(leg.tokenOut)||(i&&!sameQuoteToken(path[i-1].tokenOut,leg.tokenIn,asset.chain)))))throw Error('Quote route path mismatch');
        const stamp=Number(data.timestamp)*1000;
        if(!Number.isFinite(stamp)||stamp>now+2000||now-stamp>10000)throw Error('Quote time is not current');
        at=Math.min(startedAt,stamp);out=positiveAtomic(data.amountOut);
        const gas=evidenceNumber(data.gasUsd),l1=evidenceNumber(data.l1FeeUsd);
        if(gas!==null&&l1!==null)gasUSD=gas+l1;
      } else {
        data=payload?.data;
        if(payload?.success!==true||!data||data.swapType!=='BaseIn'||data.inputMint!==tokenIn||data.outputMint!==tokenOut||data.inputAmount!==amount||data.slippageBps!==50||!Array.isArray(data.routePlan)||!data.routePlan.length)throw Error('Quote identity or amount mismatch');
        if(data.routePlan.length>10||data.routePlan[0]?.inputMint!==tokenIn||data.routePlan[data.routePlan.length-1]?.outputMint!==tokenOut||data.routePlan.some((leg,i)=>!leg||typeof leg.poolId!=='string'||!leg.poolId||(i&&data.routePlan[i-1].outputMint!==leg.inputMint)))throw Error('Quote route path mismatch');
        out=positiveAtomic(data.outputAmount);
      }
      if(!out||now<startedAt||now-startedAt>10000)throw Error('Quote missing or expired');
      return {amountIn:amount,amountOut:out,gasUSD,at,provider:config.provider,tokenIn,tokenOut};
    }
    async function fetchRouteQuote(asset,tokenIn,tokenOut,amount) {
      const c=QUOTE_NETWORKS[asset.chain];if(!c||!positiveAtomic(amount))throw Error('Quote coverage unavailable');
      const start=Date.now();
      const url=c.provider==='KyberSwap'
        ? `https://aggregator-api.kyberswap.com/${c.slug}/api/v1/routes?tokenIn=${encodeURIComponent(tokenIn)}&tokenOut=${encodeURIComponent(tokenOut)}&amountIn=${amount}&gasInclude=true&excludeRFQSources=true`
        : `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${encodeURIComponent(tokenIn)}&outputMint=${encodeURIComponent(tokenOut)}&amount=${amount}&slippageBps=50&txVersion=V0`;
      return parseRouteQuote(await publicEvidenceGET(url),asset,tokenIn,tokenOut,amount,start);
    }
    function routeFingerprint(row,plan) {
      const asset=assetContext(row);return asset?JSON.stringify([assetKey(asset),asset.pool,plan.budget,plan.anchor,plan.entryPosition,plan.multiple]):null;
    }
    function calculateRoundTrip(smallBuy,smallSell,buy,sell) {
      if(smallSell.amountIn!==smallBuy.amountOut||sell.amountIn!==buy.amountOut)throw Error('Sell quantity mismatch');
      const ratio=q=>Number(q.amountOut)/Number(q.amountIn);
      const buyImpact=(1-ratio(buy)/ratio(smallBuy))*100,sellImpact=(1-ratio(sell)/ratio(smallSell))*100;
      const inputUSDC=Number(buy.amountIn)/1e6,returnedUSDC=Number(sell.amountOut)/1e6;
      if(![buyImpact,sellImpact,inputUSDC,returnedUSDC].every(Number.isFinite)||inputUSDC<=0)throw Error('Quote math invalid');
      return {inputUSDC,returnedUSDC,dragPct:(inputUSDC-returnedUSDC)/inputUSDC*100,buyImpact,sellImpact,gasUSD:buy.gasUSD!==null&&sell.gasUSD!==null?buy.gasUSD+sell.gasUSD:null};
    }
    function freshRouteEvidence(row,plan,now=Date.now()) {
      const e=routeEvidence.get(row.key);
      return e?.status==='observed'&&e.at>=marketWakeAt&&e.fingerprint===routeFingerprint(row,plan)&&now>=e.at&&now-e.at<=10000?e:null;
    }
    async function runRouteCheck(key) {
      const row=visibleTradeRows.get(key);if(!row)return;
      const asset=assetContext(row),plan=getTradePlan(key,row.price),fingerprint=routeFingerprint(row,plan);
      if(!asset||!QUOTE_NETWORKS[asset.chain]) {routeEvidence.set(key,{status:'unavailable',message:'Exact supported quote route unavailable for this asset.'});return;}
      const budget=Number(plan.budget);
      if(!Number.isFinite(budget)||budget<=0||budget>1000||budget%50!==0){routeEvidence.set(key,{status:'unavailable',message:'Choose your AUD spend first.'});return;}
      routeEvidence.set(key,{status:'checking',fingerprint});paintRouteChecks();
      try {
        const fx=await fetchDisplayFx();
        if(!validDisplayFx(fx))throw Error('AUD reference conversion unavailable');
        const amount=String(Math.floor(budget/fx.rate*1e6));
        if(!positiveAtomic(amount))throw Error('Quote amount invalid');
        const probe=(BigInt(amount)/10n).toString(),usdc=QUOTE_NETWORKS[asset.chain].usdc;
        if(sameQuoteToken(usdc,asset.address,asset.chain))throw Error('Stablecoins are not dump candidates');
        // Smaller-size comparisons first; full-size entry and exit quotes last.
        const smallBuy=await fetchRouteQuote(asset,usdc,asset.address,probe);
        const smallSell=await fetchRouteQuote(asset,asset.address,usdc,smallBuy.amountOut);
        const buy=await fetchRouteQuote(asset,usdc,asset.address,amount);
        const sell=await fetchRouteQuote(asset,asset.address,usdc,buy.amountOut);
        if(Date.now()-Math.min(smallBuy.at,smallSell.at,buy.at,sell.at)>10000)throw Error('Quotes aged during comparison; refresh at the venue');
        const current=visibleTradeRows.get(key);
        if(!current||fingerprint!==routeFingerprint(current,getTradePlan(key,current.price)))throw Error('Selection changed; check the new spend');
        routeEvidence.set(key,{status:'observed',fingerprint,at:Math.min(smallBuy.at,smallSell.at,buy.at,sell.at),provider:buy.provider,fx:{rate:fx.rate,date:fx.date},budget,...calculateRoundTrip(smallBuy,smallSell,buy,sell)});
      } catch(error) {routeEvidence.set(key,{status:'unavailable',fingerprint,message:error.name==='AbortError'?'Quote request timed out.':String(error.message||'Quote unavailable').slice(0,160)});}
    }
    function requestRouteCheck(key) {
      if(routeCheckPending.size || Date.now()-(routeLastAttempt.get(key)||0)<15000)return;
      routeLastAttempt.set(key,Date.now());routeCheckPending.add(key);
      routeQueue=routeQueue.then(()=>runRouteCheck(key)).catch(()=>routeEvidence.set(key,{status:'unavailable',message:'Quote unavailable.'})).finally(()=>{routeCheckPending.delete(key);paintRouteChecks();refreshCompactCards();});
      paintRouteChecks();
    }
    function routeCheckMarkup(row,plan) {
      const e=routeEvidence.get(row.key),fresh=freshRouteEvidence(row,plan),asset=assetContext(row);
      let message='Compare current buy and sell quotes at your selected spend. No wallet needed.';
      if(!asset||!QUOTE_NETWORKS[asset.chain])message='No supported exact quote route for this coin/chain. No substitute token is used.';
      else if(routeCheckPending.has(row.key))message='Checking both directions...';
      else if(e?.status==='unavailable')message=e.message;
      else if(e?.status==='observed'&&!fresh)message='Quote needs refreshing for the current selection.';
      const button=`<button type="button" class="btn" data-check-route="${escapeHTML(row.key)}" ${routeCheckPending.size||!asset||!QUOTE_NETWORKS[asset.chain]?'disabled':''}>CHECK MY COSTS</button>`;
      if(!fresh)return button+`<div class="trade-note">${escapeHTML(message)}</div>`;
      const number=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
      return button+`<div class="trade-note"><strong>${escapeHTML(fresh.provider)} comparison | not an order</strong><br>${number(fresh.inputUSDC)} USDC in â ${number(fresh.returnedUSDC)} USDC back now, before unquoted costs. Difference ${fresh.dragPct.toFixed(2)}%.</div><details class="trade-assumptions"><summary>Quote details &amp; remaining costs</summary><div class="trade-note">Size-related deterioration versus a 10%-size probe: buy ${fresh.buyImpact.toFixed(2)}%, sell ${fresh.sellImpact.toFixed(2)}%. Independent snapshots, not realized slippage.<br>Network estimate: ${fresh.gasUSD===null?'not supplied':'US$'+number(fresh.gasUSD)+' for both swaps; approval costs extra'}. Token-tax coverage and wallet/setup charges are not verified.<br>Uses A$${fresh.budget} as swap input, gas extra; reference USD/AUD ${fresh.fx.rate} (${escapeHTML(fresh.fx.date)}), assumes 1 USDC = US$1. Quotes are for current market prices, not your future entry/target. Do not add these costs to the manual model twice.<br>OPEN MARKET may use another provider; check its final quote. A reverse quote is not proof your wallet can sell. ${escapeHTML(new Date(fresh.at).toISOString())}</div></details>`;
    }
    function paintRouteChecks() {
      document.querySelectorAll('[data-route-check]').forEach(host=>{
        const row=visibleTradeRows.get(host.dataset.routeCheck);if(!row)return;
        const plan=getTradePlan(row.key,row.price);
        const summary=host.closest('[data-trade-plan]')?.querySelector('[data-trade-summary]');
        if(summary) summary.innerHTML=tradeSummaryMarkup(row,plan);
        const markup=routeCheckMarkup(row,plan);
        if(host.dataset.renderedQuote===markup)return;
        const open=Boolean(host.querySelector('details[open]')),focused=host.contains(document.activeElement);
        host.innerHTML=markup;host.dataset.renderedQuote=markup;
        if(open&&host.querySelector('details'))host.querySelector('details').open=true;
        if(focused)host.querySelector('[data-check-route]')?.focus({preventScroll:true});
      });
    }
    function evidenceNumber(value) {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim()==='') return null;
      const n=Number(value); return Number.isFinite(n) && n>=0 ? n : null;
    }
    function normalisePoolFlow(attributes) {
      const windows={};
      for(const period of ['m15','h1','h24']) {
        const t=attributes.transactions?.[period] || {};
        const count=k=>{const n=evidenceNumber(t[k]);return Number.isSafeInteger(n)?n:null;};
        const buys=count('buys'),sells=count('sells');
        let buyers=count('buyers'),sellers=count('sellers');
        if(buys===null || buyers>buys) buyers=null;
        if(sells===null || sellers>sells) sellers=null;
        const volume=evidenceNumber(attributes.volume_usd?.[period]);
        let buyUSD=evidenceNumber(attributes.buy_volume_usd?.[period]),sellUSD=evidenceNumber(attributes.sell_volume_usd?.[period]);
        // Reject internally inconsistent optional side volumes; never invent them.
        if(volume!==null && buyUSD!==null && sellUSD!==null && Math.abs(buyUSD+sellUSD-volume)>Math.max(.01,volume*.01)) buyUSD=sellUSD=null;
        const dollarShare=buyUSD!==null && sellUSD!==null && buyUSD+sellUSD>0 ? buyUSD/(buyUSD+sellUSD)*100 : null;
        windows[period]={buys,sells,buyers,sellers,volume,buyUSD,sellUSD,dollarShare};
      }
      return windows;
    }
    function evidencePool(row) {
      if(row?.kind!=='chain') return null;
      for(const lane of CHAIN_LANES) {
        const pool=(chainPools[lane.key]||[]).find(p=>p.identity===row.key && p.tokenAddress===row.contract && p.chart===row.chart);
        if(pool) return {lane,pool};
      }
      return null;
    }
    function candleEvidenceKey(lane,pool) { return lane.api+'|'+pool.poolAddress+'|'+pool.tokenAddress; }
    function parseClosedCandles(payload,lane,pool,seconds,now=Date.now()) {
      const sameAddress=(a,b)=>typeof a==='string' && typeof b==='string' && (lane.api==='solana'?a===b:a.toLowerCase()===b.toLowerCase());
      if(!sameAddress(payload?.meta?.base?.address,pool.tokenAddress) || !sameAddress(payload?.meta?.quote?.address,pool.quoteAddress)) throw Error('Candle token identity mismatch');
      const input=payload?.data?.attributes?.ohlcv_list;
      if(!Array.isArray(input) || input.length>1000 || ![900,3600].includes(seconds)) throw Error('Candle data invalid');
      const seen=new Set(),rows=[];
      for(const r of input) {
        if(!Array.isArray(r)||r.length!==6||!r.every(v=>typeof v==='number'&&Number.isFinite(v))) throw Error('Candle values invalid');
        const [t,o,h,l,c,v]=r;
        if(!Number.isSafeInteger(t)||t<=0||t%seconds!==0||Math.min(o,h,l,c)<=0||h<Math.max(o,c,l)||l>Math.min(o,c,h)||v<0||seen.has(t)) throw Error('Candle consistency invalid');
        seen.add(t);
        // An open bar is not recovery or trading-age evidence.
        if((t+seconds)*1000<=now) rows.push({at:t*1000,open:o,high:h,low:l,close:c,volume:v});
      }
      return rows.sort((a,b)=>a.at-b.at);
    }
    function closedCandleSummary(hour,quarter,now=Date.now()) {
      const traded=hour.filter(c=>c.volume>0);
      // Closing boundary is conservative: a trade somewhere in the candle occurred no later than this.
      const oldestTradeBy=traded.length ? traded[0].at+3600000 : null;
      const ageDays=oldestTradeBy===null ? null : (now-oldestTradeBy)/86400000;
      const usable=(rows,step)=> {
        const last=rows.slice(-4);
        return last.length===4 && last.every((c,i)=>c.volume>0 && (!i||c.at-last[i-1].at===step)) && now>=last[3].at+step && now-(last[3].at+step)<=step;
      };
      const ready=usable(hour,3600000)&&usable(quarter,900000);
      const h=hour.slice(-4),q=quarter.slice(-4);
      const recovery=ready && q[3].low>q[2].low && q[2].low>=q[1].low && q[3].close>q[2].close && q[2].close>q[1].close && h[3].low>=h[2].low && h[3].close>h[2].close;
      const previous=hour.slice(-25,-1),last=hour[hour.length-1];
      const baselineValid=previous.length===24 && last && [...previous,last].every((c,i,all)=>!i||c.at-all[i-1].at===3600000);
      const mean=baselineValid ? previous.reduce((s,c)=>s+c.volume,0)/24 : 0;
      return {oldestTradeBy,ageDays,sevenDays:ageDays!==null&&ageDays>=7,ready,recovery,hourVolumeRatio:mean>0?last.volume/mean:null};
    }