import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VENUES, DESTINATIONS, destinationFor, approvedDestination, handoffState, mountExchangeHandoff } from '../exchange-handoff.mjs';

class Element {
  constructor() { this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.disabled = false; this.textWrites = 0; this._text = ''; }
  set textContent(value) { this.textWrites++; this._text = String(value); }
  get textContent() { return this._text; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); }
  addEventListener(k, fn) { this.listeners.set(k, fn); }
  removeEventListener(k) { this.listeners.delete(k); }
  dispatch(type) { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.listeners.get(type)?.(e); return e; }
}
function harness(t) {
  const nodes = new Map(), doc = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement() { return new Element(); } };
  const app = mountExchangeHandoff(doc); t.after(() => app.destroy());
  const get = id => doc.getElementById(`handoff-${id}`);
  const choose = (venue, pair) => { get('venue').value = venue; get('venue').dispatch('change'); if (pair) { get('pair').value = pair; get('pair').dispatch('change'); } };
  const snapshot = () => JSON.stringify([...nodes].map(([id, n]) => [id, n.textContent, n.value, n.disabled, [...n.attributes], n.children.map(c => [c.value, c.textContent])]));
  return { app, get, choose, snapshot };
}

test('navigation allowlist binds exact venue and spot pair; no generic symbol interpolation', () => {
  assert.deepEqual(DESTINATIONS.map(d => [d.venue, d.pair, d.url]), [
    ['okx', 'BTC-AUD', 'https://www.okx.com/en-au/trade-spot/btc-aud'],
    ['okx', 'ETH-AUD', 'https://www.okx.com/en-au/trade-spot/eth-aud'],
    ['okx', 'SOL-AUD', 'https://www.okx.com/en-au/trade-spot/sol-aud'],
    ['okx', 'BTC-USDT', 'https://www.okx.com/en-au/trade-spot/btc-usdt'],
    ['okx', 'ETH-USDT', 'https://www.okx.com/en-au/trade-spot/eth-usdt'],
    ['okx', 'SOL-USDT', 'https://www.okx.com/en-au/trade-spot/sol-usdt'],
    ['coinspot', 'BTC-AUD', 'https://www.coinspot.com.au/trade/BTC'],
    ['coinspot', 'ETH-AUD', 'https://www.coinspot.com.au/trade/ETH'],
    ['coinspot', 'SOL-AUD', 'https://www.coinspot.com.au/trade/SOL'],
    ['coinspot', 'USDT-AUD', 'https://www.coinspot.com.au/trade/USDT'],
  ]);
  assert.ok(Object.isFrozen(DESTINATIONS) && DESTINATIONS.every(Object.isFrozen) && VENUES.every(Object.isFrozen));
  for (const d of DESTINATIONS) {
    assert.equal(approvedDestination(d.venue, d.pair, d.url), true);
    const url = new URL(d.url); assert.equal(url.protocol, 'https:'); assert.equal(url.search + url.hash + url.username + url.password + url.port, '');
    assert.equal(approvedDestination(d.venue === 'okx' ? 'coinspot' : 'okx', d.pair, d.url), false);
  }
  for (const symbol of ['XLM-AUD', 'STR-AUD', 'A-AUD', 'EOS-AUD', 'NEO-AUD', 'ANS-AUD', 'BTC-USD', '__proto__', 'constructor']) {
    assert.equal(destinationFor('coinspot', symbol), null); assert.equal(destinationFor('okx', symbol), null);
  }
});

test('hostile, normalized aliases and side/prefill URL parameters fail exact approval', () => {
  const valid = 'https://www.okx.com/en-au/trade-spot/btc-aud';
  for (const value of [null, undefined, {}, { toString: () => valid }, 'javascript:alert(1)', 'data:text/html,x', '//www.okx.com/en-au/trade-spot/btc-aud',
    valid + '?side=buy', valid + '?amount=1', valid + '#buy', valid + '/', valid + '\n', ' ' + valid,
    valid.replace('https:', 'http:'), valid.replace('www.okx.com', 'www.okx.com.evil.test'), valid.replace('www.okx.com', 'www.okx.com@evil.test'),
    valid.replace('www.okx.com', 'user:pass@www.okx.com'), valid.replace('www.okx.com', 'www.okx.com:443'),
    valid.replace('www.okx.com', 'WWW.OKX.COM'), valid.replace('btc-aud', '%62tc-aud'), 'okx://trade/btc-aud',
    'https://www.coinspot.com.au/trade/BTC', 'https://www.coinspot.com.au/buy/BTC']) {
    assert.equal(approvedDestination('okx', 'BTC-AUD', value), false, String(value));
  }
});

