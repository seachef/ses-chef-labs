const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=fs.readFileSync('index.html','utf8');
const html=fs.readFileSync('preview/portfolio/index.html','utf8');
const source=fs.readFileSync('preview/portfolio/portfolio.mjs','utf8');

test('legacy root replaces browser history with the portfolio at both supported base paths',()=>{
  const script=root.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const base of ['https://seachef.github.io/ses-chef-labs/','https://seachef.github.io/ses-chef-labs/index.html','http://localhost:8000/']){
    let destination;vm.runInNewContext(script,{window:{location:{replace(path){destination=new URL(path,base);}}}});
    assert.equal(destination.pathname,base.includes('/ses-chef-labs/')?'/ses-chef-labs/preview/portfolio/':'/preview/portfolio/');
  }
  assert.match(root,/<noscript><meta http-equiv="refresh" content="0; url=\.\/preview\/portfolio\/">/);
  assert.match(root,/<a href="\.\/preview\/portfolio\/">Open portfolio<\/a>/);
});
test('retired paper example cannot reload and no stored data is deleted or transmitted',()=>{
  for(const forbidden of ['const stake=1000','0.10283','paperPortfolio','HBAR','localStorage','sessionStorage','indexedDB','fetch(','XMLHttpRequest','sendBeacon','bacon-shortlist.js'])assert.equal(root.includes(forbidden),false,forbidden);
});
test('portfolio removes the old research view and links while keeping current account and currency controls',()=>{
  for(const forbidden of ['#research','researchView','Research &amp; paper desk','Open paper desk','Open the research desk','../../index.html'])assert.equal(html.includes(forbidden),false,forbidden);
  for(const expected of ['data-display-currency="USD"','data-display-currency="AUD"','id="stakingDialog"','id="connectionDialog"','id="refreshPortfolio"','id="tradePlanner"'])assert.ok(html.includes(expected),expected);
  assert.equal(source.includes('loadResearch'),false);assert.equal(source.includes('bacon-shortlist.json'),false);assert.equal(source.includes('refreshResearch'),false);
});
test('retired and unknown hash routes safely show Home, with normal routes and staking unaffected',()=>{
  const route=source.slice(source.indexOf('function route(){'),source.indexOf("$('closeStakingWindow').addEventListener"));
  for(const hash of ['','#research','#unknown','#portfolio','#tools','#plan','#staking','#ladder','#rewards']){
    const elements=Object.fromEntries(['portfolioView','toolsView','planView'].map(id=>[id,{hidden:false}]));
    elements.stakingDialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
    const nav=[{dataset:{route:'portfolio'},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}},{dataset:{route:'staking'},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}}];
    const context={location:{hash},document:{querySelectorAll(){return nav;}},$:id=>elements[id],stakingRoutes:['staking','ladder','rewards'],visibleView:'portfolio',stakingReturnView:'portfolio',model:null,historyQueryKey:null,walletHistoryController:null,loadTradePlanner(){},renderHistory(){}};
    vm.createContext(context);vm.runInContext(route+'\nroute();',context);
    const expected=['#tools','#plan'].includes(hash)?hash.slice(1):'portfolio';
    assert.equal(context.visibleView,expected);assert.equal(elements[expected+'View'].hidden,false);
    assert.equal(elements.stakingDialog.open,['#staking','#ladder','#rewards'].includes(hash));
    assert.doesNotMatch(context.document.title,/undefined|Research/);
  }
});
test('background research data and collector remain available independently of the UI',()=>{
  for(const path of ['data/bacon-intelligence.json','data/bacon-history.json','data/bacon-shortlist.json','data/bacon-research-log.json'])assert.ok(JSON.parse(fs.readFileSync(path,'utf8')),path);
  assert.ok(fs.existsSync('scripts/bacon-feed.py'));
});
test('scheduled publication explicitly packages the redirect destination and its runtime assets',()=>{
  const workflow=fs.readFileSync('.github/workflows/bacon-feed.yml','utf8');
  assert.ok(workflow.includes('cp preview/portfolio/index.html preview/portfolio/portfolio.css preview/portfolio/portfolio.mjs /tmp/bacon-site/preview/portfolio/'));
  assert.ok(workflow.includes('cp -R preview/portfolio/assets preview/portfolio/portfolio preview/portfolio/vendor /tmp/bacon-site/preview/portfolio/'));
  assert.equal(/cp -R (?:\. |preview\/portfolio\/ )/.test(workflow),false);
  for(const secret of ['.env','private','auth-build','node_modules'])assert.equal(workflow.slice(workflow.indexOf('      - name: Prepare public site')).includes(secret),false,secret);
});
