"""Public Telegram only. No credentials, orders, guessed levels or X ingestion."""
import json,re,sys,urllib.request
from datetime import datetime,timezone,timedelta
from pathlib import Path
from html.parser import HTMLParser

CHANNELS=('virtualbacon','vb_trade')
class Messages(HTMLParser):
    def __init__(self):
        super().__init__(); self.stack=[];self.current=None;self.posts=[];self.text_depth=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);classes=a.get('class','').split()
        if tag not in ('br','img','meta','link','input','hr','source'):self.stack.append(tag)
        if 'data-post' in a and re.fullmatch(r'(virtualbacon|vb_trade)/\d+',a['data-post']):
            self.current={'url':'https://t.me/'+a['data-post'],'channel':a['data-post'].split('/')[0],'text':'','publishedAt':None};self.posts.append(self.current)
        if self.current and 'tgme_widget_message_text' in classes:self.text_depth=len(self.stack)
        if self.current and 'tgme_widget_message_forwarded_from' in classes:self.current['forwarded']=True
        if self.current and tag=='time':self.current['publishedAt']=a.get('datetime')
        if self.text_depth and tag=='br':self.current['text']+='\n'
    def handle_data(self,data):
        if self.current and self.text_depth:self.current['text']+=data
    def handle_endtag(self,tag):
        if self.text_depth==len(self.stack):self.text_depth=None
        if self.stack and self.stack[-1]==tag:self.stack.pop()

def parse(html):
    p=Messages();p.feed(html)
    return [x for x in p.posts if x['text'].strip() and x['publishedAt']]

def explicit_setup(post,now):
    """Only an unambiguous complete plain-text spot buy template is eligible."""
    try:at=datetime.fromisoformat(post['publishedAt'].replace('Z','+00:00'))
    except (ValueError,KeyError):return None
    if at>now+timedelta(minutes=1) or now-at>timedelta(hours=24):return None
    if post.get('forwarded'):return None
    t=post['text']
    # Avoid hypothetical commentary, questions, multiple coins, ranges and leverage.
    if re.search(r'\b(if|could|would|might|example|hypothetical|short|leverage|futures|cancel|closed)\b|\?',t,re.I):return None
    pairs=re.findall(r'\b([A-Z0-9]{2,15})\s*[/\-]?\s*USDT\b',t)
    if len(set(pairs))!=1 or not re.search(r'(?im)^\s*(?:spot\s+)?(?:buy|long)\b',t):return None
    def level(label):
        found=re.findall(r'(?im)^\s*'+label+r'\s*[:=]\s*\$?([0-9]+(?:\.[0-9]+)?)\s*$',t)
        return float(found[0]) if len(found)==1 else None
    entry=level('entry');stop=level('(?:stop|stop loss|sl)')
    targets=re.findall(r'(?im)^\s*(?:target(?:\s*\d+)?|tp\s*\d+)\s*[:=]\s*\$?([0-9]+(?:\.[0-9]+)?)\s*$',t)
    targets=[float(n) for n in targets]
    if not entry or not stop or not targets or not 0<stop<entry or not all(n>entry for n in targets):return None
    return {'verified':True,'pair':pairs[0]+'/USDT','side':'buy','entry':entry,'stop':stop,'targets':targets,'publishedAt':post['publishedAt'],'sourceUrl':post['url'],'executableLeverage':1}

def run():
    path=Path('data/bacon-intelligence.json');data=json.loads(path.read_text());now=datetime.now(timezone.utc);posts=[];health=[]
    for channel in CHANNELS:
        try:
            req=urllib.request.Request('https://t.me/s/'+channel,headers={'User-Agent':'SeaChefLabs-PublicFeed/1.0'})
            with urllib.request.urlopen(req,timeout=20) as r:html=r.read(2_000_000).decode('utf-8')
            found=parse(html)
            if not found:raise ValueError('No readable public posts')
            posts+=found;health.append({'channel':channel,'ok':True,'count':len(found)})
        except Exception as e:health.append({'channel':channel,'ok':False,'error':str(e)[:150]})
    if not posts:raise RuntimeError('Both public feeds unavailable. Last saved feed left intact.')
    # Retain exact provenance, discard future dates. No video/chart inference.
    posts=[p for p in posts if datetime.fromisoformat(p['publishedAt'].replace('Z','+00:00'))<=now+timedelta(minutes=1)]
    merged={p['url']:p for p in data.get('posts',[])};merged.update({p['url']:p for p in posts})
    data['posts']=sorted(merged.values(),key=lambda p:p['publishedAt'],reverse=True)[:60]
    data['checkedAt']=now.isoformat();data['feedHealth']=health
    data['setups']=[s for p in posts if (s:=explicit_setup(p,now))]
    # Promote only complete sourced setups; raw mentions never become buy cards.
    for s in data['setups']:
        symbol=s['pair'].split('/')[0]
        coin=next((c for c in data['coins'] if c['symbol']==symbol),None)
        if not coin:
            coin={'symbol':symbol,'name':symbol};data['coins'].append(coin)
        coin.update(status='bacon-bought',baconView='Complete spot buy setup posted by Bacon.',narrative='Bacon’s spot setup',firstSeen=s['publishedAt'][:10],source='VB public Telegram',sourceUrl=s['sourceUrl'])
    data['sourceAlert']=('Bacon reported his X account compromised. X posts are excluded; public Telegram only.' if any(re.search(r'(?i)(?:my X account.*(?:compromised|hacked)|X account is still compromised)',p['text']) for p in data['posts'][:20]) else None)
    history_path=Path('data/bacon-history.json')
    history=json.loads(history_path.read_text()) if history_path.exists() else {'schema':1,'records':[]}
    records={(r['symbol'],r.get('date'),r.get('sourceUrl')):r for r in history['records']}
    for coin in data['coins']:
        if coin.get('status')=='bacon-bought':
            record={'symbol':coin['symbol'],'date':coin.get('firstSeen'),'narrative':coin.get('narrative'),'baconView':coin.get('baconView'),'source':coin.get('source'),'sourceUrl':coin.get('sourceUrl')}
            records[(record['symbol'],record['date'],record['sourceUrl'])]=record
    history['records']=sorted(records.values(),key=lambda r:r.get('date') or '',reverse=True)
    history_path.write_text(json.dumps(history,indent=2,ensure_ascii=False)+'\n')
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'posts':len(data['posts']),'setups':len(data['setups']),'feeds':health}))
if __name__=='__main__':run()
