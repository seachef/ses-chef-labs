'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script id="returnScenarioScript">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'The deployed HTML includes its scenario calculator');
const math = {module:{exports:{}}};
vm.runInNewContext(source, math);
const {project} = math.module.exports;

test('neutral default keeps A$5,000 unchanged for two years', () => {
  const result = project(5000, 2, 0);
  assert.equal(result.balance, 5000);
  assert.equal(result.profit, 0);
});
test('positive returns compound price changes annually', () => {
  assert.equal(project(5000, 2, 20).balance, 7200);
  assert.equal(project(5000, 2, 20).profit, 2200);
  assert.equal(project(5000, 2, 100).balance, 20000);
});
test('negative returns include total loss without a negative balance', () => {
  assert.equal(project(5000, 2, -20).balance.toFixed(2), '3200.00');
  assert.equal(project(5000, 2, -20).profit.toFixed(2), '-1800.00');
  for (const years of [1, 2, 30]) {
    assert.equal(project(5000, years, -100).balance, 0);
    assert.equal(project(5000, years, -100).profit, -5000);
  }
});
test('zero principal stays zero; valid boundaries remain finite', () => {
  for (const rate of [-100, 0, 100]) assert.equal(project(0, 2, rate).balance, 0);
  assert.ok(Number.isFinite(project(1e9, 30, 100).balance));
});
test('invalid numeric values fail rather than show misleading results', () => {
  for (const amount of [NaN, Infinity, -1, 1e9+1, '', null]) assert.throws(() => project(amount, 2, 0));
  for (const years of [NaN, Infinity, 0, -1, 1.5, 31, '2']) assert.throws(() => project(5000, years, 0));
  for (const rate of [NaN, Infinity, -101, 101, 0.5, '20']) assert.throws(() => project(5000, 2, rate));
});

function fixture() {
  const ids = ['scenarioAmount','scenarioYears','scenarioRate','scenarioRateValue','scenarioError','scenarioBalanceLabel','scenarioBalance','scenarioProfit'];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    textContent:'', className:'', attrs:{}, validity:{valid:true}, listeners:{},
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
  nodes.scenarioAmount.valueAsNumber = 5000;
  nodes.scenarioYears.valueAsNumber = 2;
  nodes.scenarioRate.valueAsNumber = 0;
  vm.runInNewContext(source, {document:{getElementById:id => nodes[id]}});
  const change = (id, value, valid=true) => {
    nodes[id].valueAsNumber = value;
    nodes[id].validity.valid = valid;
    nodes[id].listeners.input();
  };
  return {nodes, change};
}
test('input events update labels, AUD results and signed text', () => {
  const {nodes:n, change} = fixture();
  assert.equal(n.scenarioBalance.textContent, 'A$5,000.00');
  assert.equal(n.scenarioProfit.textContent, 'A$0.00');
  assert.equal(n.scenarioProfit.className, '');
  change('scenarioRate',20);
  assert.equal(n.scenarioBalance.textContent, 'A$7,200.00');
  assert.equal(n.scenarioProfit.textContent, '+A$2,200.00');
  assert.equal(n.scenarioRate.attrs['aria-valuetext'], '+20% per year');
  change('scenarioRate',-100);
  assert.equal(n.scenarioBalance.textContent, 'A$0.00');
  assert.equal(n.scenarioProfit.textContent, '−A$5,000.00');
  assert.equal(n.scenarioProfit.className, 'paper-negative');
  change('scenarioRate',0);
  change('scenarioAmount',1234.56);
  change('scenarioYears',1);
  assert.equal(n.scenarioBalance.textContent, 'A$1,234.56');
  assert.equal(n.scenarioBalanceLabel.textContent, 'Projected balance after 1 year');
});
test('invalid/cleared inputs clear stale results and recover on correction', () => {
  const {nodes:n, change} = fixture();
  change('scenarioAmount',NaN,false);
  assert.equal(n.scenarioBalance.textContent, '—');
  assert.equal(n.scenarioProfit.textContent, '—');
  assert.match(n.scenarioError.textContent, /Enter an amount/);
  assert.equal(n.scenarioAmount.attrs['aria-invalid'], 'true');
  change('scenarioAmount',5000);
  assert.equal(n.scenarioBalance.textContent, 'A$5,000.00');
  assert.equal(n.scenarioError.textContent, '');
  assert.equal(n.scenarioAmount.attrs['aria-invalid'], 'false');
  change('scenarioYears',0,false);
  assert.match(n.scenarioError.textContent, /whole years/);
  change('scenarioYears',2);
  change('scenarioRate',101,false);
  assert.equal(n.scenarioProfit.textContent, '—');
  assert.match(n.scenarioError.textContent, /annual return/);
});
test('tiny negative values do not display a negative zero profit', () => {
  const {nodes:n, change} = fixture();
  change('scenarioAmount',0.01);
  change('scenarioYears',1);
  change('scenarioRate',-1);
  assert.equal(n.scenarioProfit.textContent, 'A$0.00');
});
test('controls are labeled, keyboard-native and explain assumptions', () => {
  assert.match(html, /for="scenarioAmount"/);
  assert.match(html, /for="scenarioYears"/);
  assert.match(html, /for="scenarioRate"/);
  assert.match(html, /id="scenarioRate" type="range" min="-100" max="100" step="1" value="0"/);
  assert.match(html, /class="scenario-results" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /Hypothetical before fees\/taxes/);
  assert.match(html, /not earned interest or a forecast/);
  assert.match(html, /No staking or lockups/);
  assert.doesNotMatch(source, /\b(fetch|localStorage|sessionStorage)\s*[.(]/);
});
