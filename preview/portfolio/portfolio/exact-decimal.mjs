/** Bounded decimal arithmetic. Decimal operands never pass through Number. */
const MAX_DIGITS = 1000;
const MAX_SCALE = 1000;
export function decimal(value, { signed = false, exponent = false, positive = false } = {}) {
  if (typeof value !== 'string' || value.length > MAX_DIGITS) throw new TypeError('invalid_decimal');
  const pattern = exponent
    ? /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
    : /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?$/;
  const match = pattern.exec(value);
  if (!match || (!signed && match[1])) throw new TypeError('invalid_decimal');
  let digits = match[2] + (match[3] || '');
  let scale = (match[3] || '').length - Number(match[4] || 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > MAX_SCALE) throw new RangeError('invalid_decimal');
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  if (digits.length > MAX_DIGITS) throw new RangeError('invalid_decimal');
  let integer = BigInt(digits) * (match[1] === '-' ? -1n : 1n);
  if (positive && integer <= 0n) throw new RangeError('invalid_decimal');
  while (scale && integer % 10n === 0n) { integer /= 10n; scale--; }
  return { integer, scale };
}

export function decimalText({ integer, scale }, { sign = false } = {}) {
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString().padStart(scale + 1, '0');
  const magnitude = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return (negative ? '-' : sign && integer > 0n ? '+' : '') + magnitude;
}

export function subtract(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return { integer: a.integer * 10n ** BigInt(scale - a.scale) - b.integer * 10n ** BigInt(scale - b.scale), scale };
}

export function multiply(a, b) {
  return { integer: a.integer * b.integer, scale: a.scale + b.scale };
}

export function compare(a, b) {
  const difference = subtract(a, b).integer;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Keep the exact fraction alongside an explicitly rounded decimal rendering. */
export function percentageChange(current, baseline, places = 18) {
  if (!Number.isInteger(places) || places < 0 || places > 100 || baseline.integer <= 0n) throw new TypeError('invalid_percentage');
  const difference = subtract(current, baseline);
  let numerator = difference.integer * 100n * 10n ** BigInt(baseline.scale);
  let denominator = baseline.integer * 10n ** BigInt(difference.scale);
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a; denominator /= a;
  const negative = numerator < 0n, magnitude = negative ? -numerator : numerator;
  const scaled = magnitude * 10n ** BigInt(places), remainder = scaled % denominator;
  const integer = (scaled / denominator + (remainder * 2n >= denominator ? 1n : 0n)) * (negative ? -1n : 1n);
  return {
    value: decimalText({ integer, scale: places }, { sign: true }),
    numerator: numerator.toString(), denominator: denominator.toString(),
    decimalPlaces: places, rounding: 'half_away_from_zero', approximate: remainder !== 0n,
  };
}

/** Validate JSON grammar first, then turn every original number lexeme into a string. */
export function parseLosslessJson(source) {
  if (typeof source !== 'string' || source.length > 512 * 1024) throw new TypeError('invalid_json');
  // This validation result is discarded: no parsed IEEE number is used in arithmetic.
  try { JSON.parse(source); } catch { throw new TypeError('invalid_json'); }
  let result = '', i = 0;
  while (i < source.length) {
    if (source[i] === '"') {
      const start = i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === '"') break;
      }
      result += source.slice(start, i);
    } else if (source[i] === '-' || /[0-9]/.test(source[i])) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!number) throw new TypeError('invalid_json');
      result += JSON.stringify(number[0]); i += number[0].length;
    } else result += source[i++];
  }
  return JSON.parse(result);
}
