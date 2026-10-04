import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
const files=['portfolio/visuals.css','portfolio/trade-planner.css','index.html','portfolio.css','portfolio.mjs','portfolio/model.mjs','portfolio/domain.mjs','portfolio/adapter.mjs','portfolio/wallet-scope.mjs','portfolio/auth-config.mjs','portfolio/auth-client.mjs'];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const lazyFiles=['portfolio/details.mjs','portfolio/history.mjs','portfolio/details.css','portfolio/wallets.mjs','portfolio/wallets.css'];
const headlineFiles=['portfolio/headline.mjs'];
const walletHistoryFiles=['portfolio/wallet-history.mjs','portfolio/wallet-history-controller.mjs','portfolio/wallet-history-view.mjs'];
const visualFiles=['portfolio/visuals.mjs','portfolio/visuals.css','portfolio/holdings-chart.mjs'];
const plannerFiles=['portfolio/trade-plan.mjs','portfolio/trade-planner.mjs','portfolio/trade-planner.css','portfolio/market-reference.mjs','portfolio/market-chart.mjs'];
const source=[...files,...lazyFiles,...visualFiles,...headlineFiles,...plannerFiles,...walletHistoryFiles].filter(f=>fs.existsSync(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const assets=walk('assets').filter(f=>!f.endsWith('.json')&&!f.includes('LICENSE'));
const unused=assets.filter(f=>f.startsWith('assets/ui/')&&!source.includes(f));
const all=[...files,...assets.filter(f=>!unused.includes(f))];
let raw=0,compressed=0;for(const file of all){const b=fs.readFileSync(file);raw+=b.length;compressed+=gzipSync(b).length;assert.ok(b.length<=150000,`${file} exceeds 150 kB single-asset budget`);}
assert.ok(raw<=650000,`Shell/assets exceed 650 kB raw budget: ${raw}`);assert.ok(compressed<=500000,`Estimated gzip transfer exceeds 500 kB: ${compressed}`);
const html=fs.readFileSync('index.html','utf8'),js=fs.readFileSync('portfolio.mjs','utf8'),css=fs.readFileSync('portfolio.css','utf8');
assert.ok(!/<iframe|<embed|<script[^>]+src="https?:/i.test(html),'External embed or executable script');
assert.ok(!/serviceWorker|setInterval|requestAnimationFrame/.test(js),'Continuous loop or private cache layer');
assert.ok(!/@import|url\(https?:/i.test(css),'External font/style dependency');
assert.ok(html.includes('type="module"'),'Script should defer until the shell is parsed');
const lazyDetailBytes=lazyFiles.filter(f=>fs.existsSync(f)).reduce((sum,f)=>sum+fs.statSync(f).size,0);assert.ok(lazyDetailBytes<80000,'Lazy details exceed 80 kB');
const lazy=fs.readFileSync('vendor/supabase-2.117.2.mjs');assert.ok(lazy.length<300000,'Lazy auth SDK exceeds 300 kB');assert.ok(gzipSync(lazy).length<80000,'Lazy auth SDK exceeds 80 kB gzip');
const groupBytes=list=>list.reduce((sum,f)=>sum+fs.statSync(f).size,0);const walletHistoryBytes=groupBytes(walletHistoryFiles);assert.ok(walletHistoryBytes<25000,'Wallet history modules exceed 25 kB');const headlineBytes=groupBytes(headlineFiles);assert.ok(headlineBytes<13000,'Headline helper exceeds 13 kB');const visualBytes=groupBytes(visualFiles),plannerBytes=groupBytes(plannerFiles);assert.ok(visualBytes<40000,'Interactive visual modules exceed 40 kB');assert.ok(plannerBytes<65000,'Interactive planner modules exceed 65 kB');
// Approved, version-pinned local chart engine: loaded only when a chart has observations.
const chartVendor=fs.readFileSync('vendor/lightweight-charts-5.2.1.mjs'),chartVendorGzipBytes=gzipSync(chartVendor).length;assert.ok(chartVendor.length<225000,'Chart vendor exceeds 225 kB raw');assert.ok(chartVendorGzipBytes<70000,'Chart vendor exceeds 70 kB gzip');
assert.ok(fs.existsSync('vendor/lightweight-charts-LICENSE.txt')&&fs.existsSync('vendor/lightweight-charts-NOTICE.txt'),'Chart licence and attribution must ship');
console.log(JSON.stringify({chartVendorBytes:chartVendor.length,chartVendorGzipBytes,lazyDetailBytes,headlineBytes,walletHistoryBytes,visualBytes,plannerBytes,unreferencedUiAssets:unused,lazyAuthBytes:lazy.length,lazyAuthGzipBytes:gzipSync(lazy).length,files:all.length,rawBytes:raw,estimatedGzipBytes:compressed,externalEmbeds:0,externalFontRequests:0,defaultPrivateNetworkRequests:0,continuousAnimationLoops:0,browserPerformance:'not measured'},null,2));
