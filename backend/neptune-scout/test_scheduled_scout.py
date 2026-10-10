import copy,datetime as dt,email.utils,tempfile,unittest
from unittest.mock import patch
import scout
import scheduled_scout as s
from test_publish_feed import Fake,NOW
class TestPersistentBackoff(unittest.TestCase):
 def cap(self,status,retry=None):return {'provider':'kraken','status':status,'response_observed_at':NOW.isoformat(),'headers':{} if retry is None else {'retry-after':retry}}
 def test_permanent_denials(self):
  for code in (401,402,403,418,451):
   state=s.update_state(s.empty_state(),[self.cap(code)]);self.assertTrue(s.is_blocked(state,'kraken',NOW+dt.timedelta(days=100)));self.assertFalse(s.is_blocked(state,'hyperliquid',NOW))
 def test_429_respects_long_retry(self):
  state=s.update_state(s.empty_state(),[self.cap(429,'7200')]);self.assertTrue(s.is_blocked(state,'kraken',NOW+dt.timedelta(hours=1)));self.assertFalse(s.is_blocked(state,'kraken',NOW+dt.timedelta(hours=2)))
 def test_retry_date(self):
  state=s.update_state(s.empty_state(),[self.cap(429,email.utils.format_datetime(NOW+dt.timedelta(hours=3)))]);self.assertTrue(s.is_blocked(state,'kraken',NOW+dt.timedelta(hours=2)))
 def test_default_cooldown(self):state=s.update_state(s.empty_state(),[self.cap(429)]);self.assertTrue(s.is_blocked(state,'kraken',NOW+dt.timedelta(minutes=14)));self.assertFalse(s.is_blocked(state,'kraken',NOW+dt.timedelta(minutes=15)))
 def test_bad_retry_fails_permanent(self):state=s.update_state(s.empty_state(),[self.cap(429,'tomorrow-ish')]);self.assertTrue(state['kraken']['permanent'])
 def test_rate_does_not_weaken_permanent(self):state=s.update_state(s.empty_state(),[self.cap(403)]);new=s.update_state(state,[self.cap(429,'1')]);self.assertEqual(state,new)
 def test_no_response_does_not_refresh_refusal(self):state=s.update_state(s.empty_state(),[self.cap(403)]);self.assertEqual(state,s.update_state(state,[]))
 def test_missing_prior_schema_stops(self):
  from test_publish_feed import fixture
  c=Fake(fixture());self.assertRaises(KeyError,s.prior_state,c,lambda _:None)
 def test_bootstrap_empty_only_when_branch_exists(self):self.assertEqual(s.prior_state(Fake(),lambda _:None),s.empty_state())
 def test_weakened_state_rejected(self):x=s.update_state(s.empty_state(),[self.cap(403)]);x['kraken']['permanent']=False;self.assertRaises(ValueError,s.validate_state,x)
 def test_refusal_while_waiting_prevents_http_open(self):
  with tempfile.TemporaryDirectory() as d:
   c=scout.Collector(d)
   def wait(_):c.budget.observe('kraken',403,{})
   with patch.object(scout.time,'sleep',side_effect=wait),patch.object(scout.urllib.request,'build_opener') as opener:
    self.assertRaises(ValueError,c.fetch,'kraken_metadata');opener.assert_not_called()
 def test_refusal_survives_later_collector_failure(self):
  import json,pathlib
  original=scout.Budget
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d)/'new-run'
   def broken_run(*_):
    scout.Budget().observe('kraken',429,{'retry-after':'7200'})
    raise ValueError('output bound')
   with patch.object(s,'prior_state',return_value=(s.empty_state(),None)),patch.object(s.admission,'check',return_value=None),patch.object(s.pub,'GitHub'),patch.object(s.sys,'argv',['scheduled_scout.py','--out',str(out)]),patch.object(scout,'Budget',original),patch.object(scout,'run',side_effect=broken_run),patch.object(s,'run_child',side_effect=lambda out: s.collect_child(out)):
    s.main()
   state=json.loads((out/'rate-state.json').read_text());report=json.loads((out/'RUN-RESULT.json').read_text())
   self.assertEqual(state['kraken']['reason_code'],'http_429');self.assertEqual(report['run_outcome'],'failed');self.assertEqual(report['leads'],[])
   self.assertEqual(s.pub.timestamp(state['kraken']['blocked_until'])-s.pub.timestamp(state['kraken']['refused_at']),dt.timedelta(hours=2))
 def test_tiny_exponents_rejected_before_expansion(self):
  for text in ['1e-100000','1e-999999999','0e-999999999','1e100000']:
   self.assertRaises(ValueError,scout.num,text)
  self.assertRaises(ValueError,scout.scalar,scout.D('1e-100000'))
  self.assertEqual(len(scout.scalar(scout.num('1e-36',True))),38)
 def test_total_deadline_kills_child_and_omits_github_token(self):
  import os,pathlib,subprocess,time
  real_popen=subprocess.Popen;seen={}
  def sleeper(args,**kwargs):
   seen.update(kwargs)
   return real_popen([s.sys.executable,'-c','import time; time.sleep(5)'],**kwargs)
  start=time.monotonic()
  with patch.dict(os.environ,{'GH_READ_TOKEN':'not-a-real-token'}),patch.object(s.subprocess,'Popen',side_effect=sleeper):
   self.assertFalse(s.run_child(pathlib.Path('/tmp/unused'),timeout=.1))
  self.assertLess(time.monotonic()-start,2);self.assertNotIn('GH_READ_TOKEN',seen['env']);self.assertTrue(seen['start_new_session'])
 def test_recovery_latch_prevents_collector_start(self):
  import json,pathlib
  with tempfile.TemporaryDirectory() as folder:
   out=pathlib.Path(folder)/'run'
   state=s.update_state(s.empty_state(),[self.cap(403)])
   with patch.object(s,'prior_state',return_value=(state,{'workflow_run_id':'1','recovery_required_run_id':'1'})),patch.object(s.pub,'GitHub'),patch.object(s.admission,'check',return_value='1'),patch.object(s.sys,'argv',['scheduled_scout.py','--out',str(out)]),patch.object(s,'run_child') as child:
    s.main();child.assert_not_called()
   self.assertEqual(json.loads((out/'RUN-RESULT.json').read_text())['run_outcome'],'recovery_needed');self.assertEqual(json.loads((out/'rate-state.json').read_text()),state)
if __name__=='__main__':unittest.main()
