import copy,datetime as dt,email.utils,json,pathlib,unittest
from unittest.mock import patch
import scout as s

T=1791608400.0
def iso(t):return dt.datetime.fromtimestamp(t,s.UTC).isoformat()
def capture(kind,data,market=None,at=T):
 provider,method,url,body,weight=s.specification(kind,market,at)
 raw=s.canonical(data)
 return {'protocol':s.PROTOCOL,'kind':kind,'market_id':None if market is None else market['id'],'provider':provider,'method':method,'url':url,'request_body':body,'request_started_at':iso(at),'response_observed_at':iso(at+1),'status':200,'headers':{'date':email.utils.format_datetime(dt.datetime.fromtimestamp(at+1,s.UTC),usegmt=True),'content-type':'application/json'},'raw_sha256':s.digest(raw),'raw_bytes':len(raw.encode()),'raw':raw,'error':None}
def change_raw(cap,data):
 cap=copy.deepcopy(cap);raw=s.canonical(data);cap.update(raw=raw,raw_sha256=s.digest(raw),raw_bytes=len(raw.encode()));return cap
def fixture_market(venue='kraken'):
 return {'id':'kraken:ETH/USD' if venue=='kraken' else 'hyperliquid:@107','venue':venue,'instrument_id':'ETH/USD' if venue=='kraken' else '@107','pair':'ETH/USD' if venue=='kraken' else 'HYPE/USDC','base':'ETH' if venue=='kraken' else 'HYPE','quote':'USD' if venue=='kraken' else 'USDC','base_id':'ETH' if venue=='kraken' else '0x'+'1'*32,'quote_id':'USD' if venue=='kraken' else '0x'+'2'*32,'rules_known':venue=='kraken','quote_volume_24h':'1000000','change_pct':'5','spread_bps':'10'}
def minimal_kraken():
 m={'ETH/USD':{'wsname':'ETH/USD','base':'ETH','quote':'USD','status':'online','execution_venue':'international','aclass_base':'currency','aclass_quote':'currency','lot':'unit','lot_decimals':8,'ordermin':'.001','costmin':'.5','tick_size':'.01'}}
 t={'ETH/USD':{'a':['101','1','1'],'b':['100','1','1'],'c':['101','1'],'o':'97','v':['1','10000'],'p':['1','100']}}
 return capture('kraken_metadata',{'error':[],'result':m}),capture('kraken_tickers',{'error':[],'result':t})
def minimal_hl():
 # Deliberately sparse indices: market 3, base token 7. Never zip arrays.
 tokens=[{'index':7,'name':'HYPE','tokenId':'0x'+'1'*32,'szDecimals':2,'fullName':'Hyperliquid'},{'index':0,'name':'USDC','tokenId':'0x'+'2'*32,'szDecimals':8,'fullName':'USDC'}]
 meta={'tokens':tokens,'universe':[{'index':3,'name':'@3','tokens':[7,0]}]}
 ctx=[{'coin':'@0'},{'coin':'@1'},{'coin':'@2'},{'coin':'@3','midPx':'105','prevDayPx':'100','dayNtlVlm':'1000000'}]
 return capture('hyperliquid_bulk',[meta,ctx])

