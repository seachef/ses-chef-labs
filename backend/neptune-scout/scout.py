"""Read-only, bounded public-market research. No trading or database client."""
import argparse, collections, concurrent.futures, datetime as dt, decimal, email.utils, hashlib, json, math, pathlib, re, threading, time, urllib.parse, urllib.request, urllib.error
D=decimal.Decimal
UTC=dt.timezone.utc
ROOT=pathlib.Path(__file__).resolve().parent
EXCLUDED={'RENDER','POL','TAO','APT','AKT','2Z','OPEN'}
AU_KRAKEN_BLOCKED={'DASH','FIDD','LCAP','QCAD','SOFID','USAT','WAR','XMR','ZEC'}
CASH={'USD','EUR','GBP','AUD','CAD','CHF','JPY','USDT','USDC','USDG','USDE','USDH','USDT0','DAI','EURC','EURR','EURQ','EUROP','EURT','FDUSD','PYUSD','TUSD','USDS','USDD','RLUSD','FRAX','LUSD','USDP','PAXG','XAUT','XAUT0','BNB'}
SYMBOL=re.compile(r'^[A-Z0-9][A-Z0-9.\-]{0,19}$')
MAX_IDENTITIES=2048
MAX_BODY=2*1024*1024
MAX_RUN_RAW=8*1024*1024
MAX_OUTPUT=512*1024
MIN_VOLUME=D('100000')
MIN_CHANGE=D('3')
MAX_SPREAD_BPS=D('35')
MODEL_NOTIONAL=D('100')
PROTOCOL='neptune-public-research-runonce-v1'

def stamp():return dt.datetime.now(UTC).isoformat()
def epoch(s):
 if not isinstance(s,str) or len(s)>40:raise ValueError('bad timestamp')
 x=dt.datetime.fromisoformat(s.replace('Z','+00:00'))
 if x.tzinfo is None:raise ValueError('timezone missing')
 return x.timestamp()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def digest(x):return hashlib.sha256(x if isinstance(x,bytes) else x.encode()).hexdigest()
def num(x,positive=False):
 if isinstance(x,bool) or not isinstance(x,(str,int,float,D)):raise ValueError('bad number')
 if len(str(x))>80:raise ValueError('oversize number')
 v=D(str(x))
 if not v.is_finite() or not -36<=v.as_tuple().exponent<=18 or abs(v)>D('1e18') or (positive and v<=0):raise ValueError('nonfinite or out-of-range number')
 return v
def scalar(x):
 if not isinstance(x,D):return x
 # Bound fixed-point expansion before formatting untrusted exponent-derived values.
 if not x.is_finite() or not -36<=x.as_tuple().exponent<=18 or abs(x)>D('1e18'):raise ValueError('decimal output bound')
 value=format(x,'f')
 if len(value)>64:raise ValueError('decimal output bound')
 return value
def unique(items,key):
 result={}
 for item in items:
  k=key(item)
  if k in result:raise ValueError('duplicate identity')
  result[k]=item
 return result
def no_duplicate_object(pairs):return _object_pairs(pairs)
def _object_pairs(pairs):
 out={}
 for k,v in pairs:
  if k in out:raise ValueError('duplicate JSON key')
  out[k]=v
 return out
def load_json(raw):
 return json.loads(raw,object_pairs_hook=no_duplicate_object,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('nonfinite JSON')))

class Budget:
 """Per-run reserves, not a claim that a shared IP has unused global capacity."""
 def __init__(self):
  self.lock=threading.Lock();self.used=collections.Counter();self.weights=collections.Counter();self.blocked={};self.next={};self.credits_remaining=None
 def reserve(self,provider,weight=1,credit=1):
  caps={'kraken':12,'hyperliquid':12,'dexpaprika':1};interval={'kraken':1.1,'hyperliquid':.25,'dexpaprika':4.2}
  with self.lock:
   if provider not in caps:raise ValueError('provider not allowlisted')
   if provider in self.blocked:raise ValueError('provider blocked: '+self.blocked[provider])
   if self.used[provider]>=caps[provider] or (provider=='hyperliquid' and self.weights[provider]+weight>160):raise ValueError('run budget exhausted')
   if provider=='dexpaprika' and self.credits_remaining is not None and self.credits_remaining-credit<1000:raise ValueError('shared-IP credit reserve')
   self.used[provider]+=1;self.weights[provider]+=weight
   if provider=='dexpaprika' and self.credits_remaining is not None:self.credits_remaining-=credit
   now=time.monotonic();slot=max(now,self.next.get(provider,now));self.next[provider]=slot+interval[provider]
  return max(0,slot-time.monotonic())
 def observe(self,provider,status,headers):
  with self.lock:
   if status in (401,402,403,429):self.blocked[provider]='HTTP '+str(status)
   if provider=='dexpaprika' and headers.get('x-credits-remaining') is not None:
    try:self.credits_remaining=max(0,int(headers['x-credits-remaining']))
    except (TypeError,ValueError):self.blocked[provider]='invalid quota header'
 def summary(self):return {'requests':dict(self.used),'hyperliquid_weight':self.weights['hyperliquid'],'blocked':dict(self.blocked),'dexpaprika_shared_ip_credits_remaining':self.credits_remaining,'global_shared_ip_capacity':'unknown; conservative local caps, authoritative HTTP refusals stop provider'}

