/** Pure provider/domain helpers. No network, credentials, transactions or signing. */
const UINT256_MAX = (1n << 256n) - 1n;
const RAW = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const READ_METHODS = new Set(['eth_getBalance', 'eth_blockNumber', 'eth_call', 'alchemy_getTokenBalances', 'alchemy_getTokenMetadata']);
export function rawUnits(value) {
  if (typeof value !== 'string' || !(RAW.test(value) || /^0x[0-9a-f]+$/i.test(value))) throw new TypeError('Raw balance must be an unsigned integer string');
  const n = BigInt(value);
  if (n < 0n || n > UINT256_MAX) throw new RangeError('Raw balance exceeds uint256');
  return n.toString();
}
export function formatUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError('Invalid token decimals');
  const n = rawUnits(value);
  if (!decimals) return n;
  const padded = n.padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`.replace(/\.?0+$/, '') || '0';
}
function decimalParts(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value) || value.length > 1000) throw new TypeError('Expected canonical nonnegative decimal string');
  const [whole, fraction = ''] = value.split('.');
  return [BigInt(whole + fraction), fraction.length];
}
export function multiplyDecimals(left, right) {
  const [a, as] = decimalParts(left), [b, bs] = decimalParts(right);
  const scale = as + bs, n = (a * b).toString();
  if (!scale) return n;
  const padded = n.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, '') || '0';
}
export function indicativeValues(raw, decimals, priceUsd, usdToAud) {
  const quantity = formatUnits(raw, decimals);
  const usd = priceUsd == null ? null : multiplyDecimals(quantity, priceUsd);
  const aud = usd == null || usdToAud == null ? null : multiplyDecimals(usd, usdToAud);
  return { quantity, usd, aud };
}
export function readonlyRpc(method, params, id = 1) {
  if (!READ_METHODS.has(method)) throw new Error('Only approved read-only RPC methods are allowed');
  if (!Array.isArray(params)) throw new TypeError('RPC params must be an array');
  return { jsonrpc: '2.0', id, method, params };
}
export function tokenBalanceRow(providerRow) {
  if (providerRow == null || providerRow.error || providerRow.tokenBalance == null) throw new Error('Token balance unavailable');
  const asset_id = String(providerRow.contractAddress || '').toLowerCase();
  if (!ADDRESS.test(asset_id)) throw new Error('Invalid token identity');
  return { asset_id, balance_raw: rawUnits(providerRow.tokenBalance) };
}
export function selectDexQuote(pairs, { chainId, tokenAddress, minLiquidityUsd, observedAt }) {
  if (!Number.isFinite(minLiquidityUsd) || minLiquidityUsd < 0) throw new TypeError('An explicit minimum liquidity policy is required');
  if (!Number.isFinite(Date.parse(observedAt))) throw new TypeError('Observation timestamp is required');
  const address = String(tokenAddress).toLowerCase();
  if (!ADDRESS.test(address)) throw new TypeError('Token contract required');
  const candidates = (Array.isArray(pairs) ? pairs : []).filter(p =>
    p?.chainId === chainId && String(p?.baseToken?.address).toLowerCase() === address &&
    typeof p?.priceUsd === 'string' && DECIMAL.test(p.priceUsd) && decimalParts(p.priceUsd)[0] > 0n &&
    Number.isFinite(p?.liquidity?.usd) && p.liquidity.usd >= minLiquidityUsd &&
    ADDRESS.test(String(p?.pairAddress).toLowerCase())
  ).sort((a, b) => b.liquidity.usd - a.liquidity.usd || a.pairAddress.localeCompare(b.pairAddress));
  if (!candidates.length) return { price_usd: null, price_status: 'missing', price_observed_at: null, price_pair_address: null, price_source: null };
  const p = candidates[0];
  return { price_usd: p.priceUsd, price_status: 'observed', price_observed_at: observedAt,
    price_pair_address: p.pairAddress.toLowerCase(), price_source: 'DEX Screener' };
}
