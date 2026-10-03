/**
 * Pure, approximate, buy-only SPOT planning arithmetic. No orders are placed.
 * Prices, budget, optional risk budget and all cash outputs use quoteCurrency.
 * Percentages are percentage points: 0.1 means 0.1%, not 10%.
 * Required: baseAsset, quoteCurrency, budget, entry, stop, entryFeePercent,
 * exitFeePercent, slippagePercent. Optional: target, riskBudget and a paired
 * trailingActivation/trailingCallbackPercent. Blank required values are errors;
 * an explicit zero is allowed only for fees and assumed exit slippage.
 * Fees are approximated as quote-currency charges, with no rebates or FX.
 * Both exit scenarios use the same user-supplied adverse slippage assumption.
 * Numbers are indicative IEEE-754 estimates, not exchange-valid order amounts.
 */

export const TRADE_PLAN_QUOTES = Object.freeze(['USD', 'USDT', 'USDC', 'AUD']);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const BASE_ASSET = /^[A-Z0-9][A-Z0-9._-]{0,23}$/;
const REQUIRED_NUMBERS = ['budget', 'entry', 'stop', 'entryFeePercent', 'exitFeePercent', 'slippagePercent'];
const OPTIONAL_NUMBERS = ['target', 'riskBudget', 'trailingActivation', 'trailingCallbackPercent'];
const PERCENTS = ['entryFeePercent', 'exitFeePercent', 'slippagePercent'];
const BASE_WARNINGS = Object.freeze([
  'Draft only. No order has been placed. Confirm the pair, prices, fees, fee currency, lot/tick sizes and minimum order requirements in OKX.',
  'Fees are approximate and assumed to be charged in quote currency. No automatic prices or currency conversion are used.',
  'A stop trigger is not a guaranteed execution price. Gaps, slippage, liquidity, partial fills or execution failure can cause loss beyond the estimate. All committed capital is at risk; unmodelled costs may also exceed the stated budget.'
]);

const blank = value => value == null || (typeof value === 'string' && !value.trim());
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  if (!text || text.length > 256 || !NUMBER.test(text)) return NaN;
  const result = Number(text);
  // A nonzero decimal must not silently become an explicit zero assumption.
  if (result === 0 && /[1-9]/.test(text.split(/e/i)[0])) return NaN;
  return Number.isFinite(result) ? result : NaN;
}

/** Returns normalized numeric input and field-keyed errors; never coerces blanks to 0. */
export function validateTradePlan(raw) {
  if (!record(raw)) return { valid: false, errors: { form: 'Enter a spot-buy draft.' }, input: null };
  const errors = {};
  const input = {
    baseAsset: typeof raw.baseAsset === 'string' ? raw.baseAsset.trim().toUpperCase() : '',
    quoteCurrency: typeof raw.quoteCurrency === 'string' ? raw.quoteCurrency.trim().toUpperCase() : ''
  };
  if (!BASE_ASSET.test(input.baseAsset)) errors.baseAsset = 'Enter a base-asset symbol (up to 24 letters, digits, dots, underscores or hyphens).';
  if (!TRADE_PLAN_QUOTES.includes(input.quoteCurrency)) errors.quoteCurrency = 'Choose USD, USDT, USDC or AUD explicitly.';
  if (input.baseAsset && input.baseAsset === input.quoteCurrency) errors.baseAsset = 'Base asset and quote currency must differ.';

  for (const field of [...REQUIRED_NUMBERS, ...OPTIONAL_NUMBERS]) {
    if (blank(raw[field])) {
      input[field] = null;
      if (REQUIRED_NUMBERS.includes(field)) errors[field] = 'Enter a value explicitly.';
      continue;
    }
    const value = readNumber(raw[field]);
    input[field] = Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    if (!Number.isFinite(value)) errors[field] = 'Enter a finite decimal number.';
    else if (PERCENTS.includes(field) ? value < 0 || value >= 100 : value <= 0) {
      errors[field] = PERCENTS.includes(field) ? 'Use a percentage from 0 up to, but below, 100.' : 'Use a value greater than zero.';
    }
  }
  if (!errors.stop && !errors.entry && input.stop >= input.entry) errors.stop = 'For a spot buy, the stop trigger must be below entry.';
  if (input.target !== null && !errors.target && !errors.entry && input.target <= input.entry) errors.target = 'The target must be above entry.';

  const hasActivation = !blank(raw.trailingActivation);
  const hasCallback = !blank(raw.trailingCallbackPercent);
  if (hasActivation && !hasCallback) errors.trailingCallbackPercent = 'Enter a callback percentage with the trailing activation.';
  if (hasCallback && !hasActivation) errors.trailingActivation = 'Enter an activation price with the trailing callback.';
  if (hasActivation && !errors.trailingActivation && !errors.entry && input.trailingActivation < input.entry) errors.trailingActivation = 'Trailing activation must be at or above entry.';
  if (hasCallback && !errors.trailingCallbackPercent && input.trailingCallbackPercent >= 100) errors.trailingCallbackPercent = 'Use a callback percentage greater than 0 and below 100.';
  return { valid: Object.keys(errors).length === 0, errors, input };
}