def specification(kind,market=None,at=None):
 kroot='https://api.kraken.com/0/public/'
 if kind=='kraken_metadata':return 'kraken','GET',kroot+'AssetPairs?assetVersion=1',None,1
 if kind=='kraken_tickers':return 'kraken','GET',kroot+'Ticker?assetVersion=1',None,1
 if kind=='hyperliquid_bulk':return 'hyperliquid','POST','https://api.hyperliquid.xyz/info',{'type':'spotMetaAndAssetCtxs'},20
 if kind=='robinhood_discovery':return 'dexpaprika','GET','https://api.dexpaprika.com/networks/robinhood/tokens/search?limit=100&order_by=volume_usd_24h&sort=desc',None,1
 if market is None:raise ValueError('exact market required')
 venue=market['venue'];coin=market['instrument_id']
 if venue=='kraken':
  if not re.fullmatch(r'[A-Z0-9.\-]{1,20}/USD',coin):raise ValueError('invalid Kraken identity')
  pair=urllib.parse.quote(coin,safe='')
  suffix={'depth':'Depth?pair='+pair+'&count=20&assetVersion=1','bars':'OHLC?pair='+pair+'&interval=15&assetVersion=1','trades':'Trades?pair='+pair+'&count=1&assetVersion=1'}
  if kind not in suffix:raise ValueError('unsupported request')
  return venue,'GET',kroot+suffix[kind],None,1
 if venue=='hyperliquid':
  if not (re.fullmatch(r'@\d{1,6}',coin) or coin=='PURR/USDC'):raise ValueError('invalid Hyperliquid identity')
  if kind=='depth':body={'type':'l2Book','coin':coin};weight=2
  elif kind=='trades':body={'type':'recentTrades','coin':coin};weight=40 # reserved upper bound; responses >400 rejected
  elif kind=='bars':body={'type':'candleSnapshot','req':{'coin':coin,'interval':'15m','startTime':int((at-26*3600)*1000),'endTime':int(at*1000)}};weight=22
  else:raise ValueError('unsupported request')
  return venue,'POST','https://api.hyperliquid.xyz/info',body,weight
 raise ValueError('venue not enabled')

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):raise ValueError('redirect refused')

class Collector:
 def __init__(self,out):self.out=pathlib.Path(out);self.out.mkdir(parents=True,exist_ok=True);self.budget=Budget();self.counter=0;self.raw_total=0;self.lock=threading.Lock()
 def fetch(self,kind,market=None,at=None):
  provider,method,url,body,weight=specification(kind,market,at)
  wait=self.budget.reserve(provider,weight);time.sleep(wait)
  # A refusal can arrive while this request waits for its reserved provider slot.
  with self.budget.lock:
   if provider in self.budget.blocked:raise ValueError('provider blocked before send: '+self.budget.blocked[provider])
  start=stamp();headers={};status=None;raw=b'';error=None
  try:
   data=None if body is None else canonical(body).encode()
   req=urllib.request.Request(url,data=data,method=method,headers={'Accept':'application/json','Content-Type':'application/json','User-Agent':'NEPTUNE-readonly-scout/1.0'})
   with urllib.request.build_opener(NoRedirect()).open(req,timeout=25) as r:
    status=r.status;headers={k.lower():v for k,v in r.headers.items()};raw=r.read(MAX_BODY+1)
   if len(raw)>MAX_BODY:raise ValueError('response exceeds bound')
  except urllib.error.HTTPError as e:status=e.code;headers={k.lower():v for k,v in e.headers.items()};error='HTTP '+str(e.code)
  except Exception as e:error=type(e).__name__+': '+str(e)[:160]
  received=stamp();self.budget.observe(provider,status,headers)
  with self.lock:
   self.raw_total+=len(raw)
   if self.raw_total>MAX_RUN_RAW:raise ValueError('aggregate raw-byte budget exceeded')
  selected={k:v for k,v in headers.items() if k in ('date','age','last-modified','cache-control','cf-cache-status','content-type','retry-after','x-api-plan','x-credits-limit','x-credits-remaining','x-credits-reset','ratelimit-limit','ratelimit-remaining','ratelimit-reset')}
  cap={'protocol':PROTOCOL,'kind':kind,'market_id':None if market is None else market['id'],'provider':provider,'method':method,'url':url,'request_body':body,'request_started_at':start,'response_observed_at':received,'status':status,'headers':selected,'raw_sha256':digest(raw),'raw_bytes':len(raw),'raw':raw.decode('utf-8',errors='strict') if len(raw)<=MAX_BODY else '', 'error':error}
  with self.lock:self.counter+=1;name=f'{self.counter:02d}-{kind}'+('' if market is None else '-'+re.sub(r'[^A-Za-z0-9]','_',market['id']))+'.json'
  path=self.out/name;path.write_text(json.dumps(cap,indent=2));cap['artifact']=name
  return cap

