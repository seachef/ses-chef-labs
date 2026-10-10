#!/usr/bin/env node
import fs from 'node:fs';
import {validatePublicFeed} from './public-feed.mjs';
try{
 const [file,...args]=process.argv.slice(2);if(!file)throw Error('Usage: validate-feed.mjs INPUT|- [--source-commit SHA --run-id ID] [--allow-expired]');
 const options={now_ms:Date.now(),allow_expired_discovery:false};
 for(let i=0;i<args.length;i++){if(args[i]==='--allow-expired')options.allow_expired_discovery=true;else if(args[i]==='--source-commit')options.source_commit=args[++i];else if(args[i]==='--run-id')options.run_id=args[++i];else throw Error('invalid_argument');}
 const fd=file==='-'?0:fs.openSync(file,'r');const buffer=Buffer.alloc(65537);let count=0;while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,null);if(!n)break;count+=n;}if(file!=='-')fs.closeSync(fd);if(count>65536)throw Error('public_input_budget_exceeded');const raw=buffer.subarray(0,count).toString('utf8');const result=await validatePublicFeed(raw,options);if(!result.ok)throw Error(result.error);
 process.stdout.write(JSON.stringify({ok:true,bytes:Buffer.byteLength(raw),digest:result.digest,run_completed_at:result.feed.run.completed_at,leads:result.feed.leads.length,discovery_state:result.discovery_state,quote_state:result.quote_state})+'\n');
}catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=1;}