test('missing, stale, unreviewed, mismatched or apparently fresh setup-like data cannot enable unsupported trade actions', () => {
  const fake = { venue: 'okx', pair: 'BTC-AUD', action: 'BUY', reviewed: true, entry: 100, stop: 99, target: 102, feeBps: 0, expiresAt: Date.now() + 10000 };
  for (const setup of [undefined, null, {}, fake, { ...fake, expiresAt: 0 }, { ...fake, reviewed: false }, { ...fake, venue: 'coinspot' },
    { ...fake, pair: 'BTC-USD' }, { ...fake, feeBps: null }, { ...fake, quote: { stale: true } }]) {
    const state = handoffState({ venue: 'okx', pair: 'BTC-AUD', setup });
    assert.equal(state.action, 'WAIT'); assert.equal(state.buyEnabled, false); assert.equal(state.sellEnabled, false);
    assert.match(state.reason, /no fresh independently reviewed setup/);
  }
});

test('initial controls fail closed and explicit venue changes reset pair and external destination', t => {
  const h = harness(t);
  assert.equal(h.get('venue').value, ''); assert.equal(h.get('pair').disabled, true); assert.equal(h.get('link').getAttribute('href'), null);
  assert.equal(h.get('link').dispatch('click').defaultPrevented, true);
  h.choose('okx', 'BTC-AUD'); assert.equal(h.get('link').getAttribute('href'), 'https://www.okx.com/en-au/trade-spot/btc-aud');
  assert.equal(h.get('sell').textContent, 'Sell · OKX'); assert.equal(h.get('buy').disabled, true); assert.equal(h.get('sell').disabled, true);
  h.choose('coinspot'); assert.equal(h.get('pair').value, ''); assert.equal(h.get('link').getAttribute('href'), null);
  assert.equal(h.get('sell').textContent, 'Sell'); assert.equal(h.get('link').dispatch('click').defaultPrevented, true);
  h.get('pair').value = 'BTC-AUD'; h.get('pair').dispatch('change');
  assert.equal(h.get('link').getAttribute('href'), 'https://www.coinspot.com.au/trade/BTC'); assert.equal(h.get('sell').textContent, 'Sell · CoinSpot');
  assert.match(h.get('selection').textContent, /where you hold the asset\. No transfer/);
  h.choose('okx', 'USDT-AUD'); assert.equal(h.get('link').getAttribute('href'), null);
  h.choose('https://evil.test', 'BTC-AUD'); assert.equal(h.get('venue').value, ''); assert.equal(h.get('pair').disabled, true);
});

test('tampered href and mismatched selection cannot navigate to another venue', t => {
  const h = harness(t); h.choose('okx', 'BTC-AUD');
  h.get('link').setAttribute('href', 'https://www.coinspot.com.au/trade/BTC'); assert.equal(h.get('link').dispatch('click').defaultPrevented, true);
  h.get('link').setAttribute('href', 'javascript:alert(1)'); assert.equal(h.get('link').dispatch('auxclick').defaultPrevented, true);
  h.get('venue').value = 'coinspot'; assert.equal(h.get('link').dispatch('click').defaultPrevented, true);
  assert.equal(h.get('venue').value, ''); assert.equal(h.get('link').getAttribute('href'), null);
  h.choose('coinspot', 'BTC-AUD'); h.get('pair').value = 'ETH-AUD'; assert.equal(h.get('link').dispatch('click').defaultPrevented, true);
  assert.equal(h.get('link').getAttribute('href'), null);
});