def validate_capture(cap,kind,market=None,now=None,max_age=180):
 if cap.get('protocol')!=PROTOCOL or cap.get('kind')!=kind:raise ValueError('wrong capture identity')
 at=epoch(cap['request_started_at']);received=epoch(cap['response_observed_at']);now=received if now is None else now
 if at>received or received>now+1 or now-received>max_age or received-at>30:raise ValueError('stale or impossible transport time')
 # Candle endTime remains bound to this request; do not permit an arbitrary host/body.
 spec_at=cap.get('request_body',{}).get('req',{}).get('endTime',int(at*1000))/1000 if isinstance(cap.get('request_body'),dict) else at
 if kind=='bars' and market and market['venue']=='hyperliquid' and (spec_at>at+1 or at-spec_at>180):raise ValueError('candle request time mismatch')
 provider,method,url,body,_=specification(kind,market,spec_at)
 if (cap.get('provider'),cap.get('method'),cap.get('url'),cap.get('request_body'),cap.get('market_id'))!=(provider,method,url,body,None if market is None else market['id']):raise ValueError('source/request binding mismatch')
 raw=cap.get('raw','').encode()
 if len(raw)>MAX_BODY or len(raw)!=cap.get('raw_bytes') or digest(raw)!=cap.get('raw_sha256'):raise ValueError('response digest mismatch')
 if cap.get('status')!=200 or cap.get('error') is not None:raise ValueError('unsuccessful transport')
 h=cap['headers']
 if not h.get('content-type','').lower().startswith('application/json'):raise ValueError('wrong content type')
 if 'date' not in h:raise ValueError('missing HTTP Date')
 date=email.utils.parsedate_to_datetime(h['date']).timestamp()
 if date>received+5 or date<at-30:raise ValueError('HTTP Date stale or future')
 age=num(h.get('age','0'))
 if age<0 or age>30:raise ValueError('stale cache')
 return load_json(raw)

def safe_base(base):return bool(isinstance(base,str) and SYMBOL.fullmatch(base) and base not in EXCLUDED|CASH)
def base_record(venue,coin,base,quote,base_id,quote_id,source):
 return {'id':venue+':'+coin,'venue':venue,'instrument_id':coin,'pair':base+'/'+quote,'base':base,'quote':quote,'base_id':base_id,'quote_id':quote_id,'asset_key':venue+':asset:'+base_id,'source_capture_sha256':source['raw_sha256'],'metadata_observed_at':source['response_observed_at'],'source_event_time':None,'execution_eligible':False,'ai_review_status':'not_reviewed'}

