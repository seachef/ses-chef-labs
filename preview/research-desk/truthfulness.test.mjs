import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
test('bookmarked legacy page is fail-closed with all original demonstration code inert',()=>{
 const html=read('research-tools.html'),open='<template id="archivedLegacyDemonstration">\n',close='\n</template>',start=html.indexOf(open),end=html.indexOf(close,start);
 assert.ok(start>html.indexOf('<body>'));assert.ok(end>start);assert.equal(html.indexOf('<template',start+1),-1);
 const archive=html.slice(start+open.length,end),active=html.slice(0,start)+html.slice(end+close.length);
 assert.equal(createHash('sha256').update(archive).digest('hex'),'137fda8715ad78b5561d118d971a70fcbf2e57e240afdc91de7c7e9c76de8033');
 assert.doesNotMatch(active,/<script\b|<button\b|<form\b|<canvas\b|\son\w+\s*=/i);
 assert.match(active,/Research tools unavailable/);assert.match(active,/scripted checks and example returns are not verified/);assert.match(active,/href="\.\/index.html"/);
 assert.doesNotMatch(active,/\+182\.7%|LIVE BACKTEST FIELD|qualityChecked:true|QUALIFYING|Historical tests complete/);
 assert.doesNotMatch(html,/\.content\.cloneNode|appendChild\([^)]*\.content/);
});
test('active observatory labels decorative orbit and does not link to legacy demonstration',()=>{
 const html=read('index.html');assert.match(html,/Ambient eye beams and Scout, Risk and Trades orbs are decorative art, not worker telemetry/);assert.match(html,/Solid eye cues follow verified simulated fills or unvalidated paper reviews/);assert.doesNotMatch(html,/href="\.\/research-tools.html"/);
});
