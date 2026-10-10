import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./neptune.mjs', import.meta.url), 'utf8');
const roles = [
  ['Scout', 'scout', 'Scout: Market coverage', 'scoutDialog'],
  ['Depth', 'depth', 'Depth: Liquidity checks', 'depthDialog'],
  ['Pulse', 'pulse', 'Pulse: Entry signals', 'findingsDialog'],
  ['Shield', 'shield', 'Shield: Risk and costs', 'shieldDialog'],
  ['Ledger', 'ledger', 'Buys and sells: Simulated executions', 'historyDialog'],
  ['Watch', 'watch', 'Watch: Data health', 'runtimeDialog'],
];
const windowButtons = [...html.matchAll(/<button class="stream-window"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

test('six market web nodes show their actual evidence roles', () => {
  assert.equal(windowButtons.length, 6);
  for (const [index, button] of windowButtons.entries()) {
    const label = `Market check ${String(index + 1).padStart(3, '0')}`;
    assert.ok(button.includes(`id="open${roles[index][0]}Stream"`));
    assert.ok(button.includes(`<span class="stream-top"><span class="stream-name">${['SCOUT','DEPTH','SIGNALS','RISK','TRADES','HEALTH'][index]}</span>`));
    assert.doesNotMatch(button, /<h[1-6]\b/);
  }
});

test('numbered windows retain their role, evidence descriptions and native dialog controls', () => {
  for (const [index, [stream, id, role, dialog]] of roles.entries()) {
    const label = `Market check ${String(index + 1).padStart(3, '0')}`;
    const button = windowButtons[index];
    assert.ok(button.includes(`aria-label="${label}. ${role}. Open `));
    assert.ok(button.includes(`aria-describedby="${id}Status ${id}Output ${id}Time"`));
    assert.ok(button.includes('aria-haspopup="dialog"'));
    for (const suffix of ['Status', 'Output', 'Time']) assert.ok(button.includes(`id="${id}${suffix}"`));
    const detail = html.split(`<dialog id="${dialog}"`)[1].split('</dialog>')[0];
    assert.ok(detail.includes(`<p class="agent-role">${label} · ${role}</p>`));
    assert.match(detail, /<button id="close[^" ]+"/);
    assert.ok(source.includes(`['${stream}',`));
  }
});

test('numbered labels do not replace evidence or claim independent live workers', () => {
  assert.match(html, /The six windows are automated evidence streams, not six independent live AI agents\./);
  assert.match(html, /observed interface checks and verified paper reports/);
  assert.equal((html.match(/Waiting for verified evidence\./g) || []).length, 6);
  assert.equal((html.match(/No observation yet/g) || []).length, 6);
  assert.match(source, /show\('scout',scout.status,scout.output,scout.at\)/);
  assert.match(source, /show\('watch',busy\?'CHECKING'/);
});