function calculationFailure(validation) {
  return {
    ...validation,
    valid: false,
    errors: { ...validation.errors, calculation: 'These values exceed reliable numeric range or precision. Check the amounts and price differences.' },
    warnings: [...BASE_WARNINGS],
    plan: null
  };
}

/**
 * Returns { valid, errors, warnings, input, plan }. Invalid results have plan:null.
 * plan.stopLoss is estimated quote loss including both fees, never a maximum.
 * targetGain and rewardRisk can be negative after costs. Optional metrics are
 * null, rather than zero, when the corresponding scenario was not supplied.
 * riskExceeded compares the estimated stop loss only; it is not a loss limit.
 * trailingInitialTrigger is activation * (1 - callback/100), not a future fill.
 */
export function calculateTradePlan(raw) {
  const validation = validateTradePlan(raw);
  if (!validation.valid) return { ...validation, warnings: [...BASE_WARNINGS], plan: null };
  const v = validation.input;
  const entryRate = v.entryFeePercent / 100;
  const exitRate = v.exitFeePercent / 100;
  const slipRate = v.slippagePercent / 100;
  // Algebraically budget / (entry * (1 + entryRate)); this ordering also avoids
  // needless intermediate overflow for very large prices and small quantities.
  const entryNotional = v.budget / (1 + entryRate);
  const quantity = entryNotional / v.entry;
  const entryFee = entryNotional * entryRate;
  const stopExecutionPrice = v.stop * (1 - slipRate);
  const stopGrossProceeds = quantity * stopExecutionPrice;
  const stopExitFee = stopGrossProceeds * exitRate;
  const stopNetProceeds = stopGrossProceeds - stopExitFee;
  const stopLoss = v.budget - stopNetProceeds;
  const stopDistancePercent = ((v.entry - v.stop) / v.entry) * 100;
  const stopLossPercent = (stopLoss / v.budget) * 100;
  let targetExecutionPrice = null, targetExitFee = null, targetNetProceeds = null, targetGain = null, rewardRisk = null;
  if (v.target !== null) {
    targetExecutionPrice = v.target * (1 - slipRate);
    const gross = quantity * targetExecutionPrice;
    targetExitFee = gross * exitRate;
    targetNetProceeds = gross - targetExitFee;
    targetGain = targetNetProceeds - v.budget;
    rewardRisk = targetGain / stopLoss;
  }
  const trailingInitialTrigger = v.trailingActivation === null ? null : v.trailingActivation * (1 - v.trailingCallbackPercent / 100);
  const riskExceeded = v.riskBudget === null ? null : stopLoss > v.riskBudget;
  const plan = {
    quantity, entryNotional, entryFee, totalEntryCost: v.budget,
    stopExecutionPrice, stopExitFee, stopNetProceeds, stopLoss,
    stopDistancePercent, stopLossPercent,
    targetExecutionPrice, targetExitFee, targetNetProceeds, targetGain, rewardRisk,
    riskExceeded, trailingInitialTrigger
  };
  const finite = Object.values(plan).every(value => value === null || typeof value === 'boolean' || Number.isFinite(value));
  const positive = [quantity, entryNotional, stopExecutionPrice, stopGrossProceeds, stopNetProceeds, stopLoss, stopDistancePercent, stopLossPercent];
  if (v.target !== null) positive.push(targetExecutionPrice, targetNetProceeds);
  if (trailingInitialTrigger !== null) positive.push(trailingInitialTrigger);
  // Reject overflow/underflow and costs lost entirely to floating-point precision.
  const feeUnderflow = (v.entryFeePercent > 0 && entryFee <= 0) ||
    (v.exitFeePercent > 0 && (stopExitFee <= 0 || (v.target !== null && targetExitFee <= 0)));
  const lostFee = (v.entryFeePercent > 0 && entryNotional >= v.budget) ||
    (v.exitFeePercent > 0 && (stopNetProceeds >= stopGrossProceeds ||
      (v.target !== null && targetNetProceeds >= quantity * targetExecutionPrice)));
  const lostSlippage = v.slippagePercent > 0 && (stopExecutionPrice >= v.stop || (v.target !== null && targetExecutionPrice >= v.target));
  const lostTrailing = v.trailingCallbackPercent !== null && trailingInitialTrigger >= v.trailingActivation;
  if (!finite || positive.some(value => !(value > 0)) || feeUnderflow || lostFee || lostSlippage || lostTrailing) return calculationFailure(validation);

  const warnings = [...BASE_WARNINGS];
  if (riskExceeded) warnings.push('Estimated stop loss exceeds the supplied risk budget. The risk budget does not cap actual loss.');
  if (targetGain !== null && targetGain <= 0) warnings.push('The target produces no net gain under these fee and slippage assumptions.');
  if (trailingInitialTrigger !== null) warnings.push('The trailing trigger shown is only the initial level at activation. It is not a guaranteed fill or profit lock; verify order behavior in OKX.');
  if (trailingInitialTrigger !== null && trailingInitialTrigger < v.stop) warnings.push('The initial trailing trigger is below the fixed stop trigger. Review how you intend these separate exit instructions to work.');
  return { ...validation, warnings, plan };
}

