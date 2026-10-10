import unittest
import admission as a

def run(id,n,status='completed',conclusion='success'):return {'id':id,'run_number':n,'head_branch':'main','event':'schedule','status':status,'conclusion':conclusion}
class TestAdmission(unittest.TestCase):
 def test_first_run(self):self.assertIsNone(a.decision([run(1,1,'in_progress',None)],'1','1',None))
 def test_success_accounted(self):self.assertIsNone(a.decision([run(2,2),run(1,1)],'2','1',{'workflow_run_id':'1','recovery_required_run_id':None}))
 def test_failure_quarantines(self):self.assertEqual(a.decision([run(2,2),run(1,1,conclusion='failure')],'2','1',None),'1')
 def test_success_without_published_state_quarantines(self):self.assertEqual(a.decision([run(2,2),run(1,1)],'2','1',None),'1')
 def test_latch_survives_successful_quarantine_publication(self):self.assertEqual(a.decision([run(3,3),run(2,2)],'3','1',{'workflow_run_id':'2','recovery_required_run_id':'1'}),'1')
 def test_exact_manual_recovery(self):self.assertIsNone(a.decision([run(3,3),run(2,2)],'3','1',{'workflow_run_id':'2','recovery_required_run_id':'1'},'1','workflow_dispatch'))
 def test_schedule_cannot_recover(self):self.assertEqual(a.decision([run(3,3),run(2,2)],'3','1',{'workflow_run_id':'2','recovery_required_run_id':'1'},'1','schedule'),'1')
 def test_wrong_recovery_id(self):self.assertEqual(a.decision([run(3,3),run(2,2)],'3','1',{'workflow_run_id':'2','recovery_required_run_id':'1'},'2','workflow_dispatch'),'1')
 def test_history_gap(self):self.assertEqual(a.decision([run(7,7)],'7','1',None),'7')
 def test_current_missing(self):self.assertEqual(a.decision([],'7','1',None),'7')
 def test_retry_requires_review(self):self.assertEqual(a.decision([run(1,1)],'1','2',None),'1')
 def test_missing_intermediate_run_quarantines(self):self.assertEqual(a.decision([run(7,7),run(5,5)],'7','1',{'workflow_run_id':'5','recovery_required_run_id':None}),'7')
if __name__=='__main__':unittest.main()
