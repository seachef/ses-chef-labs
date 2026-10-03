/** Local rendering only. The chart library receives public bars and in-memory draft levels. */
const vendor=()=>import('../vendor/lightweight-charts-5.2.1.mjs');
const positive=n=>Number.isFinite(n)&&n>0;
export const formatChartPrice=n=>Number.isFinite(n)?new Intl.NumberFormat('en-AU',{maximumSignificantDigits:9}).format(n):'—';
export function initialCandleRange(count,width){const visible=Math.max(40,Math.min(100,Math.floor(width/7)));return {from:Math.max(-2,count-visible),to:count+3};}
export function candleSeriesData(market){
 return (market?.candles||[]).filter(c=>Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(positive)).map(c=>({time:c.time/1000,open:c.open,high:c.high,low:c.low,close:c.close,...(c.isForming?{color:c.close>=c.open?'#76c4b299':'#dd969f99',wickColor:'#afbfca',borderColor:'#b8d8d2'}:{})}));
}
export function volumeSeriesData(market){return (market?.candles||[]).filter(c=>Number.isFinite(c.volume)&&c.volume>=0).map(c=>({time:c.time/1000,value:c.volume,color:c.close>=c.open?'#5fc5b14d':'#e397a04d'}));}
export function createMarketChart({container,onInspect=()=>{},onLevelChange=()=>{},onStatus=()=>{},library,loadLibrary=vendor}={}){
 let chart=null,series=null,volume=null,host=null,editLayer=null,pending=null,market=null,levels=[],lines=[],editField=null,drag=null,revision=0,destroyed=false,observed=null,lastData=null;
 function size(){return {width:Math.max(240,container.clientWidth||640),height:Math.max(300,container.clientHeight||420)};}
 function clearChart(){drag=null;editField=null;observed?.disconnect();observed=null;if(chart)chart.remove();chart=null;series=null;volume=null;host=null;editLayer=null;lines=[];lastData=null;container.replaceChildren();onInspect(null);}
 function resize(){if(!chart)return;drag=null;chart.resize(size().width,size().height);positionEditor();}
 function positionEditor(){if(!editLayer)return;editLayer.hidden=!editField||!market?.candles?.length;editLayer.style.right=(chart?.priceScale('right').width()||76)+'px';const selected=levels.find(l=>l.field===editField);if(selected){editLayer.setAttribute('aria-valuenow',String(selected.value));editLayer.setAttribute('aria-valuetext',formatChartPrice(selected.value));}editLayer.setAttribute('aria-label',editField?`Drag to adjust draft ${editField}. Numeric price input remains available.`:'Chart explore mode');}
 function applyLevels(){if(!series)return;for(const line of lines)series.removePriceLine(line);lines=[];
  for(const level of levels)if(positive(level.value))lines.push(series.createPriceLine({price:level.value,color:level.color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:({entry:'Entry',stop:'SL',target:'TP',trailingActivation:'Trail'}[level.field]||level.label)}));
  if(editField&&!levels.some(l=>l.field===editField&&positive(l.value))){editField=null;drag=null;}
  positionEditor();
 }
 function recentView(){chart.timeScale().fitContent();chart.timeScale().setVisibleLogicalRange?.(initialCandleRange(market?.candles?.length||0,size().width));}
 function render(){if(!chart||!market)return;
  if(lastData!==market){series.setData(candleSeriesData(market));volume.setData(volumeSeriesData(market));lastData=market;const min=Math.min(...market.candles.map(c=>c.low));series.applyOptions({priceFormat:{type:'custom',formatter:formatChartPrice,minMove:Math.pow(10,Math.floor(Math.log10(min))-5)}});recentView();}
  applyLevels();onStatus('ready');
 }
 function range(){const r=series?.priceScale().getVisibleRange();return r&&positive(r.to)&&Number.isFinite(r.from)&&r.to>r.from?r:null;}
 function down(event){if(drag||!editField||!series||!market||event.button>0)return;const level=levels.find(l=>l.field===editField),r=range();if(!level||!r)return;const y=event.clientY-editLayer.getBoundingClientRect().top,start=series.coordinateToPrice(y);if(!Number.isFinite(start))return;event.preventDefault();series.priceScale().setVisibleRange(r);drag={pointerId:event.pointerId,field:level.field,price:level.value,startClientY:event.clientY,startPrice:start,range:r,moved:false};editLayer.setPointerCapture?.(event.pointerId);}
 function move(event){if(!drag||event.pointerId!==drag.pointerId||Math.abs(event.clientY-drag.startClientY)<3&&!drag.moved)return;const y=event.clientY-editLayer.getBoundingClientRect().top,current=series.coordinateToPrice(y),value=drag.price+current-drag.startPrice;if(!positive(value))return;event.preventDefault();drag.moved=true;onLevelChange(drag.field,String(Number(value.toPrecision(9))));}
 function up(event){if(!drag||event.pointerId!==drag.pointerId)return;move(event);drag=null;editLayer?.releasePointerCapture?.(event.pointerId);}
 function cancel(event){if(!drag||!event||event.pointerId===drag.pointerId)drag=null;}
 function key(event){if(!editField||!['ArrowUp','ArrowDown'].includes(event.key))return;const level=levels.find(l=>l.field===editField),r=range();if(!level||!r)return;event.preventDefault();const value=level.value+(event.key==='ArrowUp'?1:-1)*(r.to-r.from)/(event.shiftKey?20:100);if(positive(value))onLevelChange(level.field,String(Number(value.toPrecision(9))));}
 async function ensure(){if(chart||destroyed||!market?.candles?.length)return;if(pending)return pending;const token=revision;onStatus('loading');
  pending=(async()=>{try{const lib=await Promise.resolve(library||loadLibrary());if(destroyed||token!==revision||!market)return;
   host=document.createElement('div');host.className='mc-canvas';host.setAttribute('aria-hidden','true');container.replaceChildren(host);
   chart=lib.createChart(host,{...size(),layout:{background:{type:'solid',color:'#07121a'},textColor:'#adbec7',fontFamily:'Nunito, sans-serif',fontSize:11,attributionLogo:true},grid:{vertLines:{color:'#8bacbf0d'},horzLines:{color:'#8bacbf15'}},rightPriceScale:{borderVisible:false,minimumWidth:74},timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:5},crosshair:{mode:0},handleScroll:{vertTouchDrag:false},handleScale:{pinch:true},localization:{priceFormatter:formatChartPrice}});
   series=chart.addSeries(lib.CandlestickSeries,{upColor:'#70c6b2',downColor:'#dc929d',borderVisible:false,wickUpColor:'#70c6b2',wickDownColor:'#dc929d',priceLineVisible:false,lastValueVisible:true,autoscaleInfoProvider:original=>{const info=original();if(info?.priceRange){const values=levels.map(l=>l.value).filter(positive);if(values.length){info.priceRange.minValue=Math.min(info.priceRange.minValue,...values);info.priceRange.maxValue=Math.max(info.priceRange.maxValue,...values);}}return info;}});
   series.priceScale().applyOptions({scaleMargins:{top:.1,bottom:.24}});
   volume=chart.addSeries(lib.HistogramSeries,{priceScaleId:'volume',priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false});volume.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
   const activeChart=chart;chart.subscribeCrosshairMove(param=>{if(destroyed||chart!==activeChart)return;const bar=param?.time!=null?market?.candles?.find(c=>c.time/1000===param.time):null;onInspect(bar||null);});
   editLayer=document.createElement('div');editLayer.className='mc-edit-layer';editLayer.tabIndex=0;editLayer.setAttribute('role','slider');editLayer.hidden=true;container.append(editLayer);
   for(const [event,handler]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel],['keydown',key]])editLayer.addEventListener(event,handler);
   if(typeof ResizeObserver!=='undefined'){observed=new ResizeObserver(resize);observed.observe(container);}
   render();
  }catch{if(token===revision&&!destroyed){clearChart();onStatus('unavailable');}}finally{pending=null;if(!destroyed&&market&&token!==revision)void ensure();}})();return pending;
 }
 return {setMarket(value){if(destroyed)return;drag=null;editField=null;onInspect(null);market=value;lastData=null;if(!value?.candles?.length){++revision;clearChart();onStatus('empty');return;}if(chart)render();else void ensure();},setLevels(value){levels=(value||[]).filter(l=>positive(l.value));applyLevels();},setEditField(value){drag=null;editField=value&&levels.some(l=>l.field===value)?value:null;positionEditor();if(editField)editLayer?.focus();},reset(){drag=null;if(chart){series.priceScale().setAutoScale(true);recentView();}},resize,clear(){++revision;market=null;levels=[];clearChart();onStatus('empty');},destroy(){destroyed=true;++revision;market=null;levels=[];clearChart();}};
}