def normalize_kraken(meta_cap,ticker_cap,now):
 meta=validate_capture(meta_cap,'kraken_metadata',now=now,max_age=3600);ticks=validate_capture(ticker_cap,'kraken_tickers',now=now)
 if meta.get('error')!=[] or ticks.get('error')!=[]:raise ValueError('Kraken error')
 result=[];reject=collections.Counter()
 for coin,m in meta['result'].items():
  try:
   if m.get('quote')!='USD' or m.get('status')!='online' or m.get('execution_venue')!='international':continue
   # assetVersion=1 canonicalizes base/key, while wsname/altname deliberately
   # retain Kraken aliases (BTC key with XBT wsname, DOGE key with XDG wsname).
   if coin!=m.get('base')+'/USD' or not isinstance(m.get('wsname'),str) or not m['wsname'].endswith('/USD') or m.get('aclass_base')!='currency' or m.get('aclass_quote')!='currency':raise ValueError('identity mismatch')
   base=m['base']
   if base in AU_KRAKEN_BLOCKED:reject['australian_route_restricted']+=1;continue
   if not safe_base(base):reject['excluded_or_cashlike']+=1;continue
   t=ticks['result'][coin];bid=num(t['b'][0],True);ask=num(t['a'][0],True);last=num(t['c'][0],True);opening=num(t['o'],True)
   volume=num(t['v'][1])*num(t['p'][1],True)
   if volume<0 or bid>=ask:raise ValueError('crossed or negative metrics')
   e=base_record('kraken',coin,base,'USD',m['base'],m['quote'],meta_cap)
   e.update({'metrics_observed_at':ticker_cap['response_observed_at'],'metrics_sha256':ticker_cap['raw_sha256'],'change_basis':'since_utc_midnight_open','change_pct':scalar((last/opening-1)*100),'quote_volume_24h':scalar(volume),'spread_bps':scalar((ask-bid)/((ask+bid)/2)*10000),'last_reference':scalar(last),'rules_known':m.get('lot')=='unit' and int(m.get('lot_decimals',-1)) in range(13),'sizing_rules':{k:m.get(k) for k in ('lot','lot_decimals','ordermin','costmin','tick_size')}})
   result.append(e)
  except (ValueError,KeyError,TypeError,decimal.InvalidOperation):reject['malformed_or_unmatched']+=1
 unique(result,lambda x:x['id']);unique(result,lambda x:x['asset_key'])
 return result,reject

def normalize_hyperliquid(cap,now):
 j=validate_capture(cap,'hyperliquid_bulk',now=now)
 if not isinstance(j,list) or len(j)!=2:raise ValueError('bad bulk envelope')
 meta,contexts=j;tokens=unique(meta['tokens'],lambda x:x['index']);markets=unique(meta['universe'],lambda x:x['index']);ctx=unique(contexts,lambda x:x['coin']);unique(meta['tokens'],lambda x:x['tokenId'])
 result=[];reject=collections.Counter()
 for index,m in markets.items():
  try:
   coin=m['name']
   if not isinstance(index,int) or isinstance(index,bool) or index<0 or index>=len(contexts) or contexts[index].get('coin')!=coin or coin not in ctx:raise ValueError('sparse context mismatch')
   if len(m['tokens'])!=2:raise ValueError('token count')
   b,q=[tokens[k] for k in m['tokens']]
   if q['name']!='USDC':reject['non_usdc_quote']+=1;continue
   if not safe_base(b['name']) or re.search('xstock|corporation|technologies corp|nvidia|space exploration',b.get('fullName') or '',re.I):reject['excluded_or_noncrypto']+=1;continue
   if not all(re.fullmatch(r'0x[0-9a-f]{32}',v['tokenId']) for v in (b,q)):raise ValueError('token ID')
   c=ctx[coin];last=num(c['midPx'],True);prev=num(c['prevDayPx'],True);volume=num(c['dayNtlVlm'])
   if volume<0:raise ValueError('negative volume')
   e=base_record('hyperliquid',coin,b['name'],q['name'],b['tokenId'],q['tokenId'],cap)
   e.update({'metrics_observed_at':cap['response_observed_at'],'metrics_sha256':cap['raw_sha256'],'change_basis':'previous_day_reference','change_pct':scalar((last/prev-1)*100),'quote_volume_24h':scalar(volume),'spread_bps':None,'last_reference':scalar(last),'rules_known':False,'sizing_rules':{'base_token_index':b['index'],'quote_token_index':q['index'],'market_index':index,'sz_decimals':b['szDecimals']}})
   result.append(e)
  except (ValueError,KeyError,TypeError,decimal.InvalidOperation):reject['malformed_or_unmatched']+=1
 unique(result,lambda x:x['id']);unique(result,lambda x:x['asset_key'])
 return result,reject,{'metadata_markets':len(markets),'asset_contexts':len(contexts),'unmatched_contexts':len(contexts)-len(markets)}

def prefilter(e):
 reasons=[]
 if num(e['quote_volume_24h'])<MIN_VOLUME:reasons.append('volume_below_100k_quote')
 if not MIN_CHANGE<=num(e['change_pct'])<=60:reasons.append('change_outside_3_to_60_percent')
 if e['spread_bps'] is not None and num(e['spread_bps'])>MAX_SPREAD_BPS:reasons.append('spread_above_35_bps')
 return reasons

