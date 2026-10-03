/**
 * Interactive rendering of saved holdings observations, never market returns.
 * The parent owns scoping, privacy masking, attribution, exact-value reading,
 * an accessible table/scrubber, and the observation-spaced-axis explanation.
 * No fetch, storage, timers, invented observations, or animated price updates.
 */
const MIN_HEIGHT = 260;
// A conservative display boundary, not a claim about collection frequency.
export const HOLDINGS_CONNECTOR_LIMIT_MS = 36 * 60 * 60 * 1000;
const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const loadVendor = () => import('../vendor/lightweight-charts-5.2.1.mjs');

function coordinate(value) {
  if (typeof value !== 'string' || value.length > 4096 || !DECIMAL.test(value)) return null;
  const number = Number(value);
  // Never misdraw overflow, or a positive value that underflows to zero.
  return Number.isFinite(number) && number >= 0 && (number > 0 || !/[1-9]/.test(value)) ? number : null;
}
function timestamp(at) {
  if (typeof at !== 'string' || !at.trim()) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms / 1000 : null;
}
function observationAutoscale(original) {
  const info = original();
  const range = info?.priceRange;
  if (!range || !Number.isFinite(range.minValue) || range.minValue !== range.maxValue) return info;
  // A single/equal value needs viewport room, never another data point. The
  // vendor's fixed minMove padding can disappear for very large coordinates.
  const value = range.minValue;
  const padding = value === 0 ? 1 : Math.abs(value) * 0.02 || Number.MIN_VALUE * 1024;
  const low = value - padding, high = value + padding;
  return { ...info, priceRange: { minValue: Number.isFinite(low) ? low : value,
    maxValue: Number.isFinite(high) ? high : value } };
}

/** Pure projection; exact strings and caller-owned rows are never changed. */
export function holdingsChartData(summary) {
  const points = Array.isArray(summary?.points) ? summary.points : [];
  const dated = new Map();
  let undatedCount = 0;
  points.forEach((point, index) => {
    const time = timestamp(point?.at);
    if (time === null) { undatedCount++; return; }
    const value = point?.eligible === true ? coordinate(point.value) : null;
    if (dated.has(time)) {
      // The history adapter normally deduplicates. Ambiguous equal instants
      // fail closed here instead of choosing a possibly wrong value.
      dated.set(time, { time, value: null, point: null, index: -1 });
    } else dated.set(time, { time, value, point, index });
  });
  const rows = [...dated.values()].sort((a, b) => a.time - b.time);
  const runs = [];
  let run = [], previous = null;
  const finishRun = () => { if (run.length > 1) runs.push(run); run = []; };
  for (const row of rows) {
    if (row.value === null) { finishRun(); previous = null; continue; }
    const key = row.point.scopeKey;
    const joins = !undatedCount && previous && typeof key === 'string' && key.length > 0 &&
      key === previous.point.scopeKey && row.index === previous.index + 1 &&
      (row.time - previous.time) * 1000 <= HOLDINGS_CONNECTOR_LIMIT_MS;
    if (!joins) finishRun();
    run.push({ time: row.time, value: row.value });
    previous = row;
  }
  finishRun();
  return {
    rows,
    // Whitespace occurs only at a real dated-but-unusable observation. It is
    // never used to fabricate regular sampling or pad a time range.
    markers: rows.map(({ time, value }) => value === null ? { time } : { time, value }),
    runs,
    observationCount: rows.filter(row => row.value !== null).length,
    gapCount: rows.filter(row => row.value === null).length,
    undatedCount,
    connectionCount: runs.reduce((count, segment) => count + segment.length - 1, 0)
  };
}

/**
 * library may be a module, a promise, or an async loader (primarily for tests).
 * update(summary) resolves with status ready/empty/error/superseded/destroyed
 * plus observationCount, gapCount, undatedCount, and connectionCount when valid.
 * onInspect(originalPoint|null, {index, source}) uses exact caller data.
 * clear() removes all owned DOM and invalidates pending updates; it is reusable.
 * destroy() is terminal. reset() fits only actual recorded observations.
 */