class TestTransport(unittest.TestCase):
 def test_valid(self):c,_=minimal_kraken();self.assertIn('result',s.validate_capture(c,'kraken_metadata',now=T+2))
 def test_tampered_digest(self):
  c,_=minimal_kraken();c['raw']+=' ';self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_wrong_url(self):
  c,_=minimal_kraken();c['url']='https://evil.invalid';self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_wrong_method(self):
  c,_=minimal_kraken();c['method']='POST';self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_future_receipt(self):
  c,_=minimal_kraken();self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T-1)
 def test_expired_receipt(self):
  c,_=minimal_kraken();self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+200)
 def test_cache_age(self):
  c,_=minimal_kraken();c['headers']['age']='601';self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_stale_http_date(self):
  c,_=minimal_kraken();c['headers']['date']=email.utils.formatdate(T-300,usegmt=True);self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_missing_date(self):
  c,_=minimal_kraken();del c['headers']['date'];self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_bad_content_type(self):
  c,_=minimal_kraken();c['headers']['content-type']='text/html';self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_failed_response(self):
  c,_=minimal_kraken();c['status']=429;self.assertRaises(ValueError,s.validate_capture,c,'kraken_metadata',now=T+2)
 def test_duplicate_json(self):self.assertRaises(ValueError,s.load_json,'{"a":1,"a":2}')
 def test_nonfinite_json(self):self.assertRaises(ValueError,s.load_json,'{"a":NaN}')
 def test_nonfinite_decimal(self):
  for v in ('NaN','Infinity','1e50',True):self.assertRaises(ValueError,s.num,v)
 def test_redirect_disabled(self):self.assertRaises(ValueError,s.NoRedirect().redirect_request,None,None,301,'m',{},'https://evil.invalid')
 def test_unsupported_venue(self):
  m=fixture_market();m['venue']='binance';self.assertRaises(ValueError,s.specification,'depth',m,T)

class TestBudget(unittest.TestCase):
 def test_request_cap(self):
  b=s.Budget()
  for _ in range(12):b.reserve('kraken')
  self.assertRaises(ValueError,b.reserve,'kraken')
 def test_weight_cap(self):
  b=s.Budget();b.reserve('hyperliquid',160);self.assertRaises(ValueError,b.reserve,'hyperliquid',2)
 def test_refusal_blocks_further(self):
  for code in (401,402,403,429):
   b=s.Budget();b.observe('hyperliquid',code,{});self.assertRaises(ValueError,b.reserve,'hyperliquid')
 def test_shared_credit_reserve(self):
  b=s.Budget();b.observe('dexpaprika',200,{'x-credits-remaining':'1000'});self.assertRaises(ValueError,b.reserve,'dexpaprika')
 def test_unknown_credit_no_unlimited_loop(self):
  b=s.Budget();b.reserve('dexpaprika');self.assertRaises(ValueError,b.reserve,'dexpaprika')
 def test_spacing(self):
  b=s.Budget();b.reserve('kraken');self.assertGreater(b.reserve('kraken'),1)
 def test_bad_quota_header(self):
  b=s.Budget();b.observe('dexpaprika',200,{'x-credits-remaining':'nonsense'});self.assertRaises(ValueError,b.reserve,'dexpaprika')

class TestIdentities(unittest.TestCase):
 def test_kraken_identity(self):
  a,b=minimal_kraken();r,_=s.normalize_kraken(a,b,T+2);self.assertEqual(r[0]['id'],'kraken:ETH/USD')
 def test_kraken_forged_base(self):
  a,b=minimal_kraken();d=s.load_json(a['raw']);d['result']['ETH/USD']['base']='SOL';r,_=s.normalize_kraken(change_raw(a,d),b,T+2);self.assertEqual(r,[])
 def test_crossed_ticker(self):
  a,b=minimal_kraken();d=s.load_json(b['raw']);d['result']['ETH/USD']['b'][0]='102';r,_=s.normalize_kraken(a,change_raw(b,d),T+2);self.assertEqual(r,[])
 def test_owner_exclusion(self):
  for base in s.EXCLUDED:self.assertFalse(s.safe_base(base))
 def test_au_route_restriction(self):
  a,b=minimal_kraken();ma=s.load_json(a['raw']);ta=s.load_json(b['raw']);m=ma['result'].pop('ETH/USD');m.update(base='XMR',wsname='XMR/USD');ma['result']['XMR/USD']=m;ta['result']['XMR/USD']=ta['result'].pop('ETH/USD');r,reject=s.normalize_kraken(change_raw(a,ma),change_raw(b,ta),T+2);self.assertEqual(r,[]);self.assertEqual(reject['australian_route_restricted'],1)
 def test_sparse_hl_exact_indices(self):
  r,_,_=s.normalize_hyperliquid(minimal_hl(),T+2);self.assertEqual(r[0]['instrument_id'],'@3');self.assertEqual(r[0]['sizing_rules']['base_token_index'],7)
 def test_shuffled_tokens_valid(self):
  c=minimal_hl();j=s.load_json(c['raw']);j[0]['tokens'].reverse();r,_,_=s.normalize_hyperliquid(change_raw(c,j),T+2);self.assertEqual(r[0]['base'],'HYPE')
 def test_duplicate_token_index(self):
  c=minimal_hl();j=s.load_json(c['raw']);j[0]['tokens'].append(j[0]['tokens'][0]);self.assertRaises(ValueError,s.normalize_hyperliquid,change_raw(c,j),T+2)
 def test_duplicate_context(self):
  c=minimal_hl();j=s.load_json(c['raw']);j[1].append(j[1][3]);self.assertRaises(ValueError,s.normalize_hyperliquid,change_raw(c,j),T+2)
 def test_wrong_context_index_omitted(self):
  c=minimal_hl();j=s.load_json(c['raw']);j[1][0],j[1][3]=j[1][3],j[1][0];r,_,_=s.normalize_hyperliquid(change_raw(c,j),T+2);self.assertEqual(r,[])
 def test_quote_not_assumed_usd(self):
  c=minimal_hl();j=s.load_json(c['raw']);j[0]['tokens'][1]['name']='USDH';r,reject,_=s.normalize_hyperliquid(change_raw(c,j),T+2);self.assertEqual(r,[]);self.assertEqual(reject['non_usdc_quote'],1)
 def test_foreign_pair_request_refused(self):
  m=fixture_market();m['instrument_id']='https://evil.invalid';self.assertRaises(ValueError,s.specification,'depth',m,T)