def parse_depth(cap,e,now):
 j=validate_capture(cap,'depth',e,now,max_age=60);start=epoch(cap['request_started_at']);end=epoch(cap['response_observed_at'])
 if e['venue']=='kraken':
  if j.get('error')!=[] or set(j['result'])!={e['instrument_id']}:raise ValueError('depth identity mismatch')
  book=j['result'][e['instrument_id']];sides=[book['bids'],book['asks']];event=None
 else:
  if j.get('coin')!=e['instrument_id'] or len(j['levels'])!=2:raise ValueError('depth identity mismatch')
  event=float(num(j['time']))/1000
  if not start-30<=event<=end:raise ValueError('depth source stale or future')
  sides=j['levels']
 parsed=[]
 for side,rows in enumerate(sides):
  if not isinstance(rows,list) or not 1<=len(rows)<=20:raise ValueError('depth bound')
  out=[];previous=None
  for row in rows:
   if e['venue']=='kraken':
    if len(row)!=3 or float(num(row[2]))>end:raise ValueError('depth timestamp')
    price,size=num(row[0],True),num(row[1],True)
   else:price,size=num(row['px'],True),num(row['sz'],True)
   if previous is not None and ((side==0 and price>=previous) or (side==1 and price<=previous)):raise ValueError('unordered/duplicate book level')
   out.append((price,size));previous=price
  parsed.append(out)
 bids,asks=parsed
 if bids[0][0]>=asks[0][0]:raise ValueError('crossed book')
 return bids,asks,event

def parse_candles(cap,e,now):
 j=validate_capture(cap,'bars',e,now,max_age=180);cutoff=epoch(cap['request_started_at']);received=epoch(cap['response_observed_at']);bars=[]
 if e['venue']=='kraken':
  if j.get('error')!=[] or set(j['result'])!={e['instrument_id'],'last'}:raise ValueError('bars identity')
  raw=j['result'][e['instrument_id']]
 else:raw=j
 # Captured Kraken responses contain 720 closed entries plus one mutable row
 # (721 total), despite the current docs saying 720. Admit that exact bounded
 # observed variant only if the extra row is the current incomplete candle.
 maximum=721 if e['venue']=='kraken' else 720
 if not isinstance(raw,list) or not 22<=len(raw)<=maximum:raise ValueError('candle bound')
 previous=None;incomplete=0
 for x in raw:
  if e['venue']=='kraken':
   if len(x)!=8:raise ValueError('candle schema')
   value=num(x[0]);t=int(value)
   if value!=t:raise ValueError('fractional candle time')
   o,h,l,c,v=[num(x[i]) for i in (1,2,3,4,6)]
  else:
   if x.get('s')!=e['instrument_id'] or x.get('i')!='15m':raise ValueError('candle identity')
   t=int(num(x['t']))//1000
   if num(x['t'])!=t*1000 or num(x['T'])!=t*1000+899999:raise ValueError('candle interval')
   o,h,l,c,v=[num(x[k]) for k in ('o','h','l','c','v')]
  if t%900 or t>received or min(o,h,l,c)<=0 or v<0 or not l<=min(o,c)<=max(o,c)<=h:raise ValueError('invalid candle')
  if previous is not None and t!=previous+900:raise ValueError('gapped/duplicate/unordered source candles')
  previous=t
  if t+900>cutoff:incomplete+=1;continue
  bars.append((t,o,h,l,c,v))
 if incomplete>1 or (len(raw)==721 and (len(bars)!=720 or incomplete!=1)):raise ValueError('invalid extra mutable candle')
 if len(bars)<22:raise ValueError('missing completed candles')
 bars=bars[-22:]
 if any(bars[i][0]-bars[i-1][0]!=900 for i in range(1,22)):raise ValueError('gapped or duplicate candles')
 if not cutoff-1800<=bars[-1][0]+900<=cutoff:raise ValueError('stale completed candles')
 return bars

def parse_trade(cap,e,now):
 j=validate_capture(cap,'trades',e,now,max_age=60);start=epoch(cap['request_started_at']);end=epoch(cap['response_observed_at'])
 if e['venue']=='kraken':
  if j.get('error')!=[] or set(j['result'])!={e['instrument_id'],'last'}:raise ValueError('trade identity')
  rows=j['result'][e['instrument_id']]
  if len(rows)!=1 or len(rows[0])!=7:raise ValueError('trade schema')
  num(rows[0][0],True);num(rows[0][1],True);event=float(num(rows[0][2]))
 else:
  if not isinstance(j,list) or not 1<=len(j)<=400 or any(x.get('coin')!=e['instrument_id'] for x in j):raise ValueError('trade identity or bound')
  for x in j:num(x['px'],True);num(x['sz'],True)
  event=max(float(num(x['time']))/1000 for x in j)
 if not start-60<=event<=end:raise ValueError('stale/future last trade')
 return event

