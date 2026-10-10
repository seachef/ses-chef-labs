-- SQL-native paper runtime candidate. No configuration, grants, scheduling or activation here.
create table neptune_v2_private.positions (
 asset text primary key check(asset in ('ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD','binance:SOLUSDT','hyperliquid:@107')),
 payload jsonb not null check(octet_length(payload::text)<=8192)
);
alter table neptune_v2_private.positions enable row level security;
revoke all on neptune_v2_private.positions from public;
create function neptune_v2_private.universe() returns text[] language sql immutable security invoker set search_path='' as $$select array['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD','binance:SOLUSDT','hyperliquid:@107']::text[]$$;
create function neptune_v2_private.num(v text) returns numeric language plpgsql immutable security invoker set search_path='' as $$begin
 if v is null or length(v)>48 or v !~ '^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$' then return null;end if;
 return v::numeric;exception when others then return null;end$$;
create function neptune_v2_private.ts(v text) returns timestamptz language plpgsql stable security invoker set search_path='' as $$begin
 if v is null or length(v)>40 then return null;end if;return v::timestamptz;exception when others then return null;end$$;
create function neptune_v2_private.fresh(v text,n timestamptz,seconds int) returns boolean language sql stable security invoker set search_path='' as $$select coalesce(neptune_v2_private.ts(v)<=n and neptune_v2_private.ts(v)>=n-make_interval(secs=>seconds),false)$$;
create function neptune_v2_private.initialize(currency text) returns void language plpgsql security invoker set search_path='' as $$begin
 if (select config_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8' then raise exception 'Reviewed matching build metadata required';end if;
 if currency is distinct from 'AUD' then raise exception 'Explicit account currency required';end if;
 insert into neptune_v2_private.account(id,currency,initial_cash,cash,state) values('neptune-paper-v2',currency,10000,10000,jsonb_build_object('enabled',false,'started_at',clock_timestamp(),'last_bar','{}'::jsonb,'pending','{}'::jsonb,'last_exit','{}'::jsonb,'realized',0,'fees',0,'fill_count',0,'fx_costs',0,'receivables','{}'::jsonb,'day',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD'),'day_equity',10000,'peak_equity',10000,'risk_paused',false));
 insert into neptune_v2_private.cash_ledger values('initial',null,clock_timestamp(),10000,10000);
 insert into public.neptune_paper_v2_status values('neptune-paper-v2','{"version":2,"mode":"PAPER","experimental":true,"historically_validated":false,"confidence":"unvalidated","account_id":"neptune-paper-v2","currency":"AUD","status":"stopped","heartbeat_at":null,"scan_at":null,"quote_at":null,"scan_complete":false,"message":"A$10,000 virtual account created; engine stopped.","account":{"initial_cash":10000,"cash":10000,"equity":10000,"realized_pnl":0,"unrealized_pnl":0,"fees":0,"fills":0,"reserved_cash":0,"available_cash":10000,"unsettled_usd":0,"fx_costs":0,"valuation_at":null,"fx_at":null,"fx_source":null,"fx":null,"fx_applied_rate":null,"fx_rate_date":null,"fx_retrieved_at":null},"risk":{"per_entry_pct":0.25,"max_notional_pct":10,"max_positions":3,"aggregate_pct":0.75,"daily_drawdown_pct":2,"total_drawdown_pct":5,"entry_paused":true,"pause_reason":"stopped"},"cost_model":{"fee_per_side_pct":0.8,"slippage_per_side_pct":0.25,"actual_fee_tier":false,"fx_adverse_per_side_pct":0.25,"fx_model":"ECB reference-rate synthetic AUD accounting"},"universe":["ETH/USD","SOL/USD","AVAX/USD","LINK/USD","AAVE/USD","UNI/USD"],"positions":[],"decisions":[],"fills":[],"results":[],"settlements":[],"config_version":"neptune-v2-experimental-1","config_hash":"00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8"}'::jsonb||jsonb_build_object('history_seq',(select coalesce(max(seq),0) from public.neptune_paper_v2_history),'source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1)),clock_timestamp());
end$$;
create function neptune_v2_private.book(m jsonb,n timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b jsonb:=m->'book';side text;v jsonb;p numeric;q numeric;prev numeric;firstbid numeric;firstask numeric;
begin
 if b is null then return jsonb_build_object('error','missing_book');end if;
 if not neptune_v2_private.fresh(b->>'at',n,30) or not neptune_v2_private.fresh(m->>'received_at',n,30) then return jsonb_build_object('error','stale_book');end if;
 foreach side in array array['bids','asks'] loop
 if jsonb_typeof(b->side) is distinct from 'array' or jsonb_array_length(b->side) not between 1 and 50 then return jsonb_build_object('error','invalid_depth');end if;
 prev:=null;
 for v in select value from jsonb_array_elements(b->side) loop
 p:=neptune_v2_private.num(v->>0);q:=neptune_v2_private.num(v->>1);
 if p is null or q is null or p not between 0.000000000001 and 10000000 or q not between 0.000000000001 and 1000000000000000 or (prev is not null and ((side='bids' and p>=prev) or (side='asks' and p<=prev))) then return jsonb_build_object('error','invalid_depth');end if;
 if prev is null then if side='bids' then firstbid:=p;else firstask:=p;end if;end if;prev:=p;
 end loop;end loop;
 if firstask<firstbid then return jsonb_build_object('error','crossed_book');end if;
 return b||jsonb_build_object('bid',firstbid,'ask',firstask,'spread',firstask/firstbid-1);
exception when others then return jsonb_build_object('error','invalid_depth');end$$;
create function neptune_v2_private.bars(m jsonb,n timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;arr jsonb:='[]';cnt int;t bigint;prev bigint;o numeric;h numeric;l numeric;c numeric;vol numeric;atr numeric:=0;priorclose numeric;breakout numeric:=0;meanvol numeric:=0;structural numeric:=1e20;i int;
begin
 if jsonb_typeof(m->'bars') is distinct from 'array' or jsonb_array_length(m->'bars') not between 22 and 100 then return jsonb_build_object('error','missing_completed_bars');end if;
 for v in select value from jsonb_array_elements(m->'bars') loop
 t:=neptune_v2_private.num(v->>'t')::bigint;
 if t is null or t%900000<>0 then return jsonb_build_object('error','invalid_completed_bars');end if;
 if to_timestamp(t/1000.0)+interval '15 minutes'>n then continue;end if;
 o:=neptune_v2_private.num(v->>'o');h:=neptune_v2_private.num(v->>'h');l:=neptune_v2_private.num(v->>'l');c:=neptune_v2_private.num(v->>'c');vol:=neptune_v2_private.num(v->>'v');
 if o is null or h is null or l is null or c is null or vol is null or least(o,h,l,c,vol)<=0 or greatest(o,h,l,c)>10000000 or h<greatest(o,c) or l>least(o,c) or (prev is not null and t<>prev+900000) then return jsonb_build_object('error','invalid_completed_bars');end if;
 arr:=arr||jsonb_build_array(v);prev:=t;
 end loop;cnt:=jsonb_array_length(arr);
 if cnt<22 then return jsonb_build_object('error','missing_completed_bars');end if;
 if not neptune_v2_private.fresh((to_timestamp(prev/1000.0)+interval '15 minutes')::text,n,899) then return jsonb_build_object('error','stale_completed_bars');end if;
 for i in cnt-14..cnt-1 loop v:=arr->i;priorclose:=(arr->(i-1)->>'c')::numeric;atr:=atr+greatest((v->>'h')::numeric-(v->>'l')::numeric,abs((v->>'h')::numeric-priorclose),abs((v->>'l')::numeric-priorclose));end loop;
 for i in cnt-21..cnt-2 loop breakout:=greatest(breakout,(arr->i->>'h')::numeric);meanvol:=meanvol+(arr->i->>'v')::numeric;end loop;
 for i in cnt-4..cnt-2 loop structural:=least(structural,(arr->i->>'l')::numeric);end loop;
 return jsonb_build_object('last',arr->(cnt-1),'atr',atr/14,'breakout',breakout,'mean_volume',meanvol/20,'structural',structural);
exception when others then return jsonb_build_object('error','invalid_completed_bars');end$$;
create function neptune_v2_private.metadata_ok(m jsonb,a text,n timestamptz) returns boolean language sql stable security invoker set search_path='' as $$
select coalesce(m#>>'{metadata,asset}'=a and m#>>'{metadata,venue}'='Kraken' and m#>>'{metadata,kind}'='spot' and m#>>'{metadata,quote}'='USD' and m#>>'{metadata,status}'='online' and m#>>'{metadata,source}'='https://api.kraken.com/0/public/AssetPairs' and neptune_v2_private.fresh(m#>>'{metadata,at}',n,86400) and neptune_v2_private.num(m#>>'{metadata,tick_size}') between 0.000000000001 and 1000 and neptune_v2_private.num(m#>>'{metadata,min_qty}')>0 and neptune_v2_private.num(m#>>'{metadata,min_cost}')>0 and neptune_v2_private.num(m#>>'{metadata,qty_decimals}') between 0 and 12 and neptune_v2_private.num(m#>>'{metadata,qty_decimals}')=floor(neptune_v2_private.num(m#>>'{metadata,qty_decimals}')),false)$$;
create function neptune_v2_private.depth_price(levels jsonb,qty numeric,side text,tick numeric default 0.000000000001) returns numeric language plpgsql immutable security invoker set search_path='' as $$declare leftqty numeric:=qty;cost numeric:=0;part numeric;v jsonb;rawprice numeric;begin
 if qty is null or qty<=0 or side not in ('buy','sell') or tick is null or tick<=0 then return null;end if;
 for v in select value from jsonb_array_elements(levels) loop part:=least(leftqty,(v->>1)::numeric);cost:=cost+part*(v->>0)::numeric;leftqty:=leftqty-part;if leftqty<=0 then exit;end if;end loop;
 if leftqty>0 then return null;end if;rawprice:=cost/qty*case when side='buy' then 1.0025 else .9975 end;return case when side='buy' then ceil(rawprice/tick)*tick else floor(rawprice/tick)*tick end;
end$$;
create function neptune_v2_private.decide(obs text,at_time timestamptz,a text,action text,reason text,b jsonb,p jsonb,result text default 'no_trade') returns jsonb language plpgsql security invoker set search_path='' as $$declare d jsonb;did text;begin
 did:=md5(obs||a||action||reason||result);
 d:=jsonb_build_object('id',did,'at',at_time,'asset',a,'action',action,'price',b->'bid','quote_currency',neptune_v2_private.instrument_currency(a),'reason',reason,'source',case when neptune_v2_private.native_spec(a) is null then 'Kraken public spot' else (neptune_v2_private.native_spec(a)->>'venue')||' public spot' end,'observation_id',obs,'risk_base',p->'initial_risk_base','stop',p->'stop','target',p->'target','invalidation',p->'invalidation','confidence','unvalidated','result',result,'origin_order_id',p->>'id','origin_decision_id',p->>'decision_id','config_version','neptune-v2-experimental-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1));
 if neptune_v2_private.native_spec(a) is not null then d:=d||jsonb_build_object('native_model_version',neptune_v2_private.native_model()->>'version','native_model_hash',neptune_v2_private.native_model()->>'hash','venue',neptune_v2_private.native_spec(a)->>'venue','market_type','spot','specialist_id',neptune_v2_private.native_spec(a)->>'agent');end if;
 insert into neptune_v2_private.decisions values(did,obs,at_time,d);
 if p->>'id' is not null and result in ('cancelled','blocked') then insert into neptune_v2_private.order_events values(md5('event'||did),p->>'id',obs,at_time,result,d);end if;return d;
end$$;
create function neptune_v2_private.make_order(d jsonb,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare r jsonb;begin
 r:=p||jsonb_build_object('id',md5('order'||(d->>'id')),'decision_id',d->>'id','observation_id',d->>'observation_id','at',d->>'at','asset',d->>'asset','side',d->>'action','reason',d->>'reason','config_hash',d->>'config_hash','source_hash',d->>'source_hash');
 if neptune_v2_private.native_spec(r->>'asset') is not null then r:=r||jsonb_build_object('native_model_version',d->>'native_model_version','native_model_hash',d->>'native_model_hash','venue',d->>'venue','market_type','spot','specialist_id',d->>'specialist_id','quote_currency',neptune_v2_private.instrument_currency(r->>'asset'));end if;
 insert into neptune_v2_private.orders values(r->>'id',r->>'decision_id',r->>'observation_id',(r->>'at')::timestamptz,r);insert into neptune_v2_private.order_events values(md5('created'||(r->>'id')),r->>'id',r->>'observation_id',(r->>'at')::timestamptz,'pending',r);return r;
end$$;
create function neptune_v2_private.execute_fill(obs text,at_time timestamptz,a text,ord jsonb,qty numeric,price numeric,fx jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ac neptune_v2_private.account;gross numeric;fee numeric;delta numeric;f jsonb;fid text;grossusd numeric;feeusd numeric;netusd numeric;rate numeric;applied numeric;fxcost numeric;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if neptune_v2_private.native_spec(a) is not null then return neptune_v2_private.execute_native_fill(obs,at_time,a,ord,qty,price);end if;
 if qty is null or price is null or qty<=0 or price<=0 or qty::text in ('NaN','Infinity','-Infinity') or price::text in ('NaN','Infinity','-Infinity') or at_time<=(ord->>'at')::timestamptz or ord->>'side' not in ('buy','sell') then raise exception 'Invalid later-observation fill';end if;
 grossusd:=round(qty*price,12);feeusd:=round(grossusd*.008,12);netusd:=case when ord->>'side'='buy' then -grossusd-feeusd else grossusd-feeusd end;
 rate:=neptune_v2_private.num(fx->>'rate');
 if ord->>'side'='buy' and rate is null then raise exception 'Entry FX required';end if;
 applied:=rate*case when ac.currency='USD' then 1 when ord->>'side'='buy' then 1.0025 else .9975 end;
 gross:=round(grossusd*rate,12);fee:=round(feeusd*rate,12);fxcost:=round(abs(netusd)*abs(applied-rate),12);delta:=round(netusd*applied,12);
 if ac.cash+coalesce(delta,0)<0 then raise exception 'Cash invariant';end if;
 fid:=md5('fill'||(ord->>'id'));f:=jsonb_build_object('id',fid,'order_id',ord->>'id','decision_id',ord->>'decision_id','observation_id',obs,'at',at_time,'asset',a,'side',ord->>'side','qty',qty,'price',price,'quote_currency','USD','gross_usd',grossusd,'fee_usd',feeusd,'net_usd',netusd,'settlement_status',case when rate is null then 'pending_conversion' else 'settled' end,'fx',rate,'fx_source',fx->>'source','fx_at',fx->>'at','fx_rate_date',fx->>'rate_date','fx_retrieved_at',fx->>'fetched_at','fx_applied_rate',applied,'fx_cost_base',fxcost,'gross_base',gross,'fee_base',fee,'cash_delta_base',delta,'slippage_pct',.25,'config_version','neptune-v2-experimental-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1));
 if exists(select 1 from neptune_v2_private.specialist_checkpoint) then f:=f||jsonb_build_object('venue','Kraken','market_type','spot','initial_risk_base',case when ord->>'side'='buy' then ord->'verified_risk_base' end,'specialist_id',neptune_v2_private.specialist_for_asset(a));end if;
 insert into neptune_v2_private.fills values(fid,ord->>'id',obs,at_time,delta,f);
 insert into neptune_v2_private.order_events values(md5('filled'||fid),ord->>'id',obs,at_time,'filled',jsonb_build_object('fill_id',fid,'decision_id',ord->>'decision_id'));
 if rate is not null then
 update neptune_v2_private.account set cash=cash+delta where id=ac.id;
 insert into neptune_v2_private.cash_ledger values(md5('cash'||fid),fid,at_time,delta,ac.cash+delta);
 else insert into neptune_v2_private.usd_ledger values(md5('usd'||fid),fid,at_time,netusd);end if;
 if exists(select 1 from neptune_v2_private.specialist_checkpoint) then perform neptune_v2_private.specialist_book_fill(fid);end if;
 return f;
end$$;
create function neptune_v2_private.process_scan(o jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ac neptune_v2_private.account;s jsonb;obs text;n timestamptz:=clock_timestamp();at_time timestamptz;fx jsonb;fxrate numeric;fxok boolean:=false;
 specialist_budget numeric;specialists boolean;native boolean;rules jsonb;quote_fx jsonb;ownedqty numeric;dustqty numeric;dustcost numeric;dustrisk numeric;native_result jsonb; a text;m jsonb;b jsonb;br jsonb;p jsonb;pending jsonb;d jsonb;ord jsonb;f jsonb;res jsonb;books jsonb:='{}';markets jsonb:='{}';equity numeric;mark numeric;marksok boolean:=true;quote_at timestamptz;scanok boolean:=true;
 countpos int;aggregate numeric;qty numeric;price numeric;debit numeric;risk numeric;reward numeric;unitdebit numeric;unitrisk numeric;stopprice numeric;target numeric;cost numeric;atr numeric;pnl numeric;trailing_flag boolean;nextstop numeric;
 reason text;data_reason text;newbar bigint;lastbar bigint;signals int:=0;activity boolean:=false;seen text[]:='{}';fill_count int;fees numeric;realized numeric;daykey text;status text;report jsonb;recent jsonb;sizebytes bigint;storedbytes bigint;totalqty numeric;nearbid numeric;nearask numeric;v jsonb;fxcosts numeric;receipt record;settle jsonb;usdamount numeric;settled numeric;unsettled numeric;reservebytes bigint;post_equity numeric;unitloss numeric;exitprice numeric;relationbytes bigint;evidence jsonb;evidence_markets jsonb:='[]';compact jsonb;h text;oldref jsonb;
begin
 perform neptune_v2_private.sync_control();
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not found then return jsonb_build_object('status','configuration_pending');end if;
 if not exists(select 1 from neptune_v2_private.build_metadata) then raise exception 'Reviewed source metadata required';end if;
 s:=ac.state;if not coalesce((s->>'enabled')::boolean,false) then return jsonb_build_object('status','stopped');end if;
 at_time:=neptune_v2_private.ts(o->>'at');
 if octet_length(o::text)>131072 or not neptune_v2_private.fresh(o->>'at',n,30) or jsonb_typeof(o->'markets') is distinct from 'array' or jsonb_array_length(o->'markets')>8 then raise exception 'Invalid observation envelope';end if;
 if at_time<=neptune_v2_private.ts(s->>'last_at') then return jsonb_build_object('duplicate',true);end if;
 select coalesce(sum(pg_total_relation_size(c.oid)),0) into relationbytes from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace where c.relkind in ('r','m') and (ns.nspname in ('neptune_v2_private','neptune_mv_private') or (ns.nspname='public' and c.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')));
 if relationbytes>=40*1024*1024 or (s?'test_expires_at' and n>neptune_v2_private.ts(s->>'test_expires_at')) then
 update neptune_v2_private.account set state=state||jsonb_build_object('enabled',false,'capacity_paused',true,'pause_reason','bounded_campaign_ended') where id=ac.id;
 perform neptune_v2_private.publish_terminal('capacity_paused','Bounded paper experiment ended; history retained and virtual exposure frozen');return jsonb_build_object('capacity',true);end if;
 reservebytes:=524288;
 if relationbytes+reservebytes>40*1024*1024 then update neptune_v2_private.account set state=state||jsonb_build_object('enabled',false,'capacity_paused',true,'pause_reason','audit_capacity_limit') where id=ac.id;perform neptune_v2_private.publish_terminal('capacity_paused','Audit capacity limit; history retained');return jsonb_build_object('capacity',true);end if;
 obs:=md5(o::text);
 if exists(select 1 from neptune_v2_private.observations where id=obs) then return jsonb_build_object('duplicate',true);end if;perform neptune_v2_private.native_scan_reconcile();
 for m in select value from jsonb_array_elements(o->'markets') loop
 a:=m->>'asset';if a is null or not (a=any(neptune_v2_private.universe())) or a=any(seen) then raise exception 'Invalid market universe';end if;
 seen:=array_append(seen,a);markets:=jsonb_set(markets,array[a],m);
 end loop;
 -- Compression retains full input evidence on change, otherwise a backward immutable reference.
 if not(s?'evidence_refs') then s:=s||jsonb_build_object('evidence_refs','{}'::jsonb);end if;
 foreach a in array neptune_v2_private.universe() loop
 m:=markets->a;if m is null then continue;end if;compact:=m;
 if not(s#>'{evidence_refs}'?a) then s:=jsonb_set(s,array['evidence_refs',a],'{}');end if;
 foreach reason in array array['bars','metadata'] loop
 if m?reason then
 h:=md5((m->reason)::text);oldref:=s#>array['evidence_refs',a,reason];
 if oldref->>'hash'=h and exists(select 1 from neptune_v2_private.observations z,jsonb_array_elements(z.payload->'markets') zmarket where z.id=oldref->>'observation_id' and z.at<at_time and zmarket->>'asset'=a and md5((zmarket->reason)::text)=h) then
 compact:=(compact-reason)||jsonb_build_object(reason||'_ref',oldref->>'observation_id',reason||'_hash',h);
 else
 compact:=compact||jsonb_build_object(reason||'_hash',h);s:=jsonb_set(s,array['evidence_refs',a,reason],jsonb_build_object('hash',h,'observation_id',obs));
 end if;end if;
 end loop;evidence_markets:=evidence_markets||jsonb_build_array(compact);
 end loop;
 evidence:=jsonb_set(o,'{markets}',evidence_markets);insert into neptune_v2_private.observations values(obs,at_time,evidence);
 if neptune_v2_private.ts(s->>'last_at')<at_time-interval '120 seconds' then
 for receipt in select key,value from jsonb_each(s->'pending') loop
 if receipt.value->>'side'='buy' then perform neptune_v2_private.decide(obs,at_time,receipt.key,'hold','restart_warmup_cancelled',null,receipt.value,'cancelled');s:=jsonb_set(s,'{pending}',(s->'pending')-receipt.key);end if;
 end loop;s:=jsonb_set(s,'{last_bar}','{}');end if;
 if ac.currency='USD' then fx:=jsonb_build_object('rate',1,'source','USD identity','at',at_time);fxok:=true;
 else fx:=o->'fx';fxrate:=neptune_v2_private.num(fx->>'rate');fxok:=coalesce(fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and fxrate between .25 and 5 and neptune_v2_private.fresh(fx->>'at',at_time,345600) and neptune_v2_private.fresh(fx->>'fetched_at',at_time,3600),false);end if;
 fxrate:=case when fxok then (fx->>'rate')::numeric end;quote_fx:=coalesce(o->'quote_fx','{}');
 fees:=(s->>'fees')::numeric;realized:=(s->>'realized')::numeric;fill_count:=(s->>'fill_count')::int;fxcosts:=coalesce((s->>'fx_costs')::numeric,0);
 -- Convert only previously executed USD proceeds at a later observed reference rate.
 if fxok then
 for receipt in select key,value from jsonb_each(coalesce(s->'receivables','{}')) loop
 usdamount:=(receipt.value->>'usd_amount')::numeric;settled:=round(usdamount*fxrate*case when ac.currency='AUD' then .9975 else 1 end,12);pnl:=settled-(receipt.value->>'cost_base')::numeric;
 settle:=jsonb_build_object('config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1),'id',md5('settlement'||receipt.key),'exit_fill_id',receipt.key,'at',at_time,'usd_amount',usdamount,'fx',fxrate,'fx_source',fx->>'source','fx_at',fx->>'at','fx_rate_date',fx->>'rate_date','fx_retrieved_at',fx->>'fetched_at','fx_applied_rate',fxrate*case when ac.currency='AUD' then .9975 else 1 end,'fx_cost_base',usdamount*fxrate-settled,'cash_delta_base',settled,'pnl_base',pnl);
 insert into neptune_v2_private.settlements values(settle->>'id',receipt.key,at_time,settle);
 ac.cash:=ac.cash+settled;update neptune_v2_private.account set cash=ac.cash where id=ac.id;
 insert into neptune_v2_private.cash_ledger values(md5('settlecash'||receipt.key),null,at_time,settled,ac.cash);
 insert into neptune_v2_private.usd_ledger values(md5('settleusd'||receipt.key),receipt.key,at_time,-usdamount);
 if exists(select 1 from neptune_v2_private.specialist_checkpoint) then perform neptune_v2_private.specialist_book_settlement(settle->>'id');end if;
 res:=jsonb_build_object('id',md5('settleresult'||receipt.key),'asset',receipt.value->>'asset','closed_at',receipt.value->>'closed_at','settled_at',at_time,'entry_fill_id',receipt.value->>'entry_fill_id','exit_fill_id',receipt.key,'pnl_base',pnl,'net_r',pnl/(receipt.value->>'initial_risk_base')::numeric,'status','settled');
 insert into neptune_v2_private.results values(res->>'id',receipt.key,at_time,res);
 realized:=realized+pnl;fees:=fees+(receipt.value->>'fee_usd')::numeric*fxrate;fxcosts:=fxcosts+usdamount*fxrate-settled;activity:=true;
 s:=jsonb_set(s,'{receivables}',(s->'receivables')-receipt.key);
 end loop;end if;
 for receipt in select r.exit_fill_id from neptune_v2_private.native_receivables r where not exists(select 1 from neptune_v2_private.native_settlement_attribution z where z.exit_fill_id=r.exit_fill_id) order by r.exit_fill_id loop
 native_result:=neptune_v2_private.native_settle(receipt.exit_fill_id,obs);if native_result is not null and not coalesce((native_result->>'replay')::boolean,false) then realized:=realized+coalesce((native_result->>'pnl_base')::numeric,0);fees:=fees+coalesce((native_result->>'fee_base')::numeric,0);fxcosts:=fxcosts+coalesce((native_result->>'fx_cost_base')::numeric,0);end if;end loop;
 select cash into ac.cash from neptune_v2_private.account where id=ac.id;
 equity:=ac.cash;marksok:=fxok and neptune_v2_private.native_pending_count()=0;
 foreach a in array neptune_v2_private.universe() loop b:=neptune_v2_private.book(markets->a,at_time);if neptune_v2_private.native_rule_conflict(a,(markets->a)->'metadata',at_time) then b:=jsonb_build_object('error','native_rules_changed_requires_review');end if;books:=jsonb_set(books,array[a],b);end loop;
 for p in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 loop
 a:=p->>'asset';b:=books->a;price:=case when b?'error' then null else neptune_v2_private.instrument_depth(a,b->'bids',(p->>'qty')::numeric,'sell',coalesce(p->'verified_entry_rules',p)) end;
 if price is null or not fxok or neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,price,'sell',coalesce(p->'verified_entry_rules',p),case when fxok then fx end,quote_fx,at_time) is null then marksok:=false;else equity:=equity+neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,price,'sell',coalesce(p->'verified_entry_rules',p),case when fxok then fx end,quote_fx,at_time);end if;
 end loop;
 if not marksok then equity:=null;end if;
 daykey:=to_char(at_time at time zone 'UTC','YYYY-MM-DD');
 if equity is not null then
 if s->>'day' is distinct from daykey then s:=s||jsonb_build_object('day',daykey,'day_equity',equity);end if;
 s:=s||jsonb_build_object('peak_equity',greatest((s->>'peak_equity')::numeric,equity));
 if equity<=(s->>'day_equity')::numeric*.98 or equity<=(s->>'peak_equity')::numeric*.95 then s:=s||jsonb_build_object('risk_paused',true,'pause_reason','drawdown_limit');end if;
 end if;
 if relationbytes>=32*1024*1024 then s:=s||jsonb_build_object('risk_paused',true,'pause_reason','storage_entry_limit');end if;
 -- Protective decisions/executions first. No candle, volume, spread or metadata dependency.
 for p in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 order by asset loop
 a:=p->>'asset';b:=books->a;pending:=s#>array['pending',a];
 if b?'error' then perform neptune_v2_private.decide(obs,at_time,a,'hold',b->>'error',b,p,'blocked');continue;end if;
 if pending->>'side'='sell' and at_time>(pending->>'at')::timestamptz and (b->>'at')::timestamptz>(pending->>'at')::timestamptz then
 price:=neptune_v2_private.instrument_depth(a,b->'bids',(p->>'qty')::numeric,'sell',coalesce(p->'verified_entry_rules',p));
 if price is null then perform neptune_v2_private.decide(obs,at_time,a,'hold','insufficient_exit_depth',b,p,'blocked');continue;end if;
 native:=neptune_v2_private.native_spec(a) is not null;qty:=(p->>'qty')::numeric;if native then qty:=floor(qty/(p#>>'{verified_entry_rules,qty_step}')::numeric)*(p#>>'{verified_entry_rules,qty_step}')::numeric;end if;
 if native and not neptune_v2_private.native_order_rules(a,'sell',qty,neptune_v2_private.native_limit_price(a,b->'bids',qty,'sell',p->'verified_entry_rules'),p->'verified_entry_rules',(markets->a)->'avg_price',at_time) then perform neptune_v2_private.decide(obs,at_time,a,'hold','native_protective_rule_gate',b,p,'blocked');continue;end if;
 f:=neptune_v2_private.execute_fill(obs,at_time,a,pending,qty,price,case when fxok then fx else null end);pnl:=case when native then (f#>>'{accounting,pnl_base}')::numeric else (f->>'cash_delta_base')::numeric-(p->>'cost_base')::numeric end;
 realized:=realized+coalesce(pnl,0);fees:=fees+coalesce((f->>'fee_base')::numeric,0);fxcosts:=fxcosts+coalesce((f->>'fx_cost_base')::numeric,0);fill_count:=fill_count+1;activity:=true;
 if not native and not fxok then s:=jsonb_set(s,array['receivables',f->>'id'],jsonb_build_object('usd_amount',f->'net_usd','fee_usd',f->'fee_usd','asset',a,'closed_at',at_time,'cost_base',p->'cost_base','initial_risk_base',p->'initial_risk_base','entry_fill_id',p->'entry_fill_id'));end if;
 res:=jsonb_build_object('id',md5('result'||(f->>'id')),'asset',a,'closed_at',at_time,'entry_fill_id',p->>'entry_fill_id','exit_fill_id',f->>'id','pnl_base',pnl,'net_r',pnl/(p->>'initial_risk_base')::numeric,'status',case when fxok then 'settled' else 'pending_conversion' end);
 if not native then insert into neptune_v2_private.results values(res->>'id',f->>'id',at_time,res);end if;
 update neptune_v2_private.positions set payload=payload||jsonb_build_object('qty',0,'closed_at',at_time) where asset=a;
 s:=jsonb_set(s,'{pending}',(s->'pending')-a);s:=jsonb_set(s,array['last_exit',a],to_jsonb(at_time));
 perform neptune_v2_private.decide(obs,at_time,a,'sell',pending->>'reason',b,p,'filled');continue;
 end if;
 if (b->>'bid')::numeric<=(p->>'stop')::numeric or ((b->>'bid')::numeric>=(p->>'target')::numeric and (neptune_v2_private.native_spec(a) is null or neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,neptune_v2_private.instrument_depth(a,b->'bids',(p->>'qty')::numeric,'sell',p->'verified_entry_rules'),'sell',p->'verified_entry_rules',case when fxok then fx end,quote_fx,at_time)-(p->>'cost_base')::numeric>=2*(p->>'initial_risk_base')::numeric)) then
 if pending is null then
 reason:=case when (b->>'bid')::numeric<=(p->>'stop')::numeric then 'protective_stop' else 'net_r_target' end;
 d:=neptune_v2_private.decide(obs,at_time,a,'sell',reason,b,p,'pending');ord:=neptune_v2_private.make_order(d,'{}');s:=jsonb_set(s,array['pending',a],ord);activity:=true;
 end if;continue;end if;
 br:=neptune_v2_private.bars(markets->a,at_time);price:=neptune_v2_private.instrument_depth(a,b->'bids',(p->>'qty')::numeric,'sell',coalesce(p->'verified_entry_rules',p));
 trailing_flag:=coalesce((p->>'trailing_active')::boolean,false) or coalesce((neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,price,'sell',coalesce(p->'verified_entry_rules',p),case when fxok then fx end,quote_fx,at_time)-(p->>'cost_base')::numeric>=(p->>'initial_risk_base')::numeric),false);
 p:=p||jsonb_build_object('trailing_active',trailing_flag);
 if trailing_flag and not (br?'error') then
 nextstop:=greatest((p->>'stop')::numeric,(b->>'bid')::numeric-2*(br->>'atr')::numeric);
 if nextstop>(p->>'stop')::numeric then p:=p||jsonb_build_object('stop',nextstop);perform neptune_v2_private.decide(obs,at_time,a,'hold','trailing_stop_raised',b,p,'trailing_updated');activity:=true;
 else perform neptune_v2_private.decide(obs,at_time,a,'hold','position_within_plan',b,p);end if;
 else perform neptune_v2_private.decide(obs,at_time,a,'hold',coalesce(br->>'error','position_within_plan'),b,p);end if;
 update neptune_v2_private.positions set payload=p where asset=a;
 end loop;
 perform neptune_v2_private.native_scan_reconcile();
 specialists:=exists(select 1 from neptune_v2_private.specialist_checkpoint);
 -- All buy intents are nonbinding; no cash is reserved. Later fills resize under this same account lock.
 foreach a in array neptune_v2_private.universe() loop
 m:=markets->a;b:=books->a;br:=neptune_v2_private.bars(m,at_time);pending:=s#>array['pending',a];p:=null;native:=neptune_v2_private.native_spec(a) is not null;rules:=m->'metadata';dustqty:=0;dustcost:=0;dustrisk:=0;
 -- Disabled venues cannot create intents or fills and do not make the active scan incomplete.
 -- The preceding protective-exit loop is intentionally untouched.
 if native and not coalesce((neptune_v2_private.native_activation_policy()->'native_entry_venues')?(neptune_v2_private.native_spec(a)->>'venue'),false) then
 if pending->>'side'='buy' then s:=jsonb_set(s,'{pending}',(s->'pending')-a);end if;
 perform neptune_v2_private.decide(obs,at_time,a,'hold','venue_disabled_by_owner',b,pending,case when pending->>'side'='buy' then 'cancelled' else 'blocked' end);continue;end if;
 if native then select coalesce(i.qty,0),coalesce(i.cost_base,0),coalesce(i.risk_base,0) into dustqty,dustcost,dustrisk from neptune_v2_private.native_inventory i where i.asset=a;dustqty:=coalesce(dustqty,0);dustcost:=coalesce(dustcost,0);dustrisk:=coalesce(dustrisk,0);end if;
 if specialists and neptune_v2_private.specialist_for_asset(a) is null then
 s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold','unsupported_specialist_market',b,pending,case when pending is null then 'blocked' else 'cancelled' end);continue;end if;
 select payload into p from neptune_v2_private.positions where neptune_v2_private.canonical_exposure(asset)=neptune_v2_private.canonical_exposure(a) and (payload->>'qty')::numeric>0;
 if p is null and exists(select 1 from neptune_v2_private.native_inventory i where i.qty>0 and i.asset<>a and i.canonical_exposure=neptune_v2_private.canonical_exposure(a)) then perform neptune_v2_private.decide(obs,at_time,a,'hold','blocked_duplicate_canonical_dust',b,pending,'blocked');continue;end if;
 -- Data health determines scan completeness; valid eligibility failures only reject entries.
 data_reason:=case when native and (m->>'protective_only'='true' or m->>'metadata_stale'='true' or o#>>'{native_feed,feed_terminal}'='true') then 'native_feed_protective_only' when not fxok then 'missing_or_stale_fx' when b?'error' then b->>'error' when not neptune_v2_private.instrument_metadata_ok(m,a,at_time) then 'missing_or_stale_metadata' when br?'error' then br->>'error' when neptune_v2_private.instrument_volume_reference(m,a,quote_fx,at_time) is null then 'missing_volume' when neptune_v2_private.ts(m->>'trade_at') is null or neptune_v2_private.ts(m->>'trade_at')>at_time then 'missing_or_malformed_trade' when not neptune_v2_private.fresh(m->>'trade_at',at_time,60) then 'stale_last_trade' end;
 reason:=coalesce(data_reason,case when (b->>'spread')::numeric>.003 then 'spread_too_wide' when neptune_v2_private.instrument_volume_reference(m,a,quote_fx,at_time)<1000000 then 'volume_below_threshold' end);
 if reason is null then
 select coalesce(sum((value->>0)::numeric*(value->>1)::numeric),0) into nearbid from jsonb_array_elements(b->'bids') where (value->>0)::numeric>=(b->>'bid')::numeric*.9975;
 select coalesce(sum((value->>0)::numeric*(value->>1)::numeric),0) into nearask from jsonb_array_elements(b->'asks') where (value->>0)::numeric<=(b->>'ask')::numeric*1.0025;
 if neptune_v2_private.instrument_quote_reference(a,least(nearbid,nearask),quote_fx,at_time) is null or neptune_v2_private.instrument_quote_reference(a,least(nearbid,nearask),quote_fx,at_time)<10000 then reason:='insufficient_near_depth';end if;end if;
 if data_reason is not null then scanok:=false;end if;
 if p is not null then if p->>'asset'<>a then perform neptune_v2_private.decide(obs,at_time,a,'hold','blocked_duplicate_canonical_exposure',b,pending,'blocked');end if;continue;end if;
 if reason is not null then
 if pending is not null then s:=jsonb_set(s,'{pending}',(s->'pending')-a);end if;
 perform neptune_v2_private.decide(obs,at_time,a,'hold',reason,b,pending,case when pending is not null then 'cancelled' when data_reason is not null then 'blocked' else 'no_trade' end);continue;end if;
 if coalesce((s->>'risk_paused')::boolean,false) or relationbytes>=32*1024*1024 or s->>'entry_capacity_paused'='true' or o#>>'{native_feed,entry_capacity_paused}'='true' or equity is null then s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold',case when relationbytes>=32*1024*1024 or s->>'entry_capacity_paused'='true' or o#>>'{native_feed,entry_capacity_paused}'='true' then 'audit_capacity_entry_pause' else coalesce(s->>'pause_reason','stale_account_mark') end,b,pending,case when pending is null then 'blocked' else 'cancelled' end);continue;end if;
 if exists(select 1 from jsonb_each_text(s->'last_exit') x where neptune_v2_private.canonical_exposure(x.key)=neptune_v2_private.canonical_exposure(a) and neptune_v2_private.ts(x.value)>at_time-interval '15 minutes') then s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold','post_exit_cooldown',b,pending,case when pending is null then 'no_trade' else 'cancelled' end);continue;end if;
 newbar:=(br#>>'{last,t}')::bigint;lastbar:=(s#>>array['last_bar',a])::bigint;
 if lastbar is null then s:=jsonb_set(s,array['last_bar',a],to_jsonb(newbar));perform neptune_v2_private.decide(obs,at_time,a,'hold','warmup_no_historical_replay',b,null);continue;end if;
 if pending->>'side'='buy' then
 if at_time>(pending->>'at')::timestamptz+interval '120 seconds' or (b->>'bid')::numeric<=(pending->>'stop')::numeric or (b->>'ask')::numeric>=(pending->>'target')::numeric then s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold','entry_expired_or_invalidated',b,pending,'cancelled');continue;end if;
 if at_time<=(pending->>'at')::timestamptz or (b->>'at')::timestamptz<=(pending->>'at')::timestamptz then perform neptune_v2_private.decide(obs,at_time,a,'hold','awaiting_later_observation',b,pending);continue;end if;
 select count(*),coalesce(sum((payload->>'initial_risk_base')::numeric),0) into countpos,aggregate from neptune_v2_private.positions where (payload->>'qty')::numeric>0;aggregate:=aggregate+neptune_v2_private.native_dust_cost();
 select cash into ac.cash from neptune_v2_private.account where id=ac.id;
 equity:=ac.cash;
 for v in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 loop
 price:=neptune_v2_private.instrument_depth(v->>'asset',(books->(v->>'asset'))->'bids',(v->>'qty')::numeric,'sell',coalesce(v->'verified_entry_rules',v));
 if price is null then equity:=null;exit;end if;
 equity:=equity+neptune_v2_private.instrument_value(v->>'asset',(v->>'qty')::numeric,price,'sell',coalesce(v->'verified_entry_rules',v),fx,quote_fx,at_time);
 end loop;
 if equity is null then s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold','stale_account_mark',b,pending,'cancelled');continue;end if;
 unitdebit:=(ceil((b->>'ask')::numeric*1.0025/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*1.008*fxrate*case when ac.currency='AUD' then 1.0025 else 1 end;unitrisk:=unitdebit-(floor((pending->>'stop')::numeric*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*fxrate*case when ac.currency='AUD' then .9975 else 1 end;
 unitloss:=greatest(0,unitdebit-(floor((b->>'bid')::numeric*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*fxrate*case when ac.currency='AUD' then .9975 else 1 end);
 if native then unitdebit:=neptune_v2_private.instrument_value(a,1,neptune_v2_private.instrument_depth(a,b->'asks',1,'buy',rules),'buy',rules,fx,quote_fx,at_time);ownedqty:=neptune_v2_private.net_owned_after_fee(a,1,rules);unitrisk:=unitdebit-neptune_v2_private.instrument_value(a,ownedqty,(pending->>'stop')::numeric*.9975,'sell',rules,fx,quote_fx,at_time);unitloss:=greatest(0,unitdebit-neptune_v2_private.instrument_value(a,ownedqty,neptune_v2_private.instrument_depth(a,b->'bids',ownedqty,'sell',rules),'sell',rules,fx,quote_fx,at_time));end if;
 qty:=case when unitrisk>0 then least(equity*.0025/(unitrisk+.0025*unitloss),equity*.1/(unitdebit+.1*unitloss),ac.cash/unitdebit,greatest(0,equity*.0075-aggregate)/(unitrisk+.0075*unitloss)) else 0 end;
 specialist_budget:=case when specialists then neptune_v2_private.specialist_entry_budget(a) else equity end;
 if specialists then qty:=least(qty,specialist_budget*.0025/(unitrisk+.0025*unitloss),specialist_budget*.1/(unitdebit+.1*unitloss));end if;
 qty:=floor(qty*power(10,neptune_v2_private.num(m#>>'{metadata,qty_decimals}')::int))/power(10,neptune_v2_private.num(m#>>'{metadata,qty_decimals}')::int);
 price:=neptune_v2_private.depth_price(b->'asks',qty,'buy',neptune_v2_private.num(m#>>'{metadata,tick_size}'));debit:=qty*price*1.008*fxrate*case when ac.currency='AUD' then 1.0025 else 1 end;risk:=debit-qty*(floor((pending->>'stop')::numeric*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*fxrate*case when ac.currency='AUD' then .9975 else 1 end;reward:=qty*(floor((pending->>'target')::numeric*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*fxrate*case when ac.currency='AUD' then .9975 else 1 end-debit;
 exitprice:=neptune_v2_private.depth_price(b->'bids',qty,'sell',neptune_v2_private.num(m#>>'{metadata,tick_size}'));post_equity:=equity-debit+qty*exitprice*.992*fxrate*case when ac.currency='AUD' then .9975 else 1 end;
 if native then qty:=least(qty,neptune_v2_private.native_size(specialist_budget,unitdebit,unitrisk,unitloss,rules,dustcost));qty:=floor(qty/(rules->>'qty_step')::numeric)*(rules->>'qty_step')::numeric;price:=neptune_v2_private.instrument_depth(a,b->'asks',qty,'buy',rules);debit:=neptune_v2_private.instrument_value(a,qty,price,'buy',rules,fx,quote_fx,at_time);ownedqty:=neptune_v2_private.net_owned_after_fee(a,qty,rules)+dustqty;risk:=debit+dustcost-neptune_v2_private.instrument_value(a,ownedqty,(pending->>'stop')::numeric*.9975,'sell',rules,fx,quote_fx,at_time);reward:=neptune_v2_private.instrument_value(a,ownedqty,(pending->>'target')::numeric*.9975,'sell',rules,fx,quote_fx,at_time)-debit-dustcost;exitprice:=neptune_v2_private.instrument_depth(a,b->'bids',ownedqty,'sell',rules);post_equity:=equity-debit+neptune_v2_private.instrument_value(a,ownedqty,exitprice,'sell',rules,fx,quote_fx,at_time);end if;
 if countpos>=3 or specialist_budget is null or (specialists and (debit+dustcost>greatest(0,specialist_budget-(equity-post_equity))*.1 or risk>greatest(0,specialist_budget-(equity-post_equity))*.0025)) or debit is null or risk is null or reward is null or price is null or exitprice is null or post_equity is null or qty<(m#>>'{metadata,min_qty}')::numeric or qty*price<(m#>>'{metadata,min_cost}')::numeric or debit>ac.cash or debit>post_equity*.1 or risk>post_equity*.0025 or aggregate+risk>post_equity*.0075 or reward<2*risk or risk<=0 then
 s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'hold','entry_risk_cost_or_depth_gate',b,pending,'cancelled');continue;end if;
 if native and (neptune_v2_private.native_conversion_consumed(obs,neptune_v2_private.instrument_currency(a),'buy') or not neptune_v2_private.native_order_rules(a,'buy',qty,neptune_v2_private.native_limit_price(a,b->'asks',qty,'buy',rules),rules,m->'avg_price',at_time)) then perform neptune_v2_private.decide(obs,at_time,a,'hold','native_order_rules_or_conversion_slot',b,pending,'blocked');continue;end if;
 f:=neptune_v2_private.execute_fill(obs,at_time,a,pending||jsonb_build_object('verified_risk_base',case when native then risk-dustrisk else risk end),qty,price,fx);fees:=fees+(f->>'fee_base')::numeric;fxcosts:=fxcosts+(f->>'fx_cost_base')::numeric;fill_count:=fill_count+1;activity:=true;
 p:=jsonb_build_object('asset',a,'quote_currency','USD','qty',qty,'entry_price',price,'tick_size',neptune_v2_private.num(m#>>'{metadata,tick_size}'),'entry_fx',fxrate,'cost_base',-(f->>'cash_delta_base')::numeric,'stop',pending->'stop','target',pending->'target','invalidation',pending->'invalidation','initial_risk_base',risk,'entry_equity_base',post_equity,'trailing_active',false,'last_bid',b->'bid','quote_at',b->'at','opened_at',at_time,'entry_fill_id',f->>'id');
 if native then p:=p||jsonb_build_object('qty',f#>'{accounting,qty_remaining}','cost_base',f#>'{accounting,cost_remaining}','initial_risk_base',f#>'{accounting,risk_remaining}','verified_entry_rules',rules,'quote_currency',neptune_v2_private.instrument_currency(a),'venue',neptune_v2_private.native_spec(a)->>'venue');end if;
 insert into neptune_v2_private.positions values(a,p) on conflict(asset) do update set payload=excluded.payload;
 s:=jsonb_set(s,'{pending}',(s->'pending')-a);perform neptune_v2_private.decide(obs,at_time,a,'buy','later_observation_entry',b,p,'filled');continue;
 end if;
 if newbar<=lastbar then perform neptune_v2_private.decide(obs,at_time,a,'hold','no_new_completed_bar',b,null);continue;end if;
 s:=jsonb_set(s,array['last_bar',a],to_jsonb(newbar));atr:=(br->>'atr')::numeric;
 stopprice:=least((br#>>'{last,c}')::numeric-2*atr,(br->>'structural')::numeric);
 unitdebit:=(ceil((b->>'ask')::numeric*1.0025/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*1.008*case when ac.currency='AUD' then 1.0025 else 1 end;unitrisk:=unitdebit-(floor(stopprice*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*case when ac.currency='AUD' then .9975 else 1 end;target:=(ceil(((unitdebit+2*unitrisk)/(.992*case when ac.currency='AUD' then .9975 else 1 end))/neptune_v2_private.num(m#>>'{metadata,tick_size}'))+1)*neptune_v2_private.num(m#>>'{metadata,tick_size}')/.9975;cost:=unitdebit-(floor((b->>'bid')::numeric*.9975/neptune_v2_private.num(m#>>'{metadata,tick_size}'))*neptune_v2_private.num(m#>>'{metadata,tick_size}'))*.992*case when ac.currency='AUD' then .9975 else 1 end;
 if native then unitdebit:=neptune_v2_private.instrument_value(a,1,neptune_v2_private.instrument_depth(a,b->'asks',1,'buy',rules),'buy',rules,fx,quote_fx,at_time);ownedqty:=neptune_v2_private.net_owned_after_fee(a,1,rules);unitrisk:=unitdebit-neptune_v2_private.instrument_value(a,ownedqty,stopprice*.9975,'sell',rules,fx,quote_fx,at_time);unitloss:=greatest(0,unitdebit-neptune_v2_private.instrument_value(a,ownedqty,neptune_v2_private.instrument_depth(a,b->'bids',ownedqty,'sell',rules),'sell',rules,fx,quote_fx,at_time));qty:=neptune_v2_private.native_size(neptune_v2_private.specialist_entry_budget(a),unitdebit,unitrisk,unitloss,rules,dustcost);target:=neptune_v2_private.native_target(a,b,stopprice,rules,fx,quote_fx,at_time,qty);cost:=(unitdebit-neptune_v2_private.instrument_value(a,ownedqty,neptune_v2_private.instrument_depth(a,b->'bids',ownedqty,'sell',rules),'sell',rules,fx,quote_fx,at_time))/unitdebit*(b->>'ask')::numeric;end if;
 if (br#>>'{last,c}')::numeric>(br->>'breakout')::numeric and (br#>>'{last,v}')::numeric>=1.2*(br->>'mean_volume')::numeric and stopprice>0 and stopprice<(b->>'bid')::numeric and atr>=cost and target-(br#>>'{last,c}')::numeric<=6*atr then
 p:=jsonb_build_object('stop',stopprice,'target',target,'invalidation',stopprice,'initial_risk_base',equity*.0025);d:=neptune_v2_private.decide(obs,at_time,a,'buy','completed_15m_momentum',b,p,'pending');ord:=neptune_v2_private.make_order(d,p);s:=jsonb_set(s,array['pending',a],ord);signals:=signals+1;
 else perform neptune_v2_private.decide(obs,at_time,a,'hold','no_qualified_momentum',b,null);end if;
 end loop;
 select cash into ac.cash from neptune_v2_private.account where id=ac.id;
 mark:=ac.cash;marksok:=fxok and neptune_v2_private.native_pending_count()=0;quote_at:=null;cost:=neptune_v2_private.native_dust_cost();
 for p in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 loop
 a:=p->>'asset';b:=books->a;price:=case when b?'error' then null else neptune_v2_private.instrument_depth(a,b->'bids',(p->>'qty')::numeric,'sell',coalesce(p->'verified_entry_rules',p)) end;
 cost:=cost+(p->>'cost_base')::numeric;
 if price is null or not fxok or neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,price,'sell',coalesce(p->'verified_entry_rules',p),case when fxok then fx end,quote_fx,at_time) is null then marksok:=false;else mark:=mark+neptune_v2_private.instrument_value(a,(p->>'qty')::numeric,price,'sell',coalesce(p->'verified_entry_rules',p),case when fxok then fx end,quote_fx,at_time);quote_at:=least(quote_at,(b->>'at')::timestamptz);update neptune_v2_private.positions set payload=payload||jsonb_build_object('last_bid',b->'bid','quote_at',b->'at') where asset=a;end if;
 end loop;
 if quote_at is null then select min(neptune_v2_private.ts(value->>'at')) into quote_at from jsonb_each(books) where not (value?'error');end if;
 if not marksok then mark:=null;quote_at:=null;scanok:=false;end if;
 if abs(ac.cash-(select sum(delta) from neptune_v2_private.cash_ledger))>.00000001 then raise exception 'Cash ledger mismatch';end if;
 sizebytes:=octet_length(evidence::text)+coalesce((select sum(octet_length(payload::text)) from neptune_v2_private.decisions where observation_id=obs),0)+coalesce((select sum(octet_length(payload::text)) from neptune_v2_private.orders where observation_id=obs),0)+coalesce((select sum(octet_length(payload::text)) from neptune_v2_private.fills where observation_id=obs),0)+4096;
 storedbytes:=coalesce((s->>'stored_bytes')::bigint,0)+sizebytes;
 -- Estimated cumulative bytes are telemetry; admission uses measured own relations plus512KiB reserve.
 s:=s||jsonb_build_object('last_at',at_time,'realized',realized,'fees',fees,'fx_costs',fxcosts,'fill_count',fill_count,'stored_bytes',storedbytes,'relation_bytes',relationbytes);
 update neptune_v2_private.account set state=s,revision=revision+1,observations=observations+1 where id=ac.id;
 status:=case when coalesce((s->>'risk_paused')::boolean,false) then 'risk_paused' when not marksok then 'data_missing' when not scanok and exists(select 1 from neptune_v2_private.decisions where observation_id=obs and payload->>'reason' like '%missing%') then 'data_missing' when not scanok then 'data_stale' else 'running' end;
 report:=jsonb_build_object('history_seq',(select coalesce(max(seq),0) from public.neptune_paper_v2_history),'config_version','neptune-v2-experimental-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1),'version',2,'mode','PAPER','experimental',true,'historically_validated',false,'confidence','unvalidated','account_id',ac.id,'currency',ac.currency,'status',status,'heartbeat_at',at_time,'scan_at',case when scanok then at_time end,'quote_at',quote_at,'scan_complete',scanok,'message',case when scanok and signals=0 and not activity and s->'pending'='{}'::jsonb and status='running' then 'Nothing to report' when status='running' then 'Paper decisions recorded' else replace(status,'_',' ') end,
 'account',jsonb_build_object('initial_cash',10000,'cash',ac.cash,'reserved_cash',0,'available_cash',ac.cash,'equity',mark,'realized_pnl',realized,'unrealized_pnl',mark-ac.cash-cost,'fees',fees,'fx_costs',fxcosts,'unsettled_usd',coalesce((select sum(delta) from neptune_v2_private.usd_ledger),0),'fills',fill_count,'valuation_at',case when marksok then at_time end,'fx',fxrate,'fx_applied_rate',fxrate*case when ac.currency='AUD' then .9975 else 1 end,'fx_rate_date',case when fxok then fx->>'rate_date' end,'fx_retrieved_at',case when fxok then fx->>'fetched_at' end,'fx_at',case when fxok then fx->>'at' end,'fx_source',case when fxok then fx->>'source' end),
 'risk',jsonb_build_object('per_entry_pct',.25,'max_notional_pct',10,'max_positions',3,'aggregate_pct',.75,'daily_drawdown_pct',2,'total_drawdown_pct',5,'entry_paused',coalesce((s->>'risk_paused')::boolean,false) or relationbytes>=32*1024*1024 or coalesce((s->>'entry_capacity_paused')::boolean,false) or coalesce((o#>>'{native_feed,entry_capacity_paused}')::boolean,false),'pause_reason',case when relationbytes>=32*1024*1024 or s->>'entry_capacity_paused'='true' or o#>>'{native_feed,entry_capacity_paused}'='true' then 'audit_capacity_entry_pause' else s->>'pause_reason' end,'day_timezone','UTC','day_equity',s->'day_equity','peak_equity',s->'peak_equity'),
 'cost_model',jsonb_build_object('fee_per_side_pct',.8,'slippage_per_side_pct',.25,'actual_fee_tier',false,'fx_adverse_per_side_pct',.25,'fx_model','ECB reference-rate synthetic AUD accounting'),'universe',(select jsonb_agg(universe_asset) from unnest(neptune_v2_private.universe()) as u(universe_asset) where neptune_v2_private.native_spec(universe_asset) is null),'positions',coalesce((select jsonb_agg(payload order by asset) from neptune_v2_private.positions where (payload->>'qty')::numeric>0 and neptune_v2_private.native_spec(asset) is null),'[]'));
 foreach a in array array['decisions','fills','results','settlements'] loop execute format('select coalesce(jsonb_agg(payload order by at desc,id desc),''[]''::jsonb) from (select * from neptune_v2_private.%I where neptune_v2_private.native_spec(payload->>''asset'') is null order by at desc,id desc limit 50) r',a) into recent;report:=report||jsonb_build_object(a,recent);end loop;
 perform neptune_v2_private.native_scan_reconcile();
 report:=report||jsonb_build_object('native_feed',o->'native_feed');report:=neptune_v2_private.native_public_projection(report,books,fx,quote_fx,at_time);report:=report||jsonb_build_object('native_feed',o->'native_feed','entry_routing',jsonb_build_object('policy','fixed_priority_with_canonical_exclusion','cheapest_venue_claim',false));report:=report||jsonb_build_object('daily_performance',neptune_v2_private.perth_daily_performance(report));
 insert into public.neptune_paper_v2_status values(ac.id,report,at_time) on conflict(id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
 perform neptune_v2_private.publish_control_ack();
 select payload into report from public.neptune_paper_v2_status where id=ac.id;return report;
end$$;
create function neptune_v2_private.publish_terminal(status text,message text) returns void language plpgsql security invoker set search_path='' as $$declare projected_at timestamptz:=clock_timestamp();begin
 update public.neptune_paper_v2_status set payload=payload||jsonb_build_object('status',status,'message',message,'scan_complete',false,'heartbeat_at',clock_timestamp(),'history_seq',(select coalesce(max(seq),0) from public.neptune_paper_v2_history),'risk',(payload->'risk')||jsonb_build_object('entry_paused',true,'pause_reason',coalesce((select state->>'pause_reason' from neptune_v2_private.account where id='neptune-paper-v2'),status))),updated_at=clock_timestamp() where id='neptune-paper-v2';
 update public.neptune_paper_v2_status set payload=neptune_v2_private.native_public_projection(jsonb_set(payload,'{account,valuation_at}','null'),'{}',null,'{}',projected_at) where id='neptune-paper-v2';update public.neptune_paper_v2_status set payload=payload||jsonb_build_object('daily_performance',neptune_v2_private.perth_daily_performance(payload)) where id='neptune-paper-v2';
end$$;
-- Administrative helper only: not a client RPC and never called by deployment installation.
create function neptune_v2_private.set_enabled(desired boolean) returns void language plpgsql security invoker set search_path='' as $$
declare ac neptune_v2_private.account;s jsonb;r record;n timestamptz:=clock_timestamp();
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not found then raise exception 'Account not initialized';end if;
 if desired is null then raise exception 'Explicit control value required';end if;
 s:=ac.state;if desired and coalesce((s->>'capacity_paused')::boolean,false) then raise exception 'Terminal campaign cannot resume';end if;
 for r in select key,value from jsonb_each(s->'pending') loop
 if r.value->>'side'='buy' then perform neptune_v2_private.decide(r.value->>'observation_id',n,r.key,'hold','control_cancelled_entry',null,r.value,'cancelled');s:=jsonb_set(s,'{pending}',(s->'pending')-r.key);end if;
 end loop;
 s:=s||jsonb_build_object('enabled',desired,'last_bar','{}'::jsonb);
 if desired and not(s?'activated_at') then s:=s||jsonb_build_object('activated_at',n,'started_at',n);end if;
 update neptune_v2_private.account set state=s where id=ac.id;
 perform neptune_v2_private.publish_terminal(case when desired then 'warming_up' else 'stopped' end,case when desired then 'Awaiting a fresh complete paper scan' else 'Paper engine stopped; virtual positions frozen' end);
end$$;
create function neptune_v2_private.resolve_observation(obs_id text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare original neptune_v2_private.observations;m jsonb;a text;k text;ref neptune_v2_private.observations;material jsonb;arr jsonb:='[]';out jsonb;
begin
 select * into original from neptune_v2_private.observations where id=obs_id;if not found then raise exception 'Observation absent';end if;
 for m in select value from jsonb_array_elements(original.payload->'markets') loop
 a:=m->>'asset';
 foreach k in array array['bars','metadata'] loop
 if m?(k||'_ref') then
 select * into ref from neptune_v2_private.observations where id=m->>(k||'_ref') and at<original.at;
 if not found then raise exception 'Invalid forward or missing evidence reference';end if;
 select value->k into material from jsonb_array_elements(ref.payload->'markets') where value->>'asset'=a;
 if material is null or md5(material::text) is distinct from m->>(k||'_hash') then raise exception 'Evidence content hash mismatch';end if;
 m:=m||jsonb_build_object(k,material);
 elsif m?k and md5((m->k)::text) is distinct from m->>(k||'_hash') then raise exception 'Evidence content hash mismatch';end if;
 m:=m-(k||'_ref')-(k||'_hash');
 end loop;arr:=arr||jsonb_build_array(m);
 end loop;out:=jsonb_set(original.payload,'{markets}',arr);
 if md5(out::text) is distinct from obs_id then raise exception 'Reconstructed observation hash mismatch';end if;return out;
end$$;
-- Functions/tables never accept client calls. Direct Supabase defaults must be revoked explicitly too.
revoke all on all tables in schema neptune_v2_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_v2_private from public,anon,authenticated,service_role;
revoke all on schema neptune_v2_private from public,anon,authenticated,service_role;
revoke all on public.neptune_paper_v2_status from public,anon,authenticated,service_role;