test('repeated navigation has no fetch, fill, account state, side selection or trade handler', t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('HANDOFF_MUST_NOT_FETCH'); });
  const h = harness(t); h.choose('coinspot', 'SOL-AUD'); const before = h.snapshot();
  for (let i = 0; i < 10; i++) {
    assert.equal(h.get('link').dispatch('click').defaultPrevented, false);
    assert.equal(h.get('link').dispatch('auxclick').defaultPrevented, false);
    h.get('buy').dispatch('click'); h.get('sell').dispatch('click');
    assert.equal(h.snapshot(), before);
  }
  assert.equal(h.get('buy').listeners.size, 0); assert.equal(h.get('sell').listeners.size, 0);
  assert.equal(h.get('link').getAttribute('target'), '_blank'); assert.equal(h.get('link').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(h.get('link').getAttribute('referrerpolicy'), 'no-referrer');
  const source = fs.readFileSync(new URL('../exchange-handoff.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b|window\.open|location\.|document\.cookie|innerHTML/);
});

test('cost copy distinguishes product categories and never assigns an OKX personal rate', t => {
  const h = harness(t); h.choose('coinspot', 'BTC-AUD');
  assert.match(h.get('costs').textContent, /Markets: 0\.1% each side/); assert.match(h.get('costs').textContent, /Instant and conditional stop\/target products: 1%/);
  h.choose('okx', 'BTC-USDT'); assert.match(h.get('costs').textContent, /pair-specific maker\/taker fee is unknown/);
  assert.doesNotMatch(h.get('costs').textContent, /\d+(?:\.\d+)?%|cheapest|guarantee/i);
  assert.equal(h.get('buy').disabled, true); assert.equal(h.get('sell').disabled, true);
});

test('destroy removes navigation and selection handlers, clears destination and retains WAIT', t => {
  const h = harness(t); h.choose('okx', 'ETH-AUD'); h.app.destroy();
  for (const id of ['venue', 'pair', 'link', 'buy', 'sell']) assert.equal(h.get(id).listeners.size, 0);
  assert.equal(h.get('link').getAttribute('href'), null); assert.equal(h.get('buy').disabled, true); assert.equal(h.get('sell').disabled, true);
});

test('unchanged clock and quote paints do not repeatedly mutate the WAIT live region', t => {
  const h = harness(t), before = h.get('reason').textWrites;
  for (let i = 0; i < 10; i++) h.app.paint();
  h.choose('okx', 'BTC-AUD'); h.choose('coinspot', 'ETH-AUD');
  assert.equal(h.get('reason').textWrites, before);
});

test('compact handoff markup has explicit labels, safe static controls and narrow-screen layout rules', () => {
  const html = fs.readFileSync(new URL('../public.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const block = html.match(/<div id="exchange-handoff"[\s\S]+?<p id="execution-note">/)[0];
  for (const id of ['handoff-venue', 'handoff-pair']) assert.ok(block.includes(`for="${id}"`) && block.includes(`id="${id}"`));
  assert.match(block, /id="handoff-buy"[^>]*disabled[^>]*aria-describedby="handoff-reason"/);
  assert.match(block, /id="handoff-sell"[^>]*disabled[^>]*aria-describedby="handoff-reason"/);
  assert.doesNotMatch(block.match(/<a id="handoff-link"[^>]*>/)[0], /\bhref=/);
  assert.match(block, /opening this page places no order/); assert.match(block, /holdings, fills and protective orders are not verified/);
  for (const summary of html.matchAll(/<summary[^>]*>(.*?)<\/summary>/gs)) assert.doesNotMatch(summary[1], /<(?:a|button|select)\b/);
  assert.equal((html.match(/<section\b/g) ?? []).length, 5);
  assert.match(css, /\.handoff-selection\s*\{[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 360px\)[^}]*\.handoff-selection[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /select:focus-visible/); assert.match(css, /#handoff-link:focus-visible/);
  assert.match(css, /select\s*\{[^}]*min-height: 44px/); assert.match(css, /#handoff-link\s*\{[^}]*min-height: 44px/);
  assert.doesNotMatch(css, /position:\s*(?:fixed|sticky)|(?:max-)?height:\s*\d+(?:vh|dvh)/);
});