def sweep(levels,quote_budget=None,base_qty=None):
 if (quote_budget is None)==(base_qty is None):raise ValueError('one amount needed')
 if (quote_budget if quote_budget is not None else base_qty)<=0:raise ValueError('positive amount needed')
 remaining=quote_budget if quote_budget is not None else base_qty;quote=D(0);base=D(0)
 for price,size in levels:
  qty=min(size,remaining/price if quote_budget is not None else remaining)
  base+=qty;quote+=qty*price;remaining-=qty*price if quote_budget is not None else qty
  if remaining<=D('1e-20'):return base,quote
 raise ValueError('insufficient displayed depth')

def review_evidence(e,caps,now):
 out={'id':e['id'],'pair':e['pair'],'venue':e['venue'],'base_id':e['base_id'],'quote_id':e['quote_id'],'observed_at':dt.datetime.fromtimestamp(now,UTC).isoformat(),'quote_currency':e['quote'],'model_quote_notional':str(MODEL_NOTIONAL),'execution_eligible':False,'qualified_buy':False,'ai_review_status':'not_reviewed','checks':{},'blocking_reasons':['independent_ai_reviews_missing','execution_adapter_not_authorized_for_promotion'],'evidence':[{'kind':x['kind'],'artifact':x.get('artifact'),'raw_sha256':x['raw_sha256'],'request_started_at':x['request_started_at'],'response_observed_at':x['response_observed_at']} for x in caps.values()]}
 parsed={}
 for kind,parser in [('depth',parse_depth),('bars',parse_candles),('trades',parse_trade)]:
  try:parsed[kind]=parser(caps[kind],e,now);out['checks'][kind]={'status':'passed'}
  except Exception as exc:out['checks'][kind]={'status':'blocked','reason':str(exc)};out['blocking_reasons'].append(kind+': '+str(exc))
 if 'depth' in parsed:
  try:
   bids,asks,event=parsed['depth'];spread=(asks[0][0]-bids[0][0])/((asks[0][0]+bids[0][0])/2)*10000
   qty,spent=sweep(asks,quote_budget=MODEL_NOTIONAL)
   # Same conservative public-model fee assumptions as existing paper source;
   # not verified account fees, not a fill simulation or executable quote.
   fee=D('.008') if e['venue']=='kraken' else D('.0007');held=qty if e['venue']=='kraken' else qty*(1-fee)
   _,received=sweep(bids,base_qty=held);debit=spent*(1+fee) if e['venue']=='kraken' else spent
   net=received*(1-fee);loss=(1-net/debit)*10000
   reserve_bps=loss+50 # 25 bps adverse allowance on each side, additional to book/fees.
   out['checks']['cost']={'status':'modeled_only','spread_bps':str(spread),'displayed_book_round_trip_loss_bps':str(loss),'screening_cost_reserve_bps':str(reserve_bps),'fee_rate_per_side':str(fee),'fee_basis':'existing paper-model assumption; actual account tier/discounts not verified','fx_conversion':'not included; amounts stay in native quote currency','source_event_time':event,'snapshot_quote_not_guaranteed_executable':True}
   if spread>MAX_SPREAD_BPS:out['blocking_reasons'].append('spread_above_35_bps')
   out['blocking_reasons'].append('actual_fees_and_all_in_costs_unverified')
   if e['quote']!='USD':out['blocking_reasons'].append('quote_to_usd_aud_conversion_unverified_no_peg_assumption')
   if 'bars' in parsed:
    bars=parsed['bars'];latest=bars[-1];prior=bars[-21:-1];breakout=latest[4]>max(x[2] for x in prior);avg=sum(x[5] for x in prior)/20;volume_ratio=latest[5]/avg if avg>0 else D(0)
    out['checks']['momentum']={'status':'observed','completed_close_above_previous_20_highs':breakout,'completed_bar_volume_ratio':str(volume_ratio),'last_completed_bar_end':dt.datetime.fromtimestamp(latest[0]+900,UTC).isoformat(),'strategy_promoted':False}
    if not breakout or volume_ratio<D('1.2'):out['blocking_reasons'].append('completed_bar_breakout_and_volume_not_confirmed')
  except Exception as exc:out['checks']['cost']={'status':'blocked','reason':str(exc)};out['blocking_reasons'].append('cost_depth: '+str(exc))
 if not e['rules_known']:out['blocking_reasons'].append('full_instrument_execution_rules_not_verified')
 out['status']='research_evidence_only_no_buy'
 return out

