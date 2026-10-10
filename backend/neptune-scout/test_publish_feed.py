import base64,copy,datetime as dt,hashlib,json,unittest
import publish_feed as p
NOW=dt.datetime(2026,10,10,5,40,tzinfo=dt.timezone.utc)
SHA='a'*40

def fixture(at=NOW):
 return json.dumps({'protocol':p.PROTOCOL,'run':{'started_at':(at-dt.timedelta(seconds=60)).isoformat(),'completed_at':at.isoformat(),'source_commit':SHA,'workflow_run_id':'123'}},separators=(',',':')).encode()
class Fake:
 def __init__(self,old=None):self.old=old;self.calls=[];self.repo={'full_name':p.REPOSITORY,'private':False,'archived':False,'default_branch':'main','size':32028};self.conflict=False
 def call(self,method,suffix,body=None):
  self.calls.append((method,suffix,body))
  if method=='GET' and suffix=='':return 200,self.repo
  if method=='GET' and suffix=='/branches/'+p.DATA_BRANCH:return 200,{'name':p.DATA_BRANCH,'commit':{'sha':'b'*40}}
  if method=='GET':
   if self.old is None:return 404,None
   return 200,{'type':'file','path':p.TARGET_PATH,'encoding':'base64','content':base64.b64encode(self.old).decode(),'size':len(self.old),'sha':p.git_blob_sha(self.old)}
  if self.conflict:raise p.Conflict('conflict')
  self.old=base64.b64decode(body['content']);return 201,{'content':{'path':p.TARGET_PATH,'sha':p.git_blob_sha(self.old)},'commit':{'sha':'c'*40}}
 def puts(self):return [x for x in self.calls if x[0]=='PUT']
class TestPublisher(unittest.TestCase):
 def run_pub(self,client,raw=None,validator=lambda _:None):return p.publish(client,raw or fixture(),SHA,'123',validator,NOW)
 def test_bootstrap_one_exact_put(self):
  c=Fake();r=self.run_pub(c);self.assertEqual(r['status'],'published_verified');self.assertEqual(len(c.puts()),1);self.assertEqual(c.puts()[0][1],'/contents/'+p.TARGET_PATH);self.assertEqual(c.puts()[0][2]['branch'],p.DATA_BRANCH);self.assertNotIn('sha',c.puts()[0][2])
 def test_update_uses_observed_blob_sha(self):
  old=fixture(NOW-dt.timedelta(minutes=15)).replace(b'"workflow_run_id":"123"',b'"workflow_run_id":"122"');c=Fake(old);self.run_pub(c);self.assertEqual(c.puts()[0][2]['sha'],p.git_blob_sha(old));self.assertEqual(set(c.puts()[0][2]),{'branch','message','content','sha'})
 def test_identical_no_put(self):c=Fake(fixture());self.assertEqual(self.run_pub(c)['status'],'unchanged');self.assertFalse(c.puts())
 def test_newer_preserved(self):c=Fake(fixture(NOW+dt.timedelta(minutes=1)));self.assertEqual(self.run_pub(c)['status'],'immutable_run_preserved');self.assertFalse(c.puts())
 def test_conflict_no_retry(self):c=Fake();c.conflict=True;self.assertRaises(p.Conflict,self.run_pub,c);self.assertEqual(len(c.puts()),1)
 def test_validator_fails_before_network(self):
  c=Fake()
  def bad(_):raise p.PublishError('invalid')
  self.assertRaises(p.PublishError,self.run_pub,c,None,bad);self.assertFalse(c.calls)
 def test_private_repo_stops(self):c=Fake();c.repo['private']=True;self.assertRaises(p.PublishError,self.run_pub,c);self.assertFalse(c.puts())
 def test_repo_growth_stops(self):c=Fake();c.repo['size']=p.MAX_REPOSITORY_KIB;self.assertRaises(p.PublishError,self.run_pub,c);self.assertFalse(c.puts())
 def test_wrong_commit(self):self.assertRaises(p.PublishError,p.publish,Fake(),fixture(),'f'*40,'123',lambda _:None,NOW)
 def test_wrong_run_id(self):self.assertRaises(p.PublishError,p.publish,Fake(),fixture(),SHA,'456',lambda _:None,NOW)
 def test_stale_stops(self):self.assertRaises(p.PublishError,self.run_pub,Fake(),fixture(NOW-dt.timedelta(minutes=11)))
 def test_future_stops(self):self.assertRaises(p.PublishError,self.run_pub,Fake(),fixture(NOW+dt.timedelta(seconds=6)))
 def test_duplicate_json(self):self.assertRaises(p.PublishError,p.parse,b'{"x":1,"x":2}')
 def test_oversize(self):self.assertRaises(p.PublishError,p.parse,b' '*65537)
 def test_job_output_digest(self):
  b=fixture();self.assertEqual(p.decode_output(base64.b64encode(b).decode(),hashlib.sha256(b).hexdigest()),b);self.assertRaises(p.PublishError,p.decode_output,base64.b64encode(b).decode(),'0'*64)
 def test_nonfinite(self):self.assertRaises(p.PublishError,p.parse,b'{"x":NaN}')
 def test_timezone_required(self):self.assertRaises(p.PublishError,p.timestamp,'2026-10-10T05:40:00')
 def test_redirect_refused(self):self.assertRaises(p.PublishError,p.NoRedirect().redirect_request,None,None,302,None,None,'https://evil.invalid')
 def test_actual_client_rejects_wrong_write_path_without_network(self):
  c=p.GitHub('test-not-secret');self.assertRaises(p.PublishError,c.call,'PUT','/contents/private.txt',{'branch':p.DATA_BRANCH});self.assertRaises(p.PublishError,c.call,'PUT','/contents/'+p.TARGET_PATH,{'branch':'main'});self.assertEqual(c.puts,0)
 def test_actual_client_rejects_other_methods(self):c=p.GitHub('test-not-secret');self.assertRaises(p.PublishError,c.call,'DELETE','/contents/'+p.TARGET_PATH)
 def test_same_run_id_cannot_publish_different_later_payload(self):c=Fake(fixture(NOW-dt.timedelta(minutes=1)));self.assertEqual(self.run_pub(c)['status'],'immutable_run_preserved');self.assertFalse(c.puts())
if __name__=='__main__':unittest.main()