class TestGates(unittest.TestCase):
 def test_run_once_emits_bounded_report_end_to_end_without_network(self):
  import tempfile,io,contextlib
  a,b=minimal_kraken();h=minimal_hl();raw=s.load_json(h['raw']);raw[1][3]['dayNtlVlm']='0';h=change_raw(h,raw)
  class FakeCollector:
   def __init__(self,out):self.budget=s.Budget()
   def fetch(self,kind,*args):return {'kraken_metadata':a,'kraken_tickers':b,'hyperliquid_bulk':h}[kind]
  with tempfile.TemporaryDirectory() as d,patch.object(s,'Collector',FakeCollector),patch.object(s.time,'time',return_value=T+2),contextlib.redirect_stdout(io.StringIO()):
   report,markets=s.run(d);self.assertEqual(report['screened_identities'],2);self.assertEqual(report['qualified_buy_count'],0);self.assertFalse(report['continuous_runtime']);self.assertTrue((pathlib.Path(d)/'research-snapshot.json').exists());self.assertLess((pathlib.Path(d)/'research-snapshot.json').stat().st_size,s.MAX_OUTPUT)
 def candles(self,n=721):
  cutoff=int(T//900)*900
  return [[cutoff-(n-1-i)*900,'100','102','99','101','100','10',1] for i in range(n)]
 def test_721_observed_kraken_variant_excludes_mutable(self):
  e=fixture_market();rows=self.candles();j={'error':[],'result':{e['instrument_id']:rows,'last':int(T)}};bars=s.parse_candles(capture('bars',j,e),e,T+2);self.assertEqual(len(bars),22);self.assertLessEqual(bars[-1][0]+900,T)
 def test_721_all_completed_rejected(self):
  e=fixture_market();rows=self.candles();
  for r in rows:r[0]-=900
  j={'error':[],'result':{e['instrument_id']:rows,'last':int(T)}};self.assertRaises(ValueError,s.parse_candles,capture('bars',j,e),e,T+2)
 def test_722_rejected(self):
  e=fixture_market();j={'error':[],'result':{e['instrument_id']:self.candles(722),'last':int(T)}};self.assertRaises(ValueError,s.parse_candles,capture('bars',j,e),e,T+2)
 def test_fractional_candle_rejected(self):
  e=fixture_market();rows=self.candles(30);rows[0][0]+=.5;j={'error':[],'result':{e['instrument_id']:rows,'last':int(T)}};self.assertRaises(ValueError,s.parse_candles,capture('bars',j,e),e,T+2)
 def test_candle_gap_rejected(self):
  e=fixture_market();rows=self.candles(30);rows.pop(10);j={'error':[],'result':{e['instrument_id']:rows,'last':int(T)}};self.assertRaises(ValueError,s.parse_candles,capture('bars',j,e),e,T+2)
 def test_future_candle_rejected(self):
  e=fixture_market();rows=self.candles(30);rows[-1][0]+=900;j={'error':[],'result':{e['instrument_id']:rows,'last':int(T)}};self.assertRaises(ValueError,s.parse_candles,capture('bars',j,e),e,T+2)
 def test_candle_request_coin_cannot_change(self):
  e=fixture_market('hyperliquid');c=capture('bars',[],e);c['request_body']['req']['coin']='@700';self.assertRaises(ValueError,s.validate_capture,c,'bars',e,T+2)
 def test_summary_output_budget_fail_closed(self):
  import tempfile
  with tempfile.TemporaryDirectory() as d:self.assertRaises(ValueError,s.save_output,pathlib.Path(d),{'note':'x'*70000},[])
 def test_prefilter_thresholds(self):
  e=fixture_market();self.assertEqual(s.prefilter(e),[]);e['quote_volume_24h']='99999';self.assertIn('volume_below_100k_quote',s.prefilter(e))
 def test_spread_gate(self):
  e=fixture_market();e['spread_bps']='36';self.assertIn('spread_above_35_bps',s.prefilter(e))
 def test_change_gate(self):
  e=fixture_market();e['change_pct']='1000';self.assertIn('change_outside_3_to_60_percent',s.prefilter(e))
 def test_exact_depth_sweep(self):
  qty,cost=s.sweep([(s.D('10'),s.D('5')),(s.D('20'),s.D('10'))],quote_budget=s.D('100'));self.assertEqual(qty,s.D('7.5'));self.assertEqual(cost,s.D('100'))
 def test_missing_depth_fails(self):self.assertRaises(ValueError,s.sweep,[(s.D('10'),s.D('1'))],quote_budget=s.D('100'))
 def test_wrong_depth_identity(self):
  e=fixture_market();c=capture('depth',{'error':[],'result':{'SOL/USD':{'bids':[],'asks':[]}}},e);self.assertRaises(ValueError,s.parse_depth,c,e,T+2)
 def test_future_book_level(self):
  e=fixture_market();j={'error':[],'result':{'ETH/USD':{'bids':[['100','10',T+10]],'asks':[['101','10',T]]}}};self.assertRaises(ValueError,s.parse_depth,capture('depth',j,e),e,T+2)
 def test_duplicate_book_level(self):
  e=fixture_market();j={'error':[],'result':{'ETH/USD':{'bids':[['100','10',T],['100','5',T]],'asks':[['101','10',T]]}}};self.assertRaises(ValueError,s.parse_depth,capture('depth',j,e),e,T+2)
 def test_stale_last_trade(self):
  e=fixture_market();j={'error':[],'result':{'ETH/USD':[['100','10',T-100,'b','m','',1]],'last':'1'}};self.assertRaises(ValueError,s.parse_trade,capture('trades',j,e),e,T+2)
 def test_missing_evidence_never_qualifies(self):
  out=s.review_evidence(fixture_market(),{},T+2);self.assertFalse(out['execution_eligible']);self.assertFalse(out['qualified_buy']);self.assertEqual(out['ai_review_status'],'not_reviewed');self.assertTrue(out['blocking_reasons'])
 def test_dex_identity_forgery(self):
  j={'results':[{'chain':'ethereum','address':'0x'+'1'*40,'liquidity_usd':100000}],'has_next_page':True};self.assertRaises(ValueError,s.robinhood_summary,capture('robinhood_discovery',j),T+2)
 def test_dex_invalid_liquidity_delayed(self):
  j={'results':[{'chain':'robinhood','address':'0x'+'1'*40,'liquidity_usd':7.65e26}],'has_next_page':True};r=s.robinhood_summary(capture('robinhood_discovery',j),T+2);self.assertEqual(r['invalid_liquidity_rows'],1);self.assertEqual(r['qualified'],0);self.assertFalse(r['live_market_coverage'])

if __name__=='__main__':unittest.main()