def robinhood_summary(cap,now):
 j=validate_capture(cap,'robinhood_discovery',now=now,max_age=180);rows=j['results'];unique(rows,lambda x:(x['chain'],x['address']))
 if len(rows)>100:raise ValueError('page bound')
 rejected=0
 for r in rows:
  if r.get('chain')!='robinhood' or not re.fullmatch(r'0x[0-9a-fA-F]{40}',r.get('address','')):raise ValueError('chain/address mismatch')
  try:
   if num(r['liquidity_usd'])>D('1e10'):rejected+=1
  except (KeyError,ValueError,decimal.InvalidOperation):rejected+=1
 return {'state':'delayed_discovery_only','chain':'robinhood','chain_id':4663,'rows':len(rows),'has_more':j.get('has_next_page') is True,'invalid_liquidity_rows':rejected,'per_row_source_timestamp':'unavailable','live_market_coverage':False,'qualified':0,'source_capture_sha256':cap['raw_sha256'],'observed_at':cap['response_observed_at'],'limitation':'Free-tier/indexer/cache delay; token identities are not executable pool identities. Not part of qualified screen.'}

def save_output(out,report,screens):
 # Public latest state omits repetitive metadata/response hashes per row. The
 # source_captures list binds each venue's rows to the retained input captures.
 fields=['id','venue','instrument_id','pair','base','quote','base_id','quote_id','metrics_observed_at','change_basis','change_pct','quote_volume_24h','spread_bps','rules_known','prefilter_reasons','execution_eligible']
 compact=[{k:x[k] for k in fields} for x in screens]
 payload=canonical({'report':report,'markets':compact})
 if len((payload+'\n').encode())>MAX_OUTPUT:raise ValueError('output budget exceeded')
 summary=canonical(report)
 if len((summary+'\n').encode())>65536:raise ValueError('summary budget exceeded')
 (out/'research-snapshot.json').write_text(payload+'\n');(out/'RUN-RESULT.json').write_text(summary+'\n')
 return len(payload.encode())

def replay(folder,out):
 """Evaluate retained observations at their actual run time; never restamp live."""
 folder=pathlib.Path(folder);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
 captures=[]
 for f in sorted(folder.glob('*.json')):
  c=load_json(f.read_text());c['artifact']=f.name;captures.append(c)
 bulk={x['kind']:x for x in captures if x['market_id'] is None}
 evaluated=max(epoch(x['response_observed_at']) for x in captures)
 report={'protocol':PROTOCOL,'mode':'read_only_capture_replay','started_at':min(x['request_started_at'] for x in captures),'completed_at':dt.datetime.fromtimestamp(evaluated,UTC).isoformat(),'replayed_at':stamp(),'continuous_runtime':False,'ai_workers_running':0,'execution_enabled':False,'sources':{},'coverage':{},'leads':[]}
 markets=[]
 for venue in ('kraken','hyperliquid'):
  try:
   if venue=='kraken':rows,reject=normalize_kraken(bulk['kraken_metadata'],bulk['kraken_tickers'],evaluated);counts={}
   else:rows,reject,counts=normalize_hyperliquid(bulk['hyperliquid_bulk'],evaluated)
   markets+=rows;report['coverage'][venue]={'screened_identities':len(rows),'rejected':dict(reject),**counts,'source_event_freshness':'bulk snapshot has no per-market event timestamp'}
  except Exception as exc:report['coverage'][venue]={'status':'blocked','reason':str(exc)}
 if 'robinhood_discovery' in bulk:
  try:report['coverage']['robinhood']=robinhood_summary(bulk['robinhood_discovery'],evaluated)
  except Exception as exc:report['coverage']['robinhood']={'status':'blocked','reason':str(exc)}
 reasons=collections.Counter();shortlist=[]
 for x in markets:
  x['prefilter_reasons']=prefilter(x);reasons.update(x['prefilter_reasons']);x['screen_status']='needs_independent_review_and_current_quotes' if not x['prefilter_reasons'] else 'screen_rejected'
 for venue in ('kraken','hyperliquid'):shortlist+=sorted([x for x in markets if x['venue']==venue and not x['prefilter_reasons']],key=lambda x:(-num(x['quote_volume_24h']),x['id']))[:2]
 for e in shortlist:
  details={c['kind']:c for c in captures if c['market_id']==e['id']}
  # A particular lead was evaluated when its own final response arrived, not
  # when unrelated later leads completed. Current suitability always expires.
  observed=max([epoch(c['response_observed_at']) for c in details.values()] or [evaluated])
  report['leads'].append(review_evidence(e,details,observed))
 report.update(screened_identities=len(markets),prefilter_pass_count=sum(not x['prefilter_reasons'] for x in markets),shortlist_count=len(shortlist),pre_screen_reasons=dict(reasons),qualified_buy_count=0)
 report['source_captures']=[{'kind':k,'artifact':v['artifact'],'raw_sha256':v['raw_sha256'],'observed_at':v['response_observed_at'],'status':v['status'],'error':v['error']} for k,v in bulk.items()]
 report['observed_requests']=dict(collections.Counter(x['provider'] for x in captures));report['limitations']=['Historical replay of newly fetched public observations; replay time does not refresh them.','No persistent runtime, independent AI review or qualified buy.','Full instrument rules, actual fees and quote-to-AUD conversions remain unverified.']
 size=save_output(out,report,markets);print(json.dumps({'report':report,'snapshot_bytes':size},indent=2));return report,markets