function sameRecord(left, right) {
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(right).every(key => Object.hasOwn(left, key) && left[key] === right[key]);
}

/** Plain-text manual-review ticket. Invalid or stale supplied results copy nothing. */
export function formatDraftTicket(raw, suppliedResult) {
  const result = calculateTradePlan(raw);
  if (!result.valid) return '';
  if (suppliedResult !== undefined && (!suppliedResult?.valid ||
    !sameRecord(suppliedResult.input, result.input) || !sameRecord(suppliedResult.plan, result.plan))) return '';
  const { input: v, plan: p } = result;
  // Keep meaningful tiny prices and avoid turning small nonzero values into 0.00.
  const money = value => `${value} ${v.quoteCurrency}`;
  const lines = [
    'MANUAL SPOT BUY DRAFT — NO ORDER PLACED',
    `Pair: ${v.baseAsset}/${v.quoteCurrency} (availability unverified)`,
    `Budget including estimated entry fee: ${money(v.budget)}`,
    `Limit entry: ${money(v.entry)}`,
    `Indicative quantity before exchange rounding: ${p.quantity} ${v.baseAsset}`,
    `Estimated entry notional: ${money(p.entryNotional)}`,
    `Entry fee assumption: ${v.entryFeePercent}% (${money(p.entryFee)})`,
    `Exit fee assumption: ${v.exitFeePercent}%`,
    `Adverse exit slippage assumption: ${v.slippagePercent}%`,
    `Stop trigger: ${money(v.stop)}`,
    `Assumed stop execution price: ${money(p.stopExecutionPrice)}`,
    `Estimated stop exit fee: ${money(p.stopExitFee)}`,
    `Estimated stop loss including fees: ${money(p.stopLoss)}`,
    `Stop trigger distance below entry: ${p.stopDistancePercent}%`
  ];
  if (v.target !== null) lines.push(
    `Target trigger/reference: ${money(v.target)}`,
    `Assumed target execution price: ${money(p.targetExecutionPrice)}`,
    `Estimated target exit fee: ${money(p.targetExitFee)}`,
    `Estimated target net gain/loss: ${money(p.targetGain)}`,
    `Estimated net reward/risk: ${p.rewardRisk}`
  );
  if (v.riskBudget !== null) lines.push(`Risk budget for comparison only: ${money(v.riskBudget)} (${p.riskExceeded ? 'estimated stop loss exceeds budget' : 'estimated stop loss within budget; actual loss may exceed it'})`);
  if (v.trailingActivation !== null) lines.push(
    `Trailing activation: ${money(v.trailingActivation)}`,
    `Trailing callback: ${v.trailingCallbackPercent}%`,
    `Illustrative initial trailing trigger: ${money(p.trailingInitialTrigger)}`
  );
  return [...lines, '', ...result.warnings].join('\n');
}
