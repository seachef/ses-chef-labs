"""Pass only bounded public data across jobs; no artifacts or executable text."""
import base64,hashlib,os,pathlib,sys
import publish_feed as pub
raw=pathlib.Path(sys.argv[1]).read_bytes()
pub.header(raw,source_commit=os.environ['SOURCE_COMMIT'],run_id=os.environ['WORKFLOW_RUN_ID'])
with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf8') as f:
 f.write('feed_base64='+base64.b64encode(raw).decode()+'\n')
 f.write('feed_sha256='+hashlib.sha256(raw).hexdigest()+'\n')
print('Sanitized public feed prepared:',len(raw),'bytes')