def run(out,with_robinhood=False):
 out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);collector=Collector(out/'captures');started=stamp();report={'protocol':PROTOCOL,'mode':'read_only_run_once','started_at':started,'continuous_runtime':False,'ai_workers_running':0,'execution_enabled':False,'sources':{},'coverage':{},'pre_screen_reasons':{},'leads':[]}
 kinds=['kraken_metadata','kraken_tickers','hyperliquid_bulk']+(['robinhood_discovery'] if with_robinhood else [])
 caps={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures={pool.submit(collector.fetch,k):k for k in kinds}
  for f in concurrent.futures.as_completed(futures):
   k=futures[f]
   try:caps[k]=f.result()
   except Exception as exc:report['sources'][k]={'status':'blocked','reason':str(exc)}
 now=time.time();markets=[]
 try:
  kr,reject=normalize_kraken(caps['kraken_metadata'],caps['kraken_tickers'],now);markets+=kr;report['coverage']['kraken']={'screened_identities':len(kr),'rejected':dict(reject),'source':'fresh_public_bulk_snapshot','source_event_freshness':'bulk ticker has no individual event timestamp'}
 except Exception as exc:report['coverage']['kraken']={'status':'blocked','reason':str(exc)}
 try:
  hl,reject,counts=normalize_hyperliquid(caps['hyperliquid_bulk'],now);markets+=hl;report['coverage']['hyperliquid']={'screened_identities':len(hl),'rejected':dict(reject),**counts,'source':'fresh_public_bulk_snapshot','source_event_freshness':'bulk context has no individual event timestamp'}
 except Exception as exc:report['coverage']['hyperliquid']={'status':'blocked','reason':str(exc)}
 if with_robinhood:
  try:report['coverage']['robinhood']=robinhood_summary(caps['robinhood_discovery'],now)
  except Exception as exc:report['coverage']['robinhood']={'status':'blocked','reason':str(exc)}
 if len(markets)>MAX_IDENTITIES:raise ValueError('identity budget exceeded')
 unique(markets,lambda x:x['id']);screens=[];reason_counts=collections.Counter()
 for e in markets:
  reasons=prefilter(e);reason_counts.update(reasons);e['prefilter_reasons']=reasons;e['screen_status']='needs_independent_review_and_current_quotes' if not reasons else 'screen_rejected';screens.append(e)
 shortlist=[]
 for venue in ('kraken','hyperliquid'):
  eligible=[x for x in screens if x['venue']==venue and not x['prefilter_reasons']]
  shortlist.extend(sorted(eligible,key=lambda x:(-num(x['quote_volume_24h']),x['id']))[:2])
 report['pre_screen_reasons']=dict(reason_counts);report['screened_identities']=len(screens);report['prefilter_pass_count']=sum(not x['prefilter_reasons'] for x in screens);report['shortlist_count']=len(shortlist)
 for e in shortlist:
  detail={};at=time.time()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   fs={pool.submit(collector.fetch,k,e,at):k for k in ('depth','bars','trades')}
   for f in concurrent.futures.as_completed(fs):
    k=fs[f]
    try:detail[k]=f.result()
    except Exception as exc:report['sources'][e['id']+':'+k]={'status':'blocked','reason':str(exc)}
  report['leads'].append(review_evidence(e,detail,time.time()))
 report['completed_at']=stamp();report['budget']=collector.budget.summary();report['qualified_buy_count']=0
 report['source_captures']=[{'kind':k,'artifact':v.get('artifact'),'raw_sha256':v['raw_sha256'],'observed_at':v['response_observed_at'],'status':v['status'],'error':v['error']} for k,v in caps.items()]
 report['limitations']=['Bulk snapshots screen metadata/metrics, not verified per-market freshness.','Only four highest-volume passing identities receive deeper checks; remaining leads stay unreviewed.','No independent AI reviews, actual-account fee validation, total-cost certification, execution adapter or buy authorization.','Read-only run-once, not continuous agents or an activated schedule.']
 save_output(out,report,screens)
 print(json.dumps(report,indent=2))
 return report,screens

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--robinhood',action='store_true');p.add_argument('--replay');a=p.parse_args()
 if a.replay:replay(a.replay,a.out)
 else:run(a.out,a.robinhood)
