"""Offline end-to-end failure publication. Public HTTP and GitHub writes are mocked."""
import datetime as dt,json,pathlib,subprocess,tempfile,unittest
from unittest.mock import patch
import scout,scheduled_scout as s,publish_feed as p
from test_publish_feed import Fake,SHA
ROOT=pathlib.Path(__file__).resolve().parent
class TestIntegration(unittest.TestCase):
 def test_refusal_failed_run_project_validate_and_one_path_publish(self):
  original=scout.Budget
  with tempfile.TemporaryDirectory() as folder:
   out=pathlib.Path(folder)/'run';dest=pathlib.Path(folder)/'feed.json'
   def fail(*_):
    scout.Budget().observe('kraken',403,{})
    raise ValueError('local output failure')
   with patch.object(s,'prior_state',return_value=(s.empty_state(),None)),patch.object(s.admission,'check',return_value=None),patch.object(s.pub,'GitHub'),patch.object(s.sys,'argv',['scheduled_scout.py','--out',str(out)]),patch.object(scout,'Budget',original),patch.object(scout,'run',side_effect=fail),patch.object(s,'run_child',side_effect=lambda out: s.collect_child(out)):
    s.main()
   subprocess.run(['node',str(ROOT/'project-feed.mjs'),str(out/'RUN-RESULT.json'),str(out/'research-snapshot.json'),str(dest),'--source-commit',SHA,'--run-id','123','--rate-state',str(out/'rate-state.json')],check=True,capture_output=True)
   raw=dest.read_bytes();obj=json.loads(raw)
   self.assertEqual(obj['run']['status'],'failed');self.assertIsNone(obj['coverage']);self.assertTrue(obj['provider_status']['kraken']['permanent']);self.assertEqual(obj['leads'],[])
   def validate(data):subprocess.run(['node',str(ROOT/'validate-feed.mjs'),'-'],input=data,check=True,capture_output=True)
   client=Fake();result=p.publish(client,raw,SHA,'123',validate)
   self.assertEqual(result['status'],'published_verified');self.assertEqual(len(client.puts()),1)
   state=s.prior_state(client,s.strict_validate);self.assertTrue(s.is_blocked(state,'kraken',dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=365)))
 def test_nonzero_coverage_requires_successful_bulk_sources(self):
  with tempfile.TemporaryDirectory() as folder:
   out=pathlib.Path(folder);dest=out/'feed.json';s.save_state(out,s.empty_state());s.failed_report(out,scout.stamp())
   subprocess.run(['node',str(ROOT/'project-feed.mjs'),str(out/'RUN-RESULT.json'),str(out/'research-snapshot.json'),str(dest),'--source-commit',SHA,'--run-id','123','--rate-state',str(out/'rate-state.json')],check=True,capture_output=True)
   original=json.loads(dest.read_text());original['run']['status']='completed';original['run']['acquisition_mode']='public_read';original['coverage']={'kraken':1,'hyperliquid':0,'screened_identities':1,'coarse_passes':0,'detailed_leads':0};original['coarse_rejections']={'volume_below_100k_quote':0,'change_outside_3_to_60_percent':0,'spread_above_35_bps':0}
   def validates(obj):return subprocess.run(['node',str(ROOT/'validate-feed.mjs'),'-'],input=json.dumps(obj).encode(),capture_output=True).returncode==0
   self.assertFalse(validates(original))
   def source(name,status='ok'):return {'source_id':name,'sha256':'a'*64,'sample_lower_bound':original['run']['started_at'],'observed_at':original['run']['completed_at'],'status':status}
   original['sources']=[source('kraken_metadata'),source('kraken_tickers','failed')];self.assertFalse(validates(original))
   original['sources']=[source('kraken_metadata'),source('kraken_tickers')];self.assertTrue(validates(original))
   original['coverage'].update(kraken=0,hyperliquid=1);self.assertFalse(validates(original));original['sources']=[source('hyperliquid_bulk')];self.assertTrue(validates(original))
if __name__=='__main__':unittest.main()