export function createHoldingsChart({ container, library, onInspect } = {}) {
  if (!container?.ownerDocument?.createElement || typeof container.appendChild !== 'function') {
    throw new TypeError('A holdings chart container is required');
  }
  const document = container.ownerDocument;
  const view = document.defaultView || globalThis;
  let destroyed = false, version = 0, loaded = null, active = null;
  const originalMinHeight = container.style?.minHeight || '';
  const reservedHeight = !originalMinHeight;
  if (reservedHeight) container.style.minHeight = `${MIN_HEIGHT}px`;

  const notify = (point, index, source) => {
    // A consumer's reading/tooltip failure must not prevent private-data cleanup.
    try { onInspect?.(point, { index, source }); } catch { /* Parent owns its UI. */ }
  };
  function release() {
    const old = active;
    active = null;
    if (!old) return;
    old.rows.clear();
    try { old.observer?.disconnect(); } catch { /* Still finish private-data cleanup. */ }
    view.removeEventListener?.('resize', old.resize);
    try { old.chart?.unsubscribeCrosshairMove(old.move); } catch { /* Already removed. */ }
    try { old.chart?.unsubscribeClick(old.click); } catch { /* Already removed. */ }
    try { old.chart?.clearCrosshairPosition?.(); } catch { /* Already removed. */ }
    try { old.chart?.remove(); } catch { /* Still remove every owned canvas below. */ }
    old.host.remove();
  }
  function clear() {
    version++;
    release();
    notify(null, -1, 'clear');
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clear();
    if (reservedHeight && container.style.minHeight === `${MIN_HEIGHT}px`) container.style.minHeight = originalMinHeight;
    loaded = null;
  }
  function reset() {
    if (destroyed || !active?.chart) return false;
    active.chart.priceScale('right').applyOptions({ autoScale: true });
    active.chart.timeScale().fitContent();
    // Logical padding is viewport space, not invented time/value data.
    if (active.rows.size === 1) active.chart.timeScale().setVisibleLogicalRange({ from: -1, to: 1 });
    active.chart.clearCrosshairPosition?.();
    notify(null, -1, 'clear');
    return true;
  }
  const load = () => {
    if (!loaded) loaded = Promise.resolve().then(() => typeof library === 'function' ? library() : library || loadVendor())
      .catch(error => { loaded = null; throw error; });
    return loaded;
  };
  async function update(summary) {
    if (destroyed) return { status: 'destroyed' };
    const ticket = ++version;
    release();
    notify(null, -1, 'clear');
    if (destroyed || ticket !== version) return { status: destroyed ? 'destroyed' : 'superseded' };
    const data = holdingsChartData(summary);
    const counts = { observationCount: data.observationCount, gapCount: data.gapCount,
      undatedCount: data.undatedCount, connectionCount: data.connectionCount };
    if (!data.observationCount) return { status: 'empty', ...counts };
    try {
      const lib = await load();
      if (destroyed || ticket !== version) return { status: destroyed ? 'destroyed' : 'superseded' };
      if (typeof lib?.createChart !== 'function' || !lib.LineSeries) throw new TypeError('Chart library unavailable');
      const host = document.createElement('div');
      host.className = 'pv-holdings-chart-canvas';
      host.setAttribute('aria-hidden', 'true');
      host.style.width = '100%';
      host.style.height = '100%';
      host.style.minHeight = `${MIN_HEIGHT}px`;
      container.appendChild(host);
      const current = { host, chart: null, rows: new Map(data.rows.map(row => [row.time, row])), observer: null };
      active = current;
      const dimensions = () => ({
        width: Math.max(10, Math.floor(container.clientWidth || container.getBoundingClientRect?.().width || 320)),
        height: Math.max(MIN_HEIGHT, Math.floor(container.clientHeight || container.getBoundingClientRect?.().height || MIN_HEIGHT))
      });
      const dashed = lib.LineStyle?.Dashed ?? 2;
      const chart = lib.createChart(host, {
        ...dimensions(), autoSize: false,
        layout: { background: { type: lib.ColorType?.Solid || 'solid', color: 'transparent' }, textColor: '#98a8a3',
          fontFamily: 'system-ui, sans-serif', fontSize: 11, attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(154, 180, 169, 0.1)' } },
        leftPriceScale: { visible: false },
        // Numeric library labels would round exact monetary strings. Exact
        // readings, low/high labels and the accessible fallback belong to parent.
        rightPriceScale: { visible: false, autoScale: true, borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.18 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true,
          rightOffset: 0, shiftVisibleRangeOnNewBar: false, allowShiftVisibleRangeOnWhitespaceReplacement: false },
        localization: { locale: 'en-AU', timeFormatter: time => {
          const row = active === current ? current.rows.get(time) : null;
          return row?.point?.at || '';
        } },
        crosshair: { mode: lib.CrosshairMode?.Magnet ?? 1,
          vertLine: { color: '#7faaa0', style: dashed, labelVisible: false },
          horzLine: { color: '#7faaa0', style: dashed, labelVisible: false } },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false },
          axisDoubleClickReset: { time: true, price: false } },
        kineticScroll: { mouse: false, touch: false }
      });
      current.chart = chart;
      const common = { color: '#82e5cb', lineType: lib.LineType?.Simple ?? 0, lineWidth: 2,
        priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false, baseLineVisible: false,
        lastPriceAnimation: lib.LastPriceAnimationMode?.Disabled ?? 0,
        autoscaleInfoProvider: observationAutoscale,
        // Only coordinates go through Number. This formatter is never an exact reading.
        priceFormat: { type: 'custom', formatter: () => '', minMove: 0.00000001 } };
      // Separate series enforce real breaks; whitespace in one line series can
      // still connect values on either side in Lightweight Charts.
      for (const run of data.runs) chart.addSeries(lib.LineSeries, { ...common, lineStyle: dashed,
        pointMarkersVisible: false, crosshairMarkerVisible: false }).setData(run);
      chart.addSeries(lib.LineSeries, { ...common, lineVisible: false, pointMarkersVisible: true,
        pointMarkersRadius: 4, crosshairMarkerVisible: true, crosshairMarkerRadius: 6 }).setData(data.markers);
      const inspect = (event, source) => {
        if (destroyed || active !== current || ticket !== version) return;
        const position = event?.point;
        const inside = position && Number.isFinite(position.x) && Number.isFinite(position.y) && position.x >= 0 && position.y >= 0;
        const row = inside && typeof event.time === 'number' ? current.rows.get(event.time) : null;
        notify(row?.point || null, row?.point ? row.index : -1, source);
      };
      current.move = event => inspect(event, 'crosshair');
      current.click = event => inspect(event, 'click');
      chart.subscribeCrosshairMove(current.move);
      chart.subscribeClick(current.click);
      current.resize = () => {
        if (destroyed || active !== current || ticket !== version) return;
        const { width, height } = dimensions();
        chart.resize(width, height);
      };
      const Observer = view.ResizeObserver || globalThis.ResizeObserver;
      if (typeof Observer === 'function') {
        current.observer = new Observer(current.resize);
        current.observer.observe(container);
      } else view.addEventListener?.('resize', current.resize);
      reset();
      if (destroyed || ticket !== version) return { status: destroyed ? 'destroyed' : 'superseded' };
      return { status: 'ready', ...counts };
    } catch {
      if (destroyed || ticket !== version) return { status: destroyed ? 'destroyed' : 'superseded' };
      release();
      notify(null, -1, 'clear');
      return { status: 'error', code: 'CHART_UNAVAILABLE', ...counts };
    }
  }
  return { update, clear, destroy, reset };
}
