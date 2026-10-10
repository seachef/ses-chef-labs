import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {layout} from './cosmos-scene.mjs';
import {choreography} from './character-motion.mjs';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const css=read('./team-work.css'),html=read('./index.html');
const marker='@media(max-width:760px) and (min-height:501px)';
const phone=css.slice(css.indexOf(marker),css.indexOf('@media(max-height:500px)',css.indexOf(marker)));

// These are authored-layout and scene-geometry checks, not browser pixel QA.
test('portrait scene ends at the actual deck grid boundary, with no fixed pixel deduction',()=>{
 assert.ok(css.includes(marker));
 assert.match(phone,/\.world\{grid-area:1 \/ 1 \/ 3 \/ 2\}/);
 assert.match(phone,/#atmosphere\{height:100%\}/);
 assert.doesNotMatch(phone,/#atmosphere\{[^}]*calc\(/);
 assert.match(read('./single-frame.css'),/grid-template-rows:auto minmax\(90px,1fr\) auto/);
 assert.ok(html.indexOf('<header>')<html.indexOf('<section class="horizon"'));
 assert.ok(html.indexOf('<section class="horizon"')<html.indexOf('<div class="lower-deck"'));
});

test('phone terminal is a compact three-row console with all six visible agents',()=>{
 assert.match(phone,/grid-template-rows:repeat\(2,37px\)/);
 assert.match(phone,/\.team-console\{grid-template-columns:minmax\(0,1fr\) auto;[^}]*min-height:0/);
 assert.match(phone,/\.team-source\{display:contents\}/);
 assert.match(phone,/#teamCodePreview\{grid-column:1 \/ -1;grid-row:2;height:27px\}/);
 assert.match(phone,/\.team-source-note\{grid-column:1 \/ -1;grid-row:3/);
 for(let n=1;n<=6;n++)assert.ok(html.includes(`AGENT ${String(n).padStart(3,'0')}`));
 assert.equal((html.match(/class="stream-window"/g)||[]).length,6);
 assert.doesNotMatch(phone,/\.stream-window\{[^}]*(?:display:none|visibility:hidden)/);
});

test('compact source keeps an accessible full-history control, portfolio, and truthful feed state',()=>{
 assert.match(phone,/\.team-source-bar\{grid-column:2;grid-row:1;min-height:32px/);
 assert.match(html,/id="openTeamWork" aria-haspopup="dialog"/);
 assert.match(html,/id="teamFullSource"/);
 assert.match(html,/id="openPortfolio"/);
 assert.match(html,/id="teamCodingState">NOT CONNECTED/);
 assert.match(html,/Static browser function · not a coding worker/);
 assert.doesNotMatch(phone,/#teamCodingState\{[^}]*display:none/);
});

test('portrait compact rules preserve desktop and short landscape scopes without hiding body overflow',()=>{
 assert.ok(css.indexOf(marker)>css.indexOf('@media(max-width:360px)'));
 assert.ok(css.indexOf(marker)<css.indexOf('@media(max-height:500px)'));
 assert.doesNotMatch(phone,/body\s*\{|overflow\s*:\s*hidden|position\s*:\s*fixed|transform\s*:/);
 assert.doesNotMatch(phone,/font-size\s*:/);
 assert.match(html,/team-work\.css\?v=neptune-market-default-touch-20261010/);
});

test('intrinsic scene/terminal partition leaves all feet and rock above the deck across phone sizes',()=>{
 // Deck sizes deliberately range beyond the compact target, including wrapped
 // status and safe-area space. The grid boundary, not a guessed subtraction,
 // determines each canvas height. This models the authored grid invariant.
 for(const [width,viewport] of [[320,568],[375,603],[390,664],[430,740],[600,900]]){
  for(const deck of [300,340,380]){
   const sceneHeight=viewport-deck;
   const scene=layout(width,sceneHeight);
   assert.ok(scene.rock.y>=0);
   assert.ok(scene.rock.y+scene.rock.h<=sceneHeight+1e-9);
   for(let i=0;i<400;i++){
    const actor=choreography(i/20,width,sceneHeight);
    for(const foot of actor.feet)assert.ok(foot.y<sceneHeight);
    assert.ok(sceneHeight-actor.ground>=sceneHeight*.29);
    assert.ok(actor.ground-actor.size>0);
   }
  }
 }
});
