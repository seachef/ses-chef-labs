-- Reviewed additive native paper upgrade. No activation, reallocation, reset or cron changes.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
select id from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
select id from neptune_v2_private.account where id='neptune-paper-v2' for update;
do $$declare ac neptune_v2_private.account;begin
 if (select source_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '1e1907c0fca5ffcd54a2f25e957b081be4815e097dbbbaf9073e97951c7fb5af' then raise exception 'Exact reviewed build5 required';end if;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2';
 if (select enabled from public.neptune_paper_v2_control where id=ac.id) or coalesce((ac.state->>'enabled')::boolean,true) then raise exception 'Existing owner Stop and acknowledgement required';end if;
 if (ac.state->>'control_epoch')::bigint is distinct from (select epoch from public.neptune_paper_v2_control where id=ac.id) then raise exception 'Owner Stop epoch not acknowledged';end if;
 if exists(select 1 from neptune_v2_private.positions where (payload->>'qty')::numeric>0) or ac.state->'pending' is distinct from '{}'::jsonb or ac.state->'receivables' is distinct from '{}'::jsonb or coalesce((select sum(delta) from neptune_v2_private.usd_ledger),0)<>0 then raise exception 'Flat settled pool required; never force a sale for migration';end if;
 if not exists(select 1 from neptune_v2_private.specialist_checkpoint) or (select count(*) from neptune_v2_private.specialist_accounts)<>5 then raise exception 'Existing five-account allocation required';end if;
 if (select config_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8' then raise exception 'Unexpected predecessor config';end if;
 if ac.cash is distinct from (select sum(delta) from neptune_v2_private.cash_ledger) then raise exception 'Root cash ledger mismatch';end if;
 if (ac.state->>'realized')::numeric is distinct from ((select legacy_realized from neptune_v2_private.specialist_checkpoint)+(select sum(realized_pnl) from neptune_v2_private.specialist_accounts)) then raise exception 'Root specialist realized mismatch';end if;
 perform neptune_v2_private.specialist_reconcile();
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) or exists(select 1 from pg_class p join pg_namespace n on n.oid=p.relnamespace cross join lateral aclexplode(coalesce(p.relacl,acldefault('r',p.relowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) or exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Existing private ACL drift requires separate review';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='allocate_specialists') is distinct from '67c930f1c249d287a504a79b51e93c0c' then raise exception 'Unexpected predecessor neptune_v2_private.allocate_specialists';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='bars') is distinct from 'edd80b7c5e654e6a6896ebaa3e694ada' then raise exception 'Unexpected predecessor neptune_v2_private.bars';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='book') is distinct from '2309762800bfba36adaeaf1edb5823ed' then raise exception 'Unexpected predecessor neptune_v2_private.book';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='decide') is distinct from '139491e07bc402c76c1df9b7528a279b' then raise exception 'Unexpected predecessor neptune_v2_private.decide';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='depth_price') is distinct from 'ea1429eb7a08bfa2d1b67a3c0be21a91' then raise exception 'Unexpected predecessor neptune_v2_private.depth_price';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='execute_fill') is distinct from '8f13f655fb214edb8310a9edbc3ee009' then raise exception 'Unexpected predecessor neptune_v2_private.execute_fill';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='feed_parse') is distinct from '11b5c066f98bdf2174720ad5ad3b4e4f' then raise exception 'Unexpected predecessor neptune_v2_private.feed_parse';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='feed_stop') is distinct from '9d1d63f7c61bcea50d1e2d5be7099063' then raise exception 'Unexpected predecessor neptune_v2_private.feed_stop';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='feed_tick') is distinct from '24f217d4e6813f9cd0ee0b6f44c61119' then raise exception 'Unexpected predecessor neptune_v2_private.feed_tick';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='feed_url') is distinct from '54c61870e867b67995aed111af89dc4f' then raise exception 'Unexpected predecessor neptune_v2_private.feed_url';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='feed_work') is distinct from 'accf5b133fcb013249b9197f22bce4f5' then raise exception 'Unexpected predecessor neptune_v2_private.feed_work';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='fresh') is distinct from 'f12f2c41d87b1ae7854c8c0b24b4bca7' then raise exception 'Unexpected predecessor neptune_v2_private.fresh';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='initialize') is distinct from '004c0082f15c18a0e9f9fe18ebdf8173' then raise exception 'Unexpected predecessor neptune_v2_private.initialize';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='initialize_owner_control') is distinct from '73013354062ea245997a75e7c2ce80b6' then raise exception 'Unexpected predecessor neptune_v2_private.initialize_owner_control';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='make_order') is distinct from '617786707c6146366194ff8f25dbf5de' then raise exception 'Unexpected predecessor neptune_v2_private.make_order';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='metadata_ok') is distinct from 'e229426570359d14201699bbcf23cd4f' then raise exception 'Unexpected predecessor neptune_v2_private.metadata_ok';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='mirror_history') is distinct from 'f6c6b15eb8f8dcec7e3010dbec53d2a1' then raise exception 'Unexpected predecessor neptune_v2_private.mirror_history';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='num') is distinct from '781eeaba02bed83ee15a543b22121451' then raise exception 'Unexpected predecessor neptune_v2_private.num';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='perth_daily_performance') is distinct from '794c023988030a720db081391f232006' then raise exception 'Unexpected predecessor neptune_v2_private.perth_daily_performance';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='process_scan') is distinct from 'f640faec618a22a0c26ca399e37d66ae' then raise exception 'Unexpected predecessor neptune_v2_private.process_scan';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='publish_control_ack') is distinct from '1032f0841af202bdc478980c82679e79' then raise exception 'Unexpected predecessor neptune_v2_private.publish_control_ack';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='publish_terminal') is distinct from 'd24f31d44a1d95705326ac50d8b0bf55' then raise exception 'Unexpected predecessor neptune_v2_private.publish_terminal';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='resolve_observation') is distinct from 'd4d01b7be230f6a8050289d7888b1d8a' then raise exception 'Unexpected predecessor neptune_v2_private.resolve_observation';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='set_enabled') is distinct from 'cf4a47b4d15aea2a1086bd3a30fc13e5' then raise exception 'Unexpected predecessor neptune_v2_private.set_enabled';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_book_fill') is distinct from 'a9676a76eaa167645878e0ca5c33a666' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_book_fill';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_book_settlement') is distinct from '07194384139753883deb16cb02e3ef0c' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_book_settlement';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_entry_budget') is distinct from '75f0c47b3d13832adce45c3262c66b25' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_entry_budget';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_for_asset') is distinct from 'cd34a5cee896372fef8a4555b4fcc78c' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_for_asset';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_projection') is distinct from '8edeef01266c88fa2c97d8c8952002bc' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_projection';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='specialist_reconcile') is distinct from 'f7406c049442fe1605e75eaec281e192' then raise exception 'Unexpected predecessor neptune_v2_private.specialist_reconcile';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='sync_control') is distinct from '5131bf25c3c56e5bc6f9cd3221c72c74' then raise exception 'Unexpected predecessor neptune_v2_private.sync_control';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='ts') is distinct from '58aea3ae7e6deb19d4b697cd42924b32' then raise exception 'Unexpected predecessor neptune_v2_private.ts';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='neptune_v2_private' and p.proname='universe') is distinct from '77a273cc3c8b44120ff8d01db54f79c6' then raise exception 'Unexpected predecessor neptune_v2_private.universe';end if;
 if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='neptune_v2_control_epoch') is distinct from '1ac69fc53a6b882c1388adf2139866bb' then raise exception 'Unexpected predecessor public.neptune_v2_control_epoch';end if;
end$$;
create temporary table native_cutover_preserved on commit drop as select to_jsonb(a) account_row,(select to_jsonb(c) from public.neptune_paper_v2_control c where c.id=a.id) control_row,(select jsonb_agg(to_jsonb(s) order by s.id) from neptune_v2_private.specialist_accounts s) specialists,(select count(*) from public.neptune_paper_v2_history) history_count,(select count(*) from neptune_v2_private.cash_ledger) cash_count,(select coalesce(jsonb_agg(to_jsonb(p) order by p.asset),'[]') from neptune_v2_private.positions p) positions,(select to_jsonb(p) from public.neptune_paper_v2_status p where p.id=a.id) public_status,(select to_jsonb(f) from neptune_v2_private.feed_control f where f.id) legacy_feed from neptune_v2_private.account a where a.id='neptune-paper-v2';
alter table neptune_v2_private.positions drop constraint positions_asset_check;
alter table neptune_v2_private.positions add constraint positions_asset_check check(asset in ('ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD','binance:SOLUSDT','hyperliquid:@107'));
create or replace function neptune_v2_private.universe() returns text[] language sql immutable security invoker set search_path='' as $$select array['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD','binance:SOLUSDT','hyperliquid:@107']::text[]$$;
create or replace function neptune_v2_private.num(v text) returns numeric language plpgsql immutable security invoker set search_path='' as $$begin
 if v is null or length(v)>48 or v !~ '^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$' then return null;end if;
 return v::numeric;exception when others then return null;end$$;
create or replace function neptune_v2_private.ts(v text) returns timestamptz language plpgsql stable security invoker set search_path='' as $$begin
 if v is null or length(v)>40 then return null;end if;return v::timestamptz;exception when others then return null;end$$;
create or replace function neptune_v2_private.fresh(v text,n timestamptz,seconds int) returns boolean language sql stable security invoker set search_path='' as $$select coalesce(neptune_v2_private.ts(v)<=n and neptune_v2_private.ts(v)>=n-make_interval(secs=>seconds),false)$$;
create or replace function neptune_v2_private.initialize(currency text) returns void language plpgsql security invoker set search_path='' as $$begin
 if (select config_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8' then raise exception 'Reviewed matching build metadata required';end if;
 if currency is distinct from 'AUD' then raise exception 'Explicit account currency required';end if;
 insert into neptune_v2_private.account(id,currency,initial_cash,cash,state) values('neptune-paper-v2',currency,10000,10000,jsonb_build_object('enabled',false,'started_at',clock_timestamp(),'last_bar','{}'::jsonb,'pending','{}'::jsonb,'last_exit','{}'::jsonb,'realized',0,'fees',0,'fill_count',0,'fx_costs',0,'receivables','{}'::jsonb,'day',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD'),'day_equity',10000,'peak_equity',10000,'risk_paused',false));
 insert into neptune_v2_private.cash_ledger values('initial',null,clock_timestamp(),10000,10000);
 insert into public.neptune_paper_v2_status values('neptune-paper-v2','{"version":2,"mode":"PAPER","experimental":true,"historically_validated":false,"confidence":"unvalidated","account_id":"neptune-paper-v2","currency":"AUD","status":"stopped","heartbeat_at":null,"scan_at":null,"quote_at":null,"scan_complete":false,"message":"A$10,000 virtual account created; engine stopped.","account":{"initial_cash":10000,"cash":10000,"equity":10000,"realized_pnl":0,"unrealized_pnl":0,"fees":0,"fills":0,"reserved_cash":0,"available_cash":10000,"unsettled_usd":0,"fx_costs":0,"valuation_at":null,"fx_at":null,"fx_source":null,"fx":null,"fx_applied_rate":null,"fx_rate_date":null,"fx_retrieved_at":null},"risk":{"per_entry_pct":0.25,"max_notional_pct":10,"max_positions":3,"aggregate_pct":0.75,"daily_drawdown_pct":2,"total_drawdown_pct":5,"entry_paused":true,"pause_reason":"stopped"},"cost_model":{"fee_per_side_pct":0.8,"slippage_per_side_pct":0.25,"actual_fee_tier":false,"fx_adverse_per_side_pct":0.25,"fx_model":"ECB reference-rate synthetic AUD accounting"},"universe":["ETH/USD","SOL/USD","AVAX/USD","LINK/USD","AAVE/USD","UNI/USD"],"positions":[],"decisions":[],"fills":[],"results":[],"settlements":[],"config_version":"neptune-v2-experimental-1","config_hash":"00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8"}'::jsonb||jsonb_build_object('history_seq',(select coalesce(max(seq),0) from public.neptune_paper_v2_history),'source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1)),clock_timestamp());
end$$;
create or replace function neptune_v2_private.book(m jsonb,n timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
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
create or replace function neptune_v2_private.bars(m jsonb,n timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
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
create or replace function neptune_v2_private.metadata_ok(m jsonb,a text,n timestamptz) returns boolean language sql stable security invoker set search_path='' as $$
select coalesce(m#>>'{metadata,asset}'=a and m#>>'{metadata,venue}'='Kraken' and m#>>'{metadata,kind}'='spot' and m#>>'{metadata,quote}'='USD' and m#>>'{metadata,status}'='online' and m#>>'{metadata,source}'='https://api.kraken.com/0/public/AssetPairs' and neptune_v2_private.fresh(m#>>'{metadata,at}',n,86400) and neptune_v2_private.num(m#>>'{metadata,tick_size}') between 0.000000000001 and 1000 and neptune_v2_private.num(m#>>'{metadata,min_qty}')>0 and neptune_v2_private.num(m#>>'{metadata,min_cost}')>0 and neptune_v2_private.num(m#>>'{metadata,qty_decimals}') between 0 and 12 and neptune_v2_private.num(m#>>'{metadata,qty_decimals}')=floor(neptune_v2_private.num(m#>>'{metadata,qty_decimals}')),false)$$;
create or replace function neptune_v2_private.depth_price(levels jsonb,qty numeric,side text,tick numeric default 0.000000000001) returns numeric language plpgsql immutable security invoker set search_path='' as $$declare leftqty numeric:=qty;cost numeric:=0;part numeric;v jsonb;rawprice numeric;begin
 if qty is null or qty<=0 or side not in ('buy','sell') or tick is null or tick<=0 then return null;end if;
 for v in select value from jsonb_array_elements(levels) loop part:=least(leftqty,(v->>1)::numeric);cost:=cost+part*(v->>0)::numeric;leftqty:=leftqty-part;if leftqty<=0 then exit;end if;end loop;
 if leftqty>0 then return null;end if;rawprice:=cost/qty*case when side='buy' then 1.0025 else .9975 end;return case when side='buy' then ceil(rawprice/tick)*tick else floor(rawprice/tick)*tick end;
end$$;
create or replace function neptune_v2_private.decide(obs text,at_time timestamptz,a text,action text,reason text,b jsonb,p jsonb,result text default 'no_trade') returns jsonb language plpgsql security invoker set search_path='' as $$declare d jsonb;did text;begin
 did:=md5(obs||a||action||reason||result);
 d:=jsonb_build_object('id',did,'at',at_time,'asset',a,'action',action,'price',b->'bid','quote_currency',neptune_v2_private.instrument_currency(a),'reason',reason,'source',case when neptune_v2_private.native_spec(a) is null then 'Kraken public spot' else (neptune_v2_private.native_spec(a)->>'venue')||' public spot' end,'observation_id',obs,'risk_base',p->'initial_risk_base','stop',p->'stop','target',p->'target','invalidation',p->'invalidation','confidence','unvalidated','result',result,'origin_order_id',p->>'id','origin_decision_id',p->>'decision_id','config_version','neptune-v2-experimental-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1));
 if neptune_v2_private.native_spec(a) is not null then d:=d||jsonb_build_object('native_model_version',neptune_v2_private.native_model()->>'version','native_model_hash',neptune_v2_private.native_model()->>'hash','venue',neptune_v2_private.native_spec(a)->>'venue','market_type','spot','specialist_id',neptune_v2_private.native_spec(a)->>'agent');end if;
 insert into neptune_v2_private.decisions values(did,obs,at_time,d);
 if p->>'id' is not null and result in ('cancelled','blocked') then insert into neptune_v2_private.order_events values(md5('event'||did),p->>'id',obs,at_time,result,d);end if;return d;
end$$;
create or replace function neptune_v2_private.make_order(d jsonb,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare r jsonb;begin
 r:=p||jsonb_build_object('id',md5('order'||(d->>'id')),'decision_id',d->>'id','observation_id',d->>'observation_id','at',d->>'at','asset',d->>'asset','side',d->>'action','reason',d->>'reason','config_hash',d->>'config_hash','source_hash',d->>'source_hash');
 if neptune_v2_private.native_spec(r->>'asset') is not null then r:=r||jsonb_build_object('native_model_version',d->>'native_model_version','native_model_hash',d->>'native_model_hash','venue',d->>'venue','market_type','spot','specialist_id',d->>'specialist_id','quote_currency',neptune_v2_private.instrument_currency(r->>'asset'));end if;
 insert into neptune_v2_private.orders values(r->>'id',r->>'decision_id',r->>'observation_id',(r->>'at')::timestamptz,r);insert into neptune_v2_private.order_events values(md5('created'||(r->>'id')),r->>'id',r->>'observation_id',(r->>'at')::timestamptz,'pending',r);return r;
end$$;
create or replace function neptune_v2_private.execute_fill(obs text,at_time timestamptz,a text,ord jsonb,qty numeric,price numeric,fx jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
create or replace function neptune_v2_private.process_scan(o jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
create or replace function neptune_v2_private.publish_terminal(status text,message text) returns void language plpgsql security invoker set search_path='' as $$declare projected_at timestamptz:=clock_timestamp();begin
 update public.neptune_paper_v2_status set payload=payload||jsonb_build_object('status',status,'message',message,'scan_complete',false,'heartbeat_at',clock_timestamp(),'history_seq',(select coalesce(max(seq),0) from public.neptune_paper_v2_history),'risk',(payload->'risk')||jsonb_build_object('entry_paused',true,'pause_reason',coalesce((select state->>'pause_reason' from neptune_v2_private.account where id='neptune-paper-v2'),status))),updated_at=clock_timestamp() where id='neptune-paper-v2';
 update public.neptune_paper_v2_status set payload=neptune_v2_private.native_public_projection(jsonb_set(payload,'{account,valuation_at}','null'),'{}',null,'{}',projected_at) where id='neptune-paper-v2';update public.neptune_paper_v2_status set payload=payload||jsonb_build_object('daily_performance',neptune_v2_private.perth_daily_performance(payload)) where id='neptune-paper-v2';
end$$;
create or replace function neptune_v2_private.set_enabled(desired boolean) returns void language plpgsql security invoker set search_path='' as $$
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
create or replace function neptune_v2_private.resolve_observation(obs_id text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
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

-- native-economics.sql
create function neptune_v2_private.native_model() returns jsonb language sql immutable security invoker set search_path='' as $$select '{"version":"neptune-native-paper-1","hash":"786fdae6b8f7c7e599181015cab5196591d633d6a455fd062be2f0c1af8a9180"}'::jsonb$$;
-- Pure native spot economics. Candidate only; no execution or external I/O.
-- Buy fees are modeled in received base, sell fees in received native quote.
-- Model is conservative public base-tier taker, not actual account commission.
create function neptune_v2_private.native_spec(asset text) returns jsonb language sql immutable security invoker set search_path='' as $$
select case asset when 'binance:SOLUSDT' then '{"venue":"binance","instrument":"SOLUSDT","base":"SOL","quote":"USDT","agent":"binance","exposure":"SOL","fee_rate":0.001,"fee_model":"public-base-tier-taker-no-discounts"}'::jsonb
 when 'hyperliquid:@107' then '{"venue":"hyperliquid","instrument":"@107","base":"HYPE","quote":"USDC","agent":"hyperliquid","exposure":"HYPE","fee_rate":0.0007,"fee_model":"public-base-tier-spot-taker-no-discounts"}'::jsonb end
$$;
create function neptune_v2_private.native_price(asset text,p numeric,side text,m jsonb) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare tick numeric;digits integer;
begin
 if p is null or p<=0 or p>10000000 or p::text in ('NaN','Infinity','-Infinity') or side is null or side not in ('buy','sell') then return null;end if;
 if asset='binance:SOLUSDT' then tick:=neptune_v2_private.num(m->>'tick_size');
 elsif asset='hyperliquid:@107' then
 if p=floor(p) then return p;end if;
 digits:=neptune_v2_private.num(m->>'qty_decimals')::integer;
 if digits is null or digits not between 0 and 8 then return null;end if;
 -- Hyperliquid spot: 5 significant figures and at most 8-szDecimals decimals.
 -- Whole integers are valid regardless of significant-figure count.
 tick:=greatest(power(10::numeric,-(8-digits)),power(10::numeric,floor(log(10::numeric,p))::integer-4));
 else return null;end if;
 if tick is null or tick<=0 or tick>1000 then return null;end if;
 return case when side='buy' then ceil(p/tick)*tick else floor(p/tick)*tick end;
end$$;
create function neptune_v2_private.native_identity(asset text,m jsonb,n timestamptz,require_fresh boolean default true) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare spec jsonb:=neptune_v2_private.native_spec(asset);d numeric;step numeric;
begin
 if spec is null or m->>'asset' is distinct from asset or m->>'venue' is distinct from spec->>'venue' or m->>'kind' is distinct from 'spot' or m->>'base' is distinct from spec->>'base' or m->>'quote' is distinct from spec->>'quote' or m->>'venue_id' is distinct from spec->>'instrument' or m->>'instrument' is distinct from asset or m->>'status' is distinct from 'online' or neptune_v2_private.ts(m->>'at') is null or (require_fresh is distinct from false and not neptune_v2_private.fresh(m->>'at',n,86400)) then return false;end if;
 if asset='binance:SOLUSDT' and (m->>'source' is distinct from 'https://data-api.binance.vision/api/v3/exchangeInfo?symbol=SOLUSDT' or m#>>'{instrument_identity,isSpotTradingAllowed}' is distinct from 'true') then return false;end if;
 if asset='hyperliquid:@107' and (m->>'source' is distinct from 'https://api.hyperliquid.xyz/info' or m#>>'{instrument_identity,universe_index}' is distinct from '107' or m#>>'{instrument_identity,base_token_index}' is distinct from '150' or m#>>'{instrument_identity,quote_token_index}' is distinct from '0' or m#>>'{instrument_identity,base_token_id}' is distinct from '0x0d01dc56dcaaca66ad901c959b4011ec' or m#>>'{instrument_identity,quote_token_id}' is distinct from '0x6d1e7cde53ba9467b783cb7c530ce054') then return false;end if;
 foreach d in array array[neptune_v2_private.num(m->>'qty_decimals'),neptune_v2_private.num(m#>>'{fee_qty_decimals,base}'),neptune_v2_private.num(m#>>'{fee_qty_decimals,quote}')] loop if d is null or d<>floor(d) or d not between 0 and 12 then return false;end if;end loop;
 step:=neptune_v2_private.num(m->>'qty_step');
 return coalesce(step>0 and step<=1000000 and neptune_v2_private.num(m->>'min_qty')>0 and neptune_v2_private.num(m->>'min_cost')>0 and neptune_v2_private.native_price(asset,1,'buy',m)>0,false);
end$$;
create function neptune_v2_private.native_quote_conversion(currency text,amount numeric,side text,evidence jsonb,n timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b jsonb;rate numeric;raw numeric;outusd numeric;levels jsonb;leftqty numeric:=amount;cost numeric:=0;part numeric;v jsonb;m jsonb:=evidence->'metadata';
begin
 if currency is null or currency not in ('USDT','USDC') or amount is null or amount<=0 or amount>1000000000 or amount::text in ('NaN','Infinity','-Infinity') or side is null or side not in ('buy','sell') then return null;end if;
 if evidence->>'asset' is distinct from currency||'/USD' or m->>'asset' is distinct from currency||'/USD' or m->>'venue' is distinct from 'kraken' or m->>'kind' is distinct from 'spot' or m->>'base' is distinct from currency or m->>'quote' is distinct from 'USD' or m->>'status' is distinct from 'online' or m->>'source' is distinct from 'https://api.kraken.com/0/public/AssetPairs' or not neptune_v2_private.fresh(m->>'at',n,86400) then return null;end if;
 b:=neptune_v2_private.book(evidence,n);if b?'error' then return null;end if;
 levels:=case when side='buy' then b->'asks' else b->'bids' end;
 for v in select value from jsonb_array_elements(levels) loop part:=least(leftqty,(v->>1)::numeric);cost:=cost+part*(v->>0)::numeric;leftqty:=leftqty-part;if leftqty<=0 then exit;end if;end loop;
 if leftqty>0 then return null;end if;raw:=cost/amount;
 -- Explicit adverse synthetic conversion model, never an assumed stablecoin peg.
 rate:=raw*case when side='buy' then 1.0025 else .9975 end;
 outusd:=case when side='buy' then ceil(amount*rate*1e12)/1e12 else floor(amount*rate*1e12)/1e12 end;
 return jsonb_build_object('currency',currency,'amount',amount,'raw_usd_per_quote',raw,'applied_usd_per_quote',rate,'usd_amount',outusd,'adverse_cost_usd',abs(outusd-cost),'source','Kraken public stablecoin/USD depth','at',b->'at','timestamp_basis',b->'timestamp_basis','model','observed depth plus adverse 0.25% synthetic conversion');
end$$;
create function neptune_v2_private.native_economics(asset text,side text,grossqty numeric,price numeric,m jsonb,fx jsonb,quote_fx jsonb,n timestamptz,held_rules boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare spec jsonb:=neptune_v2_private.native_spec(asset);feeqty numeric;feeq numeric;grossq numeric;netq numeric;netqty numeric;step numeric;bd integer;qd integer;conversion jsonb;usd numeric;aud numeric;audrate numeric;applied numeric;fee_aud numeric;cost_aud numeric;fxok boolean;
begin
 if not neptune_v2_private.native_identity(asset,m,n,not(side='sell' and held_rules is true)) or side is null or side not in ('buy','sell') or grossqty is null or price is null or grossqty<=0 or grossqty>1e12 or price<=0 or price>1e7 or grossqty::text in ('NaN','Infinity','-Infinity') or price::text in ('NaN','Infinity','-Infinity') then return null;end if;
 step:=(m->>'qty_step')::numeric;bd:=(m#>>'{fee_qty_decimals,base}')::int;qd:=(m#>>'{fee_qty_decimals,quote}')::int;
 if mod(grossqty,step)<>0 or grossqty<(m->>'min_qty')::numeric or price is distinct from neptune_v2_private.native_price(asset,price,side,m) then return null;end if;
 grossq:=case when side='buy' then ceil(grossqty*price*power(10::numeric,qd))/power(10::numeric,qd) else floor(grossqty*price*power(10::numeric,qd))/power(10::numeric,qd) end;
 if grossq<(m->>'min_cost')::numeric then return null;end if;
 if side='buy' then feeqty:=ceil(grossqty*(spec->>'fee_rate')::numeric*power(10::numeric,bd))/power(10::numeric,bd);feeq:=0;netqty:=grossqty-feeqty;netq:=-grossq;
 else feeqty:=0;feeq:=ceil(grossq*(spec->>'fee_rate')::numeric*power(10::numeric,qd))/power(10::numeric,qd);netqty:=-grossqty;netq:=grossq-feeq;end if;
 if (side='buy' and netqty<=0) or (side='sell' and netq<=0) then return null;end if;
 conversion:=neptune_v2_private.native_quote_conversion(spec->>'quote',abs(netq),side,quote_fx,n);
 audrate:=neptune_v2_private.num(fx->>'rate');
 fxok:=coalesce(fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and audrate between .25 and 5 and neptune_v2_private.fresh(fx->>'at',n,345600) and neptune_v2_private.fresh(fx->>'fetched_at',n,3600),false);
 if conversion is not null and fxok then
 usd:=(conversion->>'usd_amount')::numeric;applied:=audrate*case when side='buy' then 1.0025 else .9975 end;
 aud:=case when side='buy' then -ceil(usd*applied*1e12)/1e12 else floor(usd*applied*1e12)/1e12 end;
 fee_aud:=case when side='buy' then feeqty*price else feeq end*(conversion->>'raw_usd_per_quote')::numeric*audrate;
 cost_aud:=(conversion->>'adverse_cost_usd')::numeric*audrate+usd*abs(applied-audrate);
 end if;
 fee_aud:=round(fee_aud,12);cost_aud:=round(cost_aud,12);
 if abs(aud)>1000000000 or usd>1000000000 or fee_aud>1000000000 or cost_aud>1000000000 then aud:=null;usd:=null;fee_aud:=null;cost_aud:=null;conversion:=null;end if;
 -- Missing conversion may permit protective SELL proceeds, never a BUY.
 if side='buy' and aud is null then return null;end if;
 return jsonb_build_object('native_model_version',neptune_v2_private.native_model()->>'version','native_model_hash',neptune_v2_private.native_model()->>'hash','asset',asset,'venue',spec->>'venue','market_type','spot','specialist_id',spec->>'agent','canonical_exposure',spec->>'exposure','quote_currency',spec->>'quote',
 'gross_qty',grossqty,'price',price,'gross_quote',grossq,'fee_qty',feeqty,'fee_quote',feeq,'fee_currency',case when side='buy' then spec->>'base' else spec->>'quote' end,
 'fee_rate',spec->'fee_rate','fee_model',spec->>'fee_model','fee_denomination_basis',case when asset='binance:SOLUSDT' then 'official received-asset fee rule' else 'received-asset fee modeled from official spot fee documentation' end,'order_model','candidate indicative depth-taking simulation; venue-rule gate required before fill','net_inventory_delta',netqty,'net_quote_delta',netq,
 'sellable_inventory',case when side='buy' then floor(netqty/step)*step end,'dust_inventory',case when side='buy' then netqty-floor(netqty/step)*step end,
 'net_usd',case when usd is not null then usd*case when side='buy' then -1 else 1 end end,
 'cash_delta_base',aud,'fee_base',fee_aud,'fx_cost_base',cost_aud,'quote_conversion',case when aud is not null then conversion end,
 'fx',case when aud is not null then audrate end,'fx_applied_rate',case when aud is not null then applied end,'fx_source',case when aud is not null then fx->>'source' end,'fx_at',case when aud is not null then fx->>'at' end,
 'settlement_status',case when aud is null then 'pending_native_conversion' else 'settled' end);
end$$;
revoke all on function neptune_v2_private.native_spec(text),neptune_v2_private.native_price(text,numeric,text,jsonb),neptune_v2_private.native_identity(text,jsonb,timestamptz,boolean),neptune_v2_private.native_quote_conversion(text,numeric,text,jsonb,timestamptz),neptune_v2_private.native_economics(text,text,numeric,numeric,jsonb,jsonb,jsonb,timestamptz,boolean) from public,anon,authenticated,service_role;

revoke all on function neptune_v2_private.native_model() from public,anon,authenticated,service_role;


-- native-ledger.sql
-- Isolated candidate. Load after existing schema/core/owner-access and native-economics.
-- No grants, no publication, no seed, no external writes.
create table neptune_v2_private.native_quote_ledger (
 id text primary key, fill_id text not null references neptune_v2_private.fills(id),
 settlement_id text references neptune_v2_private.settlements(id),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 currency text not null check(currency in ('USDT','USDC')),
 at timestamptz not null, kind text not null check(kind in ('purchase_conversion','trade','fee','proceeds_conversion')),
 delta numeric not null check(delta<>0 and abs(delta)<=1000000000),
 unique(fill_id,kind)
);
create table neptune_v2_private.native_inventory (
 asset text primary key check(asset in ('binance:SOLUSDT','hyperliquid:@107')),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 canonical_exposure text not null unique check(canonical_exposure in ('SOL','HYPE')),
 qty numeric not null check(qty>=0 and qty<1000000000000),
 cost_base numeric(30,12) not null check(cost_base>=0),
 risk_base numeric(30,12) not null check(risk_base>=0),
 qty_step numeric not null check(qty_step>0),
 last_fill_id text not null references neptune_v2_private.fills(id)
);
create table neptune_v2_private.native_fill_attribution (
 fill_id text primary key references neptune_v2_private.fills(id),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 asset text not null, currency text not null check(currency in ('USDT','USDC')),
 side text not null check(side in ('buy','sell')),
 gross_qty numeric not null check(gross_qty>0), inventory_delta numeric not null,
 gross_quote numeric not null check(gross_quote>0), fee_qty numeric not null check(fee_qty>=0), fee_quote numeric not null check(fee_quote>=0),
 net_quote numeric not null, cost_base numeric(30,12) not null check(cost_base>=0),
 risk_base numeric(30,12) not null check(risk_base>=0), cash_delta numeric(30,12),
 accounting jsonb not null
);
create table neptune_v2_private.native_receivables (
 exit_fill_id text primary key references neptune_v2_private.native_fill_attribution(fill_id),
 currency text not null check(currency in ('USDT','USDC')),
 amount numeric not null check(amount>0), at timestamptz not null
);
create table neptune_v2_private.native_settlement_attribution (
 exit_fill_id text primary key references neptune_v2_private.native_receivables(exit_fill_id),
 settlement_id text not null unique references neptune_v2_private.settlements(id),
 observation_id text not null references neptune_v2_private.observations(id)
);
do $$declare t text;begin
 foreach t in array array['native_quote_ledger','native_inventory','native_fill_attribution','native_receivables','native_settlement_attribution'] loop
 execute format('alter table neptune_v2_private.%I enable row level security',t);
 execute format('revoke all on neptune_v2_private.%I from public,anon,authenticated,service_role',t);
 if t<>'native_inventory' then
 execute format('create trigger immutable_rows before update or delete on neptune_v2_private.%I for each row execute function neptune_v2_private.immutable()',t);
 execute format('create trigger immutable_table before truncate on neptune_v2_private.%I for each statement execute function neptune_v2_private.immutable()',t);
 end if;end loop;
end$$;

create function neptune_v2_private.native_signed_num(v text) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;begin
 if v is null or length(v)>48 or v !~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$' then return null;end if;
 n:=v::numeric;if abs(n)>1e12 then return null;end if;return n;
 exception when others then return null;end$$;

create function neptune_v2_private.native_reconcile() returns void language plpgsql security invoker set search_path='' as $$
begin
 perform neptune_v2_private.specialist_reconcile();
 if exists(
 select 1 from (select agent_id,currency,sum(delta) amount from neptune_v2_private.native_quote_ledger group by agent_id,currency) l
 full join (select a.agent_id,r.currency,sum(r.amount) amount from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id
 where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id) group by a.agent_id,r.currency) r
 using(agent_id,currency) where coalesce(l.amount,0)<>coalesce(r.amount,0)) then raise exception 'Native currency reconciliation failed';end if;
 if exists(select 1 from neptune_v2_private.native_inventory i full join
 (select a.asset,sum(a.inventory_delta) qty,sum(case when a.side='buy' then a.cost_base else -a.cost_base end) cost_base,sum(case when a.side='buy' then a.risk_base else -a.risk_base end) risk_base from neptune_v2_private.native_fill_attribution a group by a.asset) a using(asset)
 where coalesce(i.qty,0)<>coalesce(a.qty,0) or coalesce(i.cost_base,0)<>coalesce(a.cost_base,0) or coalesce(i.risk_base,0)<>coalesce(a.risk_base,0)) then raise exception 'Native inventory reconciliation failed';end if;
end$$;

-- Root cash and its source cash_ledger row must already be recorded by execute_native_fill.
-- This hook books native specialist ownership exactly once from the immutable fill.
-- Does NOT mutate account.state; scanner merges returned root state counters once.
create function neptune_v2_private.native_book_fill(source_fill_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare f neptune_v2_private.fills;inv neptune_v2_private.native_inventory;spec jsonb;v jsonb;r jsonb;res jsonb;
 agent text;currency text;side text;asset_key text;cost numeric;heldcost numeric;heldrisk numeric;risk numeric;qty numeric;delta numeric;grossq numeric;feeq numeric;feeb numeric;netq numeric;step numeric;pnl numeric;fees numeric;fxcost numeric;budget numeric;remaining numeric;cycle_id text;previous_id text;exit_reason text;sold_all boolean:=false;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not exists(select 1 from neptune_v2_private.specialist_checkpoint) then raise exception 'Allocation required';end if;
 select accounting into r from neptune_v2_private.native_fill_attribution where fill_id=source_fill_id;
 if found then return r||'{"replay":true}'::jsonb;end if;
 select * into f from neptune_v2_private.fills where id=source_fill_id;if not found then raise exception 'Authoritative native fill missing';end if;
 v:=f.payload;asset_key:=v->>'asset';spec:=neptune_v2_private.native_spec(asset_key);agent:=spec->>'agent';currency:=spec->>'quote';side:=v->>'side';
 if spec is null or v->>'venue' is distinct from spec->>'venue' or v->>'market_type' is distinct from 'spot' or v->>'specialist_id' is distinct from agent or v->>'quote_currency' is distinct from currency or side is null or side not in ('buy','sell') then raise exception 'Exact native spot identity required';end if;
 if not exists(select 1 from public.neptune_paper_v2_history h,neptune_v2_private.specialist_checkpoint c where h.kind in ('fills','native_fills') and h.id=f.id and h.seq>c.history_seq) then raise exception 'Cannot reattribute historical native fill';end if;
 qty:=neptune_v2_private.num(v->>'gross_qty');delta:=neptune_v2_private.native_signed_num(v->>'net_inventory_delta');grossq:=neptune_v2_private.num(v->>'gross_quote');feeq:=neptune_v2_private.num(v->>'fee_quote');feeb:=neptune_v2_private.num(v->>'fee_qty');netq:=neptune_v2_private.native_signed_num(v->>'net_quote_delta');step:=neptune_v2_private.num(v->>'qty_step');
 if qty is null or qty<=0 or delta is null or grossq is null or grossq<=0 or feeq is null or feeq<0 or feeb is null or feeb<0 or netq is null or step is null or step<=0 or mod(qty,step)<>0 then raise exception 'Invalid native quantities';end if;
 if (side='buy' and (delta<>qty-feeb or delta<=0 or feeq<>0 or netq<>-grossq or v->>'fee_currency' is distinct from spec->>'base'))
 or (side='sell' and (delta<>-qty or feeb<>0 or netq<>grossq-feeq or netq<=0 or v->>'fee_currency' is distinct from currency)) then raise exception 'Native gross/net/fee mismatch';end if;
 if f.cash_delta is distinct from neptune_v2_private.native_signed_num(v->>'cash_delta_base') then raise exception 'Source cash mismatch';end if;
 if f.cash_delta is not null then
 if neptune_v2_private.native_conversion_consumed(f.observation_id,currency,side) then raise exception 'Native conversion depth already consumed for observation side/currency';end if;
 if not exists(select 1 from neptune_v2_private.cash_ledger l where l.fill_id=f.id and l.delta=f.cash_delta) then raise exception 'Source cash ledger missing';end if;
 fees:=neptune_v2_private.num(v->>'fee_base');fxcost:=neptune_v2_private.num(v->>'fx_cost_base');
 if fees is null or fees<0 or fxcost is null or fxcost<0 or v->>'settlement_status' is distinct from 'settled' then raise exception 'Settled native provenance missing';end if;
 else fees:=0;fxcost:=0;if side<>'sell' or v->>'settlement_status' is distinct from 'pending_native_conversion' or exists(select 1 from neptune_v2_private.cash_ledger where fill_id=f.id) then raise exception 'Only native sell proceeds may pend';end if;end if;
 if exists(select 1 from neptune_v2_private.usd_ledger where fill_id=f.id) then raise exception 'Native proceeds must never enter USD ledger';end if;
 select * into inv from neptune_v2_private.native_inventory where native_inventory.asset=asset_key;
 previous_id:=case when coalesce(inv.qty,0)>0 then inv.last_fill_id end;
 cycle_id:=case when coalesce(inv.qty,0)>0 then (select accounting->>'inventory_cycle_id' from neptune_v2_private.native_fill_attribution where fill_id=inv.last_fill_id) else f.id end;
 if side='buy' then
 budget:=(select least(cash,opening_cash) from neptune_v2_private.specialist_accounts where id=agent);
 risk:=neptune_v2_private.num(v->>'initial_risk_base');cost:=-f.cash_delta;
 if cost is null or cost<=0 or budget is null or cost>budget*.1 or risk is null or risk<=0 or risk>budget*.0025 then raise exception 'Native specialist budget/risk ceiling';end if;
 -- An existing dust residual can be aggregated only within its exact instrument/owner.
 if inv.asset is not null and (inv.agent_id<>agent or inv.qty>=inv.qty_step) then raise exception 'Duplicate native exposure';end if;
 if exists(select 1 from neptune_v2_private.positions p where (p.payload->>'qty')::numeric>0 and p.asset<>asset_key and (case when p.asset='SOL/USD' then 'SOL' when p.asset='binance:SOLUSDT' then 'SOL' when p.asset='hyperliquid:@107' then 'HYPE' else p.asset end)=spec->>'exposure') then raise exception 'Duplicate canonical exposure';end if;
 remaining:=coalesce(inv.qty,0)+delta;heldcost:=coalesce(inv.cost_base,0)+cost;heldrisk:=coalesce(inv.risk_base,0)+risk;
 if remaining<step then raise exception 'Native received inventory must contain a sellable lot';end if;
 else
 if inv.asset is null or inv.agent_id<>agent or qty>inv.qty or step<>inv.qty_step then raise exception 'Native inventory oversell or lot mismatch';end if;
 cost:=case when qty=inv.qty then inv.cost_base else floor(inv.cost_base*qty/inv.qty*1e12)/1e12 end;
 risk:=case when qty=inv.qty then inv.risk_base else floor(inv.risk_base*qty/inv.qty*1e12)/1e12 end;
 remaining:=inv.qty-qty;heldcost:=inv.cost_base-cost;heldrisk:=inv.risk_base-risk;
 sold_all:=qty=floor(inv.qty/step)*step;
 select payload->>'reason' into exit_reason from neptune_v2_private.orders where id=f.order_id;
 if remaining>0 and remaining<step and (not sold_all or exit_reason is null or exit_reason not in ('protective_stop','net_r_target')) then raise exception 'Dust requires complete sellable inventory exit with source reason';end if;
 end if;
 pnl:=case when side='sell' and f.cash_delta is not null then f.cash_delta-cost end;
 r:=jsonb_build_object('fill_id',f.id,'asset',asset_key,'specialist_id',agent,'side',side,'quote_currency',currency,'qty_remaining',remaining,'cost_remaining',heldcost,'risk_remaining',heldrisk,
 'sellable_inventory',floor(remaining/step)*step,'dust_inventory',remaining-floor(remaining/step)*step,'cost_base',cost,'initial_risk_base',risk,'cost_basis_method','weighted_average_pro_rata_floor12_residual_retained','previous_native_fill_id',previous_id,'inventory_cycle_id',cycle_id,'sold_entire_sellable_inventory',sold_all,'exit_reason',exit_reason,'verified_fee_dust',side='sell' and remaining>0 and remaining<step and sold_all,'pnl_base',pnl,'fee_base',fees,'fx_cost_base',fxcost,'position_status',case when remaining=0 then 'closed' when remaining<step then 'dust_held' else 'open' end,'replay',false);
 insert into neptune_v2_private.native_fill_attribution values(f.id,agent,asset_key,currency,side,qty,delta,grossq,feeb,feeq,netq,cost,risk,f.cash_delta,r);
 insert into neptune_v2_private.native_inventory values(asset_key,agent,spec->>'exposure',remaining,heldcost,heldrisk,step,f.id)
 on conflict(asset) do update set qty=excluded.qty,cost_base=excluded.cost_base,risk_base=excluded.risk_base,qty_step=excluded.qty_step,last_fill_id=excluded.last_fill_id;
 if side='buy' then
 insert into neptune_v2_private.native_quote_ledger values(md5('native-acquire'||f.id),f.id,null,agent,currency,f.at,'purchase_conversion',grossq);
 insert into neptune_v2_private.native_quote_ledger values(md5('native-trade'||f.id),f.id,null,agent,currency,f.at,'trade',-grossq);
 else
 insert into neptune_v2_private.native_quote_ledger values(md5('native-trade'||f.id),f.id,null,agent,currency,f.at,'trade',grossq);
 if feeq>0 then insert into neptune_v2_private.native_quote_ledger values(md5('native-fee'||f.id),f.id,null,agent,currency,f.at,'fee',-feeq);end if;
 if f.cash_delta is not null then insert into neptune_v2_private.native_quote_ledger values(md5('native-convert'||f.id),f.id,null,agent,currency,f.at,'proceeds_conversion',-netq);
 else insert into neptune_v2_private.native_receivables values(f.id,currency,netq,f.at);end if;
 res:=r||jsonb_build_object('id',md5('native-result'||f.id),'exit_fill_id',f.id,'at',f.at,'closed_at',case when remaining=0 then f.at end,'status',case when f.cash_delta is null then 'pending_native_conversion' else 'settled' end,'net_r',case when risk>0 then pnl/risk end);
 insert into neptune_v2_private.results values(res->>'id',f.id,f.at,res);
 end if;
 update neptune_v2_private.specialist_accounts set cash=cash+coalesce(f.cash_delta,0),realized_pnl=realized_pnl+coalesce(pnl,0),costs_base=costs_base+fees+fxcost where id=agent;
 perform neptune_v2_private.native_reconcile();return r;
end$$;

-- One conversion per exact immutable observation/currency/side. This conservative
-- bound prevents replaying the same visible depth for independent fills/settlements.
create function neptune_v2_private.native_conversion_consumed(source_observation_id text,currency_code text,conversion_side text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from neptune_v2_private.native_fill_attribution a join neptune_v2_private.fills f on f.id=a.fill_id
 where f.observation_id=source_observation_id and a.currency=currency_code and a.side=conversion_side and a.cash_delta is not null)
 or (conversion_side='sell' and exists(select 1 from neptune_v2_private.native_settlement_attribution a join neptune_v2_private.native_receivables r on r.exit_fill_id=a.exit_fill_id where a.observation_id=source_observation_id and r.currency=currency_code))
$$;

-- Exact pending native amount is converted from stored public evidence, never caller amounts.
create function neptune_v2_private.native_settle(source_exit_fill_id text,source_observation_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a neptune_v2_private.native_fill_attribution;rec neptune_v2_private.native_receivables;ob neptune_v2_private.observations;f neptune_v2_private.fills;ac neptune_v2_private.account;
 result jsonb;conversion jsonb;fx jsonb;rate numeric;applied numeric;usd numeric;cashdelta numeric;pnl numeric;fxcost numeric;fee numeric;sid text;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select s.payload into result from neptune_v2_private.native_settlement_attribution x join neptune_v2_private.settlements s on s.id=x.settlement_id where x.exit_fill_id=source_exit_fill_id;
 if found then return result||'{"replay":true}'::jsonb;end if;
 select * into rec from neptune_v2_private.native_receivables where exit_fill_id=source_exit_fill_id;if not found then raise exception 'Pending native receivable missing';end if;
 select * into a from neptune_v2_private.native_fill_attribution where fill_id=source_exit_fill_id;
 select * into f from neptune_v2_private.fills where id=source_exit_fill_id;
 select * into ob from neptune_v2_private.observations where id=source_observation_id;
 if not found then raise exception 'Settlement observation missing';end if;
 if ac.currency<>'AUD' or ob.at<=rec.at or not neptune_v2_private.fresh(ob.at::text,clock_timestamp(),30) then return null;end if;
 if a.side<>'sell' or a.cash_delta is not null or rec.currency<>a.currency or rec.amount<>a.net_quote then raise exception 'Pending native source mismatch';end if;
 if neptune_v2_private.native_conversion_consumed(ob.id,rec.currency,'sell') then return null;end if;
 conversion:=neptune_v2_private.native_quote_conversion(rec.currency,rec.amount,'sell',ob.payload#>array['quote_fx',rec.currency||'/USD'],ob.at);
 fx:=ob.payload->'fx';rate:=neptune_v2_private.num(fx->>'rate');
 if conversion is null or not coalesce(fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and rate between .25 and 5 and neptune_v2_private.fresh(fx->>'at',ob.at,345600) and neptune_v2_private.fresh(fx->>'fetched_at',ob.at,3600),false) then return null;end if;
 usd:=(conversion->>'usd_amount')::numeric;applied:=rate*.9975;cashdelta:=floor(usd*applied*1e12)/1e12;pnl:=cashdelta-a.cost_base;
 fee:=a.fee_quote*(conversion->>'raw_usd_per_quote')::numeric*rate;
 fxcost:=(conversion->>'adverse_cost_usd')::numeric*rate+usd*(rate-applied);
 -- Cash/PnL counters use the same scale as the source account, preserving exact reconciliation.
 fee:=round(fee,12);fxcost:=round(fxcost,12);
 if cashdelta>1000000000 or ac.cash+cashdelta>1000000000 or fee>1000000000 or fxcost>1000000000 then return null;end if;
 sid:=md5('native-settlement'||source_exit_fill_id);
 result:=jsonb_build_object('id',sid,'exit_fill_id',source_exit_fill_id,'observation_id',source_observation_id,'at',ob.at,'settled_at',ob.at,'asset',a.asset,'venue',f.payload->>'venue','market_type','spot','specialist_id',a.agent_id,
 'quote_currency',rec.currency,'quote_amount',rec.amount,'quote_conversion',conversion,'usd_amount',usd,'fx',rate,'fx_source',fx->>'source','fx_at',fx->>'at','fx_rate_date',fx->>'rate_date','fx_retrieved_at',fx->>'fetched_at','fx_applied_rate',applied,
 'cash_delta_base',cashdelta,'cost_base',a.cost_base,'pnl_base',pnl,'fee_base',fee,'fx_cost_base',fxcost,'status','settled','settlement_status','settled','replay',false,
 'cost_basis_method',a.accounting->>'cost_basis_method','previous_native_fill_id',a.accounting->'previous_native_fill_id','inventory_cycle_id',a.accounting->'inventory_cycle_id','position_status',a.accounting->>'position_status','qty_remaining',a.accounting->'qty_remaining','closed_at',case when a.accounting->>'position_status'='closed' then f.at end,
 'native_model_version',neptune_v2_private.native_model()->>'version','native_model_hash',neptune_v2_private.native_model()->>'hash','exit_native_model_hash',f.payload->>'native_model_hash','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1),'config_hash',(select config_hash from neptune_v2_private.build_metadata order by id desc limit 1),'exit_source_hash',f.payload->>'source_hash','exit_config_hash',f.payload->>'config_hash');
 insert into neptune_v2_private.settlements values(sid,source_exit_fill_id,ob.at,result);
 update neptune_v2_private.account set cash=cash+cashdelta where id=ac.id;
 insert into neptune_v2_private.cash_ledger values(md5('native-settle-cash'||source_exit_fill_id),null,ob.at,cashdelta,ac.cash+cashdelta);
 insert into neptune_v2_private.native_quote_ledger values(md5('native-convert'||source_exit_fill_id),source_exit_fill_id,sid,a.agent_id,rec.currency,ob.at,'proceeds_conversion',-rec.amount);
 insert into neptune_v2_private.native_settlement_attribution values(source_exit_fill_id,sid,source_observation_id);
 update neptune_v2_private.specialist_accounts set cash=cash+cashdelta,realized_pnl=realized_pnl+pnl,costs_base=costs_base+fee+fxcost where id=a.agent_id;
 insert into neptune_v2_private.results values(md5('native-settle-result'||source_exit_fill_id),source_exit_fill_id,ob.at,result||jsonb_build_object('id',md5('native-settle-result'||source_exit_fill_id),'net_r',case when a.risk_base>0 then pnl/a.risk_base end));
 perform neptune_v2_private.native_reconcile();return result;
end$$;

create function neptune_v2_private.native_projection() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'native_positions',coalesce((select jsonb_agg(jsonb_build_object('asset',i.asset,'specialist_id',i.agent_id,'canonical_exposure',i.canonical_exposure,'qty',i.qty,'cost_base',i.cost_base,'initial_risk_base',i.risk_base,'qty_step',i.qty_step,'verified_fee_dust',coalesce((la.accounting->>'verified_fee_dust')::boolean,false),'valuation_basis',case when i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' then 'non_executable_conservative_floor' end,'liquidation_floor_base',case when i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' then 0 end,'conservative_risk_base',case when i.qty<i.qty_step then i.cost_base else i.risk_base end,'inventory_cycle_id',la.accounting->>'inventory_cycle_id','last_fill_id',i.last_fill_id,'cost_basis_method',la.accounting->>'cost_basis_method','sellable_inventory',floor(i.qty/i.qty_step)*i.qty_step,'dust_inventory',i.qty-floor(i.qty/i.qty_step)*i.qty_step,'status',case when i.qty<i.qty_step then 'dust_held' else 'open' end) order by i.asset) from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution la on la.fill_id=i.last_fill_id where i.qty>0),'[]'::jsonb),
 'pending_native_proceeds',coalesce((select jsonb_agg(jsonb_build_object('exit_fill_id',r.exit_fill_id,'asset',a.asset,'specialist_id',a.agent_id,'currency',r.currency,'amount',r.amount,'cost_base',a.cost_base,'closed_at',case when a.accounting->>'position_status'='closed' then r.at end,'status','pending_native_conversion') order by r.at,r.exit_fill_id) from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id)),'[]'::jsonb))
$$;
revoke all on function neptune_v2_private.native_conversion_consumed(text,text,text),neptune_v2_private.native_signed_num(text),neptune_v2_private.native_reconcile(),neptune_v2_private.native_book_fill(text),neptune_v2_private.native_settle(text,text),neptune_v2_private.native_projection() from public,anon,authenticated,service_role;


-- native-order-rules.sql
-- Exact synthetic LIMIT IOC admission. Does not submit orders or assert venue acceptance.
create function neptune_v2_private.native_order_rules(asset text,side text,qty numeric,limit_price numeric,m jsonb,avg jsonb,n timestamptz) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare f jsonb;kind text;price numeric;mins integer;ref numeric;lo numeric;hi numeric;filters jsonb:=m#>'{rules,all_filters}';
begin
 if side is null or side not in ('buy','sell') or qty is null or qty<=0 or limit_price is null or limit_price<=0 then return false;end if;
 if asset='hyperliquid:@107' then return coalesce(mod(qty,(m->>'qty_step')::numeric)=0 and qty>=(m->>'min_qty')::numeric and qty*limit_price>=(m->>'min_cost')::numeric and limit_price=neptune_v2_private.native_price(asset,limit_price,side,m),false);end if;
 if asset<>'binance:SOLUSDT' or jsonb_typeof(filters) is distinct from 'array' or not (m#>'{rules,order_types}' ? 'LIMIT') then return false;end if;
 if exists(select 1 from jsonb_array_elements(filters) x group by x->>'filterType' having count(*)<>1) then return false;end if;
 if (select count(*) from jsonb_array_elements(filters) x where x->>'filterType'='PRICE_FILTER')<>1 or (select count(*) from jsonb_array_elements(filters) x where x->>'filterType'='LOT_SIZE')<>1 or (select count(*) from jsonb_array_elements(filters) x where x->>'filterType' in ('NOTIONAL','MIN_NOTIONAL'))<>1 then return false;end if;
 for f in select value from jsonb_array_elements(filters) loop
 kind:=f->>'filterType';
 if kind='LOT_SIZE' then
 if neptune_v2_private.num(f->>'minQty') is null or neptune_v2_private.num(f->>'maxQty') is null or neptune_v2_private.num(f->>'minQty')<=0 or neptune_v2_private.num(f->>'maxQty')<neptune_v2_private.num(f->>'minQty') or qty<neptune_v2_private.num(f->>'minQty') or qty>neptune_v2_private.num(f->>'maxQty') or coalesce(neptune_v2_private.num(f->>'stepSize'),0)<=0 or mod(qty,(f->>'stepSize')::numeric)<>0 then return false;end if;
 elsif kind='PRICE_FILTER' then
 lo:=neptune_v2_private.num(f->>'minPrice');hi:=neptune_v2_private.num(f->>'maxPrice');price:=neptune_v2_private.num(f->>'tickSize');
 if lo is null or hi is null or price is null or price<=0 or (lo>0 and limit_price<lo) or (hi>0 and limit_price>hi) or mod(limit_price,price)<>0 then return false;end if;
 elsif kind in ('NOTIONAL','MIN_NOTIONAL') then
 lo:=neptune_v2_private.num(f->>'minNotional');hi:=neptune_v2_private.num(f->>'maxNotional');
 if lo is null or lo<=0 or qty*limit_price<lo or (kind='NOTIONAL' and (hi is null or hi<=0 or qty*limit_price>hi)) then return false;end if;
 elsif kind in ('PERCENT_PRICE','PERCENT_PRICE_BY_SIDE') then
 ref:=neptune_v2_private.num(avg->>'price');mins:=neptune_v2_private.num(f->>'avgPriceMins')::integer;
 if ref is null or ref<=0 or mins is null or mins<1 or avg->>'source' is distinct from 'https://data-api.binance.vision/api/v3/avgPrice?symbol=SOLUSDT' or neptune_v2_private.num(avg->>'mins') is distinct from mins::numeric or not neptune_v2_private.fresh(avg->>'at',n,30) or not neptune_v2_private.fresh(avg->>'received_at',n,30) then return false;end if;
 lo:=neptune_v2_private.num(f->>case when kind='PERCENT_PRICE' then 'multiplierDown' when side='buy' then 'bidMultiplierDown' else 'askMultiplierDown' end);
 hi:=neptune_v2_private.num(f->>case when kind='PERCENT_PRICE' then 'multiplierUp' when side='buy' then 'bidMultiplierUp' else 'askMultiplierUp' end);
 if lo is null or hi is null or lo<=0 or hi<lo or limit_price<ref*lo or limit_price>ref*hi then return false;end if;
 elsif kind in ('MARKET_LOT_SIZE','ICEBERG_PARTS','TRAILING_DELTA','MAX_NUM_ALGO_ORDERS','MAX_NUM_ICEBERG_ORDERS') then
 -- Not applicable to this no-iceberg/no-trailing plain LIMIT IOC model.
 null;
 elsif kind='MAX_NUM_ORDERS' then if coalesce(neptune_v2_private.num(f->>'maxNumOrders'),0)<3 then return false;end if;
 elsif kind='MAX_POSITION' then
 -- No verified venue account inventory exists; cannot validate this filter.
 return false;
 else return false;
 end if;
 end loop;
 return true;
exception when others then return false;
end$$;
-- Worst consumed level determines the executable limit; VWAP is separate.
create function neptune_v2_private.native_limit_price(asset text,levels jsonb,qty numeric,side text,m jsonb) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb;leftqty numeric:=qty;p numeric;size numeric;previous numeric;
begin
 if qty is null or qty<=0 or side is null or side not in ('buy','sell') or jsonb_typeof(levels) is distinct from 'array' then return null;end if;
 for v in select value from jsonb_array_elements(levels) loop
 p:=neptune_v2_private.num(v->>0);size:=neptune_v2_private.num(v->>1);if p is null or p<=0 or size is null or size<=0 or (previous is not null and ((side='buy' and p<=previous) or (side='sell' and p>=previous))) then return null;end if;previous:=p;leftqty:=leftqty-size;exit when leftqty<=0;
 end loop;
 if leftqty>0 or p is null then return null;end if;
 return neptune_v2_private.native_price(asset,p*case when side='buy' then 1.0025 else .9975 end,side,m);
exception when others then return null;
end$$;
revoke all on function neptune_v2_private.native_order_rules(text,text,numeric,numeric,jsonb,jsonb,timestamptz),neptune_v2_private.native_limit_price(text,jsonb,numeric,text,jsonb) from public,anon,authenticated,service_role;


-- native-scanner-helpers.sql
-- Local integration helpers. No scheduler or external mutation installed.
create function neptune_v2_private.instrument_depth(asset text,levels jsonb,qty numeric,side text,m jsonb) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare p numeric;step numeric;
begin
 if neptune_v2_private.native_spec(asset) is null then return neptune_v2_private.depth_price(levels,qty,side,(m->>'tick_size')::numeric);end if;
 step:=neptune_v2_private.num(m->>'qty_step');if step is null or step<=0 then return null;end if;
 if side='sell' then qty:=floor(qty/step)*step;end if;if qty<=0 then return null;end if;
 p:=neptune_v2_private.depth_price(levels,qty,side,.000000000001);
 return neptune_v2_private.native_price(asset,p,side,m);
end$$;
create function neptune_v2_private.instrument_value(asset text,qty numeric,price numeric,side text,m jsonb,fx jsonb,quote_fx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare e jsonb;step numeric;rate numeric;currency text;
begin
 if price is null or qty is null or qty<=0 then return null;end if;
 if neptune_v2_private.native_spec(asset) is null then
 rate:=neptune_v2_private.num(fx->>'rate');if rate is null then return null;end if;
 return price*qty*case when side='buy' then 1.008*rate*1.0025 else .992*rate*.9975 end;
 end if;
 step:=neptune_v2_private.num(m->>'qty_step');if step is null or step<=0 then return null;end if;
 if side='sell' then
 qty:=floor(qty/step)*step;
 if qty<(m->>'min_qty')::numeric or qty*price<(m->>'min_cost')::numeric then return null;end if;
 end if;
 currency:=neptune_v2_private.native_spec(asset)->>'quote';
 e:=neptune_v2_private.native_economics(asset,side,qty,neptune_v2_private.native_price(asset,price,side,m),m,fx,quote_fx->(currency||'/USD'),n,side='sell');
 return abs((e->>'cash_delta_base')::numeric);
end$$;
create function neptune_v2_private.net_owned_after_fee(asset text,grossqty numeric,m jsonb) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare rate numeric;d integer;
begin
 if neptune_v2_private.native_spec(asset) is null then return grossqty;end if;
 rate:=(neptune_v2_private.native_spec(asset)->>'fee_rate')::numeric;d:=(m#>>'{fee_qty_decimals,base}')::integer;
 return grossqty-ceil(grossqty*rate*power(10::numeric,d))/power(10::numeric,d);
end$$;
create function neptune_v2_private.canonical_exposure(asset text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(asset)->>'exposure',split_part(asset,'/',1))$$;
-- Native executor only called AFTER strategy, source-book, sizing and venue-rule gates.
create function neptune_v2_private.execute_native_fill(obs text,at_time timestamptz,asset text,ord jsonb,qty numeric,price numeric) returns jsonb language plpgsql security invoker set search_path='' as $$
declare evidence jsonb;m jsonb;rules jsonb;f jsonb;fid text;accounting jsonb;delta numeric;cash numeric;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if at_time<=(ord->>'at')::timestamptz then raise exception 'Later observation required';end if;
 evidence:=neptune_v2_private.resolve_observation(obs);select value into m from jsonb_array_elements(evidence->'markets') where value->>'asset'=asset;
 if ord->>'side'='buy' then rules:=m->'metadata';else select payload->'verified_entry_rules' into rules from neptune_v2_private.positions where positions.asset=execute_native_fill.asset;end if;
 f:=neptune_v2_private.native_economics(asset,ord->>'side',qty,price,rules,evidence->'fx',case when neptune_v2_private.native_conversion_consumed(obs,neptune_v2_private.native_spec(asset)->>'quote',ord->>'side') then null else evidence#>array['quote_fx',(neptune_v2_private.native_spec(asset)->>'quote')||'/USD'] end,at_time,ord->>'side'='sell');
 if f is null then raise exception 'Prevalidated native economics unavailable';end if;
 select account.cash into cash from neptune_v2_private.account where id='neptune-paper-v2';
 if ord->>'side'='sell' and cash+coalesce((f->>'cash_delta_base')::numeric,0)>1000000000 then f:=neptune_v2_private.native_economics(asset,'sell',qty,price,rules,null,null,at_time,true);end if;
 fid:=md5('fill'||(ord->>'id'));
 f:=f||jsonb_build_object('id',fid,'order_id',ord->>'id','decision_id',ord->>'decision_id','observation_id',obs,'at',at_time,'side',ord->>'side','qty',qty,'qty_step',rules->'qty_step','verified_entry_rules',rules,'initial_risk_base',ord->'verified_risk_base','config_version','neptune-native-candidate-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1));
 delta:=(f->>'cash_delta_base')::numeric;
 insert into neptune_v2_private.fills values(fid,ord->>'id',obs,at_time,delta,f);
 insert into neptune_v2_private.order_events values(md5('filled'||fid),ord->>'id',obs,at_time,'filled',jsonb_build_object('fill_id',fid,'decision_id',ord->>'decision_id'));
 if delta is not null then
 update neptune_v2_private.account set cash=account.cash+delta where id='neptune-paper-v2' returning account.cash into cash;
 insert into neptune_v2_private.cash_ledger values(md5('cash'||fid),fid,at_time,delta,cash);
 end if;
 accounting:=neptune_v2_private.native_book_fill(fid);
 return f||jsonb_build_object('accounting',accounting);
end$$;
revoke all on function neptune_v2_private.instrument_depth(text,jsonb,numeric,text,jsonb),neptune_v2_private.instrument_value(text,numeric,numeric,text,jsonb,jsonb,jsonb,timestamptz),neptune_v2_private.net_owned_after_fee(text,numeric,jsonb),neptune_v2_private.canonical_exposure(text),neptune_v2_private.execute_native_fill(text,timestamptz,text,jsonb,numeric,numeric) from public,anon,authenticated,service_role;
create function neptune_v2_private.instrument_metadata_ok(m jsonb,a text,n timestamptz) returns boolean language plpgsql stable security invoker set search_path='' as $$begin
 if neptune_v2_private.native_spec(a) is null then return neptune_v2_private.metadata_ok(m,a,n);end if;
 return neptune_v2_private.native_identity(a,m->'metadata',n);
end$$;
create function neptune_v2_private.instrument_currency(a text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(a)->>'quote','USD')$$;
create or replace function neptune_v2_private.specialist_for_asset(asset text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(asset)->>'agent',case when asset='SOL/USD' then 'solana' when asset in ('ETH/USD','LINK/USD','AAVE/USD','UNI/USD') then 'ethereum' end)$$;
create function neptune_v2_private.native_target(asset text,book jsonb,stop numeric,m jsonb,fx jsonb,qfx jsonb,n timestamptz,grossqty numeric default 1) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare debit numeric;risk numeric;goal numeric;owned numeric;lo numeric;hi numeric;mid numeric;value numeric;price numeric;i integer;
begin
 price:=neptune_v2_private.instrument_depth(asset,book->'asks',grossqty,'buy',m);debit:=neptune_v2_private.instrument_value(asset,grossqty,price,'buy',m,fx,qfx,n);owned:=neptune_v2_private.net_owned_after_fee(asset,grossqty,m);
 risk:=debit-neptune_v2_private.instrument_value(asset,owned,stop*.9975,'sell',m,fx,qfx,n);if debit is null or risk is null or risk<=0 then return null;end if;goal:=debit+2*risk;
 lo:=(book->>'ask')::numeric;hi:=lo*2;
 for i in 1..20 loop value:=neptune_v2_private.instrument_value(asset,owned,hi*.9975,'sell',m,fx,qfx,n);if value is null then return null;end if;exit when value>=goal;hi:=hi*2;if hi>10000000 then return null;end if;end loop;
 if value<goal then return null;end if;
 for i in 1..50 loop mid:=(lo+hi)/2;value:=neptune_v2_private.instrument_value(asset,owned,mid*.9975,'sell',m,fx,qfx,n);if value is null then return null;end if;if value>=goal then hi:=mid;else lo:=mid;end if;end loop;
 return neptune_v2_private.native_price(asset,hi*1.000001,'buy',m);
end$$;
create function neptune_v2_private.native_pending_count() returns bigint language sql stable security invoker set search_path='' as $$select count(*) from neptune_v2_private.native_receivables r where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id)$$;
-- Audit-verified dust remains economic exposure despite its active-slot exception.
create function neptune_v2_private.native_dust_cost() returns numeric language sql stable security invoker set search_path='' as $$select coalesce(sum(i.cost_base),0) from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution la on la.fill_id=i.last_fill_id where i.qty>0 and i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' and not exists(select 1 from neptune_v2_private.positions p where p.asset=i.asset and (p.payload->>'qty')::numeric>0)$$;
revoke all on function neptune_v2_private.instrument_metadata_ok(jsonb,text,timestamptz),neptune_v2_private.instrument_currency(text),neptune_v2_private.native_target(text,jsonb,numeric,jsonb,jsonb,jsonb,timestamptz,numeric),neptune_v2_private.native_pending_count(),neptune_v2_private.native_dust_cost() from public,anon,authenticated,service_role;
-- Explicit eligibility proxy, NOT observed historical USD turnover.
-- 96 completed bars give a native-quote lower bound sum(baseVolume*barLow).
-- Normalize that bound with current adverse stablecoin/USD bid evidence.
create function neptune_v2_private.instrument_volume_reference(m jsonb,a text,qfx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare bars jsonb;v jsonb;total numeric:=0;countbars integer:=0;conversion jsonb;t numeric;
begin
 if neptune_v2_private.native_spec(a) is null then return neptune_v2_private.num(m->>'volume_24h_usd');end if;
 if jsonb_typeof(m->'bars') is distinct from 'array' then return null;end if;
 for v in select value from jsonb_array_elements(m->'bars') order by (value->>'t')::numeric desc limit 96 loop
 t:=neptune_v2_private.num(v->>'t');if t is null or to_timestamp(t/1000)+interval '15 minutes'>n or neptune_v2_private.num(v->>'v') is null or neptune_v2_private.num(v->>'l') is null then return null;end if;
 total:=total+(v->>'v')::numeric*(v->>'l')::numeric;countbars:=countbars+1;
 end loop;
 if countbars<>96 then return null;end if;
 conversion:=neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(a),1,'sell',qfx->(neptune_v2_private.instrument_currency(a)||'/USD'),n);
 return total*(conversion->>'applied_usd_per_quote')::numeric;
exception when others then return null;
end$$;
create function neptune_v2_private.instrument_quote_reference(a text,amount numeric,qfx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$declare c jsonb;begin
 if neptune_v2_private.native_spec(a) is null then return amount;end if;
 c:=neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(a),1,'sell',qfx->(neptune_v2_private.instrument_currency(a)||'/USD'),n);
 return amount*(c->>'applied_usd_per_quote')::numeric;
end$$;
create function neptune_v2_private.native_scan_reconcile() returns void language plpgsql security invoker set search_path='' as $$begin
 perform neptune_v2_private.native_reconcile();
 if exists(select 1 from neptune_v2_private.native_inventory i left join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id left join neptune_v2_private.fills f on f.id=i.last_fill_id where
 a.fill_id is null or i.agent_id is distinct from neptune_v2_private.native_spec(i.asset)->>'agent' or i.canonical_exposure is distinct from neptune_v2_private.canonical_exposure(i.asset)
 or i.agent_id is distinct from a.agent_id or i.asset is distinct from a.asset or i.qty_step is distinct from neptune_v2_private.num(f.payload->>'qty_step')) then raise exception 'Native immutable instrument identity mismatch';end if;
 if exists(select 1 from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id where i.qty>0 and not exists(select 1 from neptune_v2_private.positions p where p.asset=i.asset and neptune_v2_private.num(p.payload->>'qty')=i.qty and neptune_v2_private.num(p.payload->>'cost_base')=i.cost_base and neptune_v2_private.num(p.payload->>'initial_risk_base')=i.risk_base and p.payload->>'quote_currency'=neptune_v2_private.instrument_currency(i.asset) and p.payload->>'venue'=neptune_v2_private.native_spec(i.asset)->>'venue' and neptune_v2_private.num(p.payload#>>'{verified_entry_rules,qty_step}')=i.qty_step and neptune_v2_private.native_identity(i.asset,p.payload->'verified_entry_rules',clock_timestamp(),false))
 and not(i.qty<i.qty_step and a.accounting->>'verified_fee_dust'='true')) then raise exception 'Unmatched ordinary native inventory';end if;
 if exists(select 1 from neptune_v2_private.positions p where neptune_v2_private.native_spec(p.asset) is not null and neptune_v2_private.num(p.payload->>'qty')>0 and not exists(select 1 from neptune_v2_private.native_inventory i where i.asset=p.asset and i.qty=neptune_v2_private.num(p.payload->>'qty'))) then raise exception 'Native position without inventory';end if;
end$$;
revoke all on function neptune_v2_private.instrument_volume_reference(jsonb,text,jsonb,timestamptz),neptune_v2_private.instrument_quote_reference(text,numeric,jsonb,timestamptz),neptune_v2_private.native_scan_reconcile() from public,anon,authenticated,service_role;
-- Reserve a full lot's value for conservative received-fee/dust quantization.
-- Exact full-size risk is independently rechecked after this initial sizing.
create function neptune_v2_private.native_size(budget numeric,unitdebit numeric,unitrisk numeric,unitloss numeric,m jsonb,dustcost numeric default 0) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare step numeric:=neptune_v2_private.num(m->>'qty_step');risk_cash numeric;notional_cash numeric;
begin
 if budget is null or budget<=0 or unitdebit is null or unitdebit<=0 or unitrisk is null or unitrisk<=0 or unitloss is null or unitloss<0 or step is null or step<=0 then return 0;end if;
 risk_cash:=greatest(0,budget*.0025-unitdebit*step*1.0025-dustcost);
 notional_cash:=greatest(0,budget*.1-unitdebit*step*.1-dustcost);
 return floor(least(risk_cash/(unitrisk+.0025*unitloss),notional_cash/(unitdebit+.1*unitloss))/step)*step;
end$$;
revoke all on function neptune_v2_private.native_size(numeric,numeric,numeric,numeric,jsonb,numeric) from public,anon,authenticated,service_role;
-- Persisted rules may bridge a metadata outage, never override fresh contradictory rules.
create function neptune_v2_private.native_rule_conflict(a text,current_rules jsonb,n timestamptz) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare held jsonb;k text;begin
 if neptune_v2_private.native_spec(a) is null or current_rules is null then return false;end if;
 select payload->'verified_entry_rules' into held from neptune_v2_private.positions where asset=a and neptune_v2_private.num(payload->>'qty')>0;
 if held is null then return false;end if;
 if neptune_v2_private.ts(current_rules->>'at')>n then return true;end if;
 if not neptune_v2_private.fresh(current_rules->>'at',n,86400) then return false;end if;
 if not neptune_v2_private.native_identity(a,current_rules,n) then return true;end if;
 foreach k in array array['venue','venue_id','instrument','asset','base','quote','status','kind','min_qty','max_qty','min_cost','qty_step','qty_decimals','price_decimals','tick_size','fee_qty_decimals','rules','instrument_identity'] loop
 if current_rules->k is distinct from held->k then return true;end if;end loop;
 return false;
end$$;
revoke all on function neptune_v2_private.native_rule_conflict(text,jsonb,timestamptz) from public,anon,authenticated,service_role;


-- native-public-projection.sql
-- Read-only public projection. Scanner owns all root accounting mutations.
-- Load after native ledger, economics and scanner helpers. No grants or live writes.
create or replace function neptune_v2_private.native_public_projection(report jsonb,books jsonb,fx jsonb,quote_fx jsonb,at_time timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb:=report;inv record;row jsonb;positions jsonb:='[]';balances jsonb;recent jsonb;specialists jsonb;rows jsonb:='[]';p jsonb;b jsonb;m jsonb;spec jsonb;source jsonb;source_id text;rules jsonb;
 mark numeric;price numeric;legacy_mark numeric:=0;native_mark numeric:=0;legacy_ok boolean:=true;native_ok boolean:=true;can_mark boolean;dust boolean;fees_ok boolean;pending boolean;ready boolean;exposure numeric;agent text;asset_key text;
begin
 if at_time is null then raise exception 'Captured projection time required';end if;
 can_mark:=coalesce(neptune_v2_private.fresh(report#>>'{account,valuation_at}',at_time,90),false);
 -- Source identity is resolved from immutable observation evidence, never from a display label.
 select case when count(*)=1 then min(id) end into source_id from neptune_v2_private.observations where at=at_time;
 if source_id is not null then source:=neptune_v2_private.resolve_observation(source_id);end if;
 for inv in select i.*,a.accounting,f.payload fill_payload from neptune_v2_private.native_inventory i
 join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id join neptune_v2_private.fills f on f.id=a.fill_id where i.qty>0 order by i.asset loop
 spec:=neptune_v2_private.native_spec(inv.asset);b:=books->inv.asset;mark:=null;
 select payload into p from neptune_v2_private.positions where asset=inv.asset;
 rules:=coalesce(p->'verified_entry_rules',inv.fill_payload->'verified_entry_rules');
 select value into m from jsonb_array_elements(coalesce(source->'markets','[]')) where value->>'asset'=inv.asset;
 dust:=coalesce(inv.qty<inv.qty_step and inv.accounting->>'verified_fee_dust'='true' and inv.cost_base>0 and inv.accounting->>'inventory_cycle_id' is not null,false);
 if can_mark and dust then mark:=0;
 elsif can_mark and spec is not null and neptune_v2_private.native_identity(inv.asset,m->'metadata',at_time) and b=neptune_v2_private.book(m,at_time) and not(b?'error') then
 price:=neptune_v2_private.instrument_depth(inv.asset,b->'bids',inv.qty,'sell',rules);
 mark:=neptune_v2_private.instrument_value(inv.asset,inv.qty,price,'sell',rules,fx,quote_fx,at_time);
 end if;
 if mark is null then native_ok:=false;else native_mark:=native_mark+mark;end if;
 row:=jsonb_build_object('asset',inv.asset,'agent_id',inv.agent_id,'venue',spec->>'venue','base',spec->>'base','quote_currency',spec->>'quote','owned_qty',inv.qty,'sellable_qty',floor(inv.qty/inv.qty_step)*inv.qty_step,'dust_qty',inv.qty-floor(inv.qty/inv.qty_step)*inv.qty_step,'qty_step',inv.qty_step,'cost_base',inv.cost_base,'initial_risk_base',inv.risk_base,'mark_base',mark,'position_status',case when inv.qty<inv.qty_step then 'dust_held' else 'open' end,'verified_fee_dust',dust,'valuation_basis',case when dust then 'non_executable_conservative_floor' else 'native_executable_depth_net_fees_and_adverse_fx' end,'liquidation_floor_base',case when dust then 0 end,'conservative_risk_base',case when dust then inv.cost_base else inv.risk_base end,'inventory_cycle_id',inv.accounting->>'inventory_cycle_id','last_fill_id',inv.last_fill_id);
 positions:=positions||jsonb_build_array(row);
 end loop;
 if jsonb_array_length(positions)<>(select count(*) from neptune_v2_private.native_inventory where qty>0) then native_ok:=false;end if;
 select coalesce(jsonb_agg(jsonb_build_object('agent_id',x.agent_id,'currency',x.currency,'amount',x.amount,'mark_base',null) order by x.agent_id,x.currency),'[]') into balances from
 (select a.agent_id,r.currency,sum(r.amount) amount from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id) group by a.agent_id,r.currency) x;
 if jsonb_array_length(balances)>0 then native_ok:=false;end if;
 -- Compute legacy independently: never derive this subtotal by subtracting native values from root equity.
 for p in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 and neptune_v2_private.native_spec(asset) is null loop
 b:=books->(p->>'asset');mark:=null;
 if can_mark and b is not null and not(b?'error') and neptune_v2_private.fresh(b->>'at',at_time,30) then
 price:=neptune_v2_private.instrument_depth(p->>'asset',b->'bids',(p->>'qty')::numeric,'sell',p);
 mark:=neptune_v2_private.instrument_value(p->>'asset',(p->>'qty')::numeric,price,'sell',p,fx,quote_fx,at_time);
 end if;
 if mark is null then legacy_ok:=false;else legacy_mark:=legacy_mark+mark;end if;
 end loop;
 select coalesce(jsonb_agg(x.row order by x.at desc,x.id desc),'[]') into recent from (
 select f.id,f.at,jsonb_build_object('id',f.id,'at',f.at,'asset',a.asset,'venue',f.payload->>'venue','side',a.side,'quote_currency',a.currency,'gross_qty',a.gross_qty,'fee_qty',a.fee_qty,'fee_quote',a.fee_quote,'fee_currency',f.payload->>'fee_currency','net_inventory_delta',a.inventory_delta,'net_quote_delta',a.net_quote,'cash_delta_base',case when s.id is not null then s.payload->'cash_delta_base' else f.payload->'cash_delta_base' end,'fee_base',case when s.id is not null then s.payload->'fee_base' else f.payload->'fee_base' end,'fx_cost_base',case when s.id is not null then s.payload->'fx_cost_base' else f.payload->'fx_cost_base' end,'position_status',a.accounting->>'position_status','settlement_status',case when s.id is not null then 'settled' else f.payload->>'settlement_status' end,'at_fill_settlement_status',f.payload->>'settlement_status','settled_at',case when s.id is not null then s.at end) row
 from neptune_v2_private.native_fill_attribution a join neptune_v2_private.fills f on f.id=a.fill_id left join neptune_v2_private.native_settlement_attribution sa on sa.exit_fill_id=f.id left join neptune_v2_private.settlements s on s.id=sa.settlement_id and s.exit_fill_id=sa.exit_fill_id where f.at<=at_time order by f.at desc,f.id desc limit 50) x;
 fees_ok:=jsonb_array_length(balances)=0 and coalesce(neptune_v2_private.num(report#>>'{account,unsettled_usd}')=0,false);
 r:=jsonb_set(r,'{account}',(r->'account')||jsonb_build_object('valuation_scope','combined_native_v1','fees_complete',fees_ok,'recorded_fees',coalesce(neptune_v2_private.num(r#>>'{account,fees}'),neptune_v2_private.num(r#>>'{account,recorded_fees}')),'recorded_fx_costs',coalesce(neptune_v2_private.num(r#>>'{account,fx_costs}'),neptune_v2_private.num(r#>>'{account,recorded_fx_costs}')),'fees',case when fees_ok then coalesce(neptune_v2_private.num(r#>>'{account,fees}'),neptune_v2_private.num(r#>>'{account,recorded_fees}')) end,'fx_costs',case when fees_ok then coalesce(neptune_v2_private.num(r#>>'{account,fx_costs}'),neptune_v2_private.num(r#>>'{account,recorded_fx_costs}')) end));
 if not(can_mark and native_ok and legacy_ok) or abs(coalesce(neptune_v2_private.num(r#>>'{account,equity}'),-1)-coalesce(neptune_v2_private.num(r#>>'{account,cash}'),-2)-legacy_mark-native_mark)>.000001 then
 r:=jsonb_set(r,'{account}',(r->'account')||jsonb_build_object('equity',null,'unrealized_pnl',null,'valuation_at',null));can_mark:=false;
 r:=r||jsonb_build_object('status',case when r->>'status'='running' then 'data_missing' else r->>'status' end,'scan_complete',false);
 r:=jsonb_set(r,'{risk}',coalesce(r->'risk','{}')||jsonb_build_object('entry_paused',true,'pause_reason',coalesce(r#>>'{risk,pause_reason}','combined_valuation_unavailable')));
 end if;
 r:=r||jsonb_build_object('history_schema_version',3,'history_reader_min_version',3,'native_paper',jsonb_build_object('version',1,'mode','PAPER','observed_at',at_time,'valuation_at',case when can_mark and native_ok and legacy_ok then report#>'{account,valuation_at}' end,'valuation_complete',can_mark and native_ok and legacy_ok,'history_complete',false,'legacy_mark_base',case when legacy_ok then legacy_mark end,'positions',positions,'pending_quote_balances',balances,'recent_fills',recent));
 specialists:=neptune_v2_private.specialist_projection(r);
 for row in select value from jsonb_array_elements(specialists->'accounts') loop
 agent:=row->>'id';
 if agent in ('binance','hyperliquid') and specialists->>'allocation_status'='allocated' then
 asset_key:=case when agent='binance' then 'binance:SOLUSDT' else 'hyperliquid:@107' end;b:=books->asset_key;
 select value into m from jsonb_array_elements(coalesce(source->'markets','[]')) where value->>'asset'=asset_key;
 ready:=coalesce(neptune_v2_private.native_identity(asset_key,m->'metadata',at_time) and b=neptune_v2_private.book(m,at_time) and not(b?'error') and neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(asset_key),1,'buy',quote_fx->(neptune_v2_private.instrument_currency(asset_key)||'/USD'),at_time) is not null and fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and neptune_v2_private.num(fx->>'rate') between .25 and 5 and neptune_v2_private.fresh(fx->>'at',at_time,345600) and neptune_v2_private.fresh(fx->>'fetched_at',at_time,3600),false);
 if report#>>'{native_feed,feed_terminal}'='true' or report#>array['native_feed','provider_blocked',agent] is not null then ready:=false;end if;
 pending:=exists(select 1 from jsonb_array_elements(balances) v where v->>'agent_id'=agent);
 select case when pending or not can_mark or exists(select 1 from jsonb_array_elements(positions) v where v->>'agent_id'=agent and v->'mark_base'='null'::jsonb) then null else coalesce(sum((v->>'mark_base')::numeric),0) end into exposure from jsonb_array_elements(positions) v where v->>'agent_id'=agent;
 row:=row||jsonb_build_object('exposure_base',exposure,'costs_base',case when not pending then row->'costs_base' end,'realized_pnl',case when not pending then row->'realized_pnl' end,'source_venue',agent,'execution_kind','native_spot_paper','readiness_reason',case when report#>>'{native_feed,feed_terminal}'='true' then 'Native feed frozen: '||coalesce(report#>>'{native_feed,reason}','bounded collector unavailable') when report#>array['native_feed','provider_blocked',agent] is not null then 'Provider unavailable: '||coalesce(report#>>array['native_feed','provider_blocked',agent,'reason'],'public feed blocked') when ready then 'Exact native spot instrument and public conversion evidence verified; paper simulation only' else 'Awaiting verified exact native spot and conversion evidence' end,'status',case when report->>'status' in ('stopped','paused','error','storage_paused') then 'stopped' when ready and r->>'status'='running' and r->>'scan_complete'='true' and neptune_v2_private.fresh(r->>'scan_at',at_time,90) and exists(select 1 from neptune_v2_private.account a where a.id='neptune-paper-v2' and a.state->>'enabled'='true') then 'paper_active' else 'waiting_for_data' end,'evidence_at',case when ready then at_time end);
 end if;rows:=rows||jsonb_build_array(row);
 end loop;
 r:=r||jsonb_build_object('native_model',neptune_v2_private.native_model()||jsonb_build_object('binance_taker_pct',0.1,'hyperliquid_spot_taker_pct',0.07,'fees_are_modeled',true,'hyperliquid_buy_fee_currency_basis','official-documentation-supported received-asset inference','synthetic_conversion_excludes_transfers',true),'cost_model',coalesce(r->'cost_model','{}'::jsonb)||jsonb_build_object('scope','Kraken USD spot only; native model reported separately'));
 return r||jsonb_build_object('specialist_accounts',specialists||jsonb_build_object('observed_at',at_time,'accounts',rows));
end$$;

-- Daily native cash-flow recognition requires immutable attribution.
create or replace function neptune_v2_private.perth_daily_performance(report jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n timestamptz:=clock_timestamp();d date:=(n at time zone 'Australia/Perth')::date;mark neptune_v2_private.perth_daily_marks;
 v numeric:=neptune_v2_private.num(report#>>'{account,equity}');t timestamptz:=neptune_v2_private.ts(report#>>'{account,valuation_at}');rev bigint;
 good boolean;unknown_flow boolean:=false;reason text;out jsonb;
begin
 select revision into rev from neptune_v2_private.account where id='neptune-paper-v2';
 good:=coalesce(report->>'mode'='PAPER' and report->>'currency'='AUD' and v>=0 and v<1000000000 and neptune_v2_private.fresh(t::text,n,90) and (t at time zone 'Australia/Perth')::date=d,false);
 if good and v>0 then
 insert into neptune_v2_private.perth_daily_marks values(d,t,v,(select coalesce(max(seq),0) from public.neptune_paper_v2_history),rev) on conflict(day) do nothing;
 end if;
 select * into mark from neptune_v2_private.perth_daily_marks where day=d;
 if mark.day is not null then
 -- Existing engine supports no external cash movement. Recognize only exact
 -- source fill/settlement ledger deltas. Unknown rows block return, never assume
 -- a deposit is profit or silently set its cash-flow adjustment to zero.
 select exists(select 1 from public.neptune_paper_v2_history h join neptune_v2_private.cash_ledger l on h.kind='cash_ledger' and h.id=l.id
 where h.seq>mark.history_seq and not exists(select 1 from neptune_v2_private.fills f where f.id=l.fill_id and f.cash_delta=l.delta)
 and not exists(select 1 from neptune_v2_private.settlements st where neptune_v2_private.native_spec(st.payload->>'asset') is null and l.id=md5('settlecash'||st.exit_fill_id) and (st.payload->>'cash_delta_base')::numeric=l.delta)
 and not exists(select 1 from neptune_v2_private.native_settlement_attribution sa join neptune_v2_private.settlements st on st.id=sa.settlement_id and st.exit_fill_id=sa.exit_fill_id join neptune_v2_private.native_receivables nr on nr.exit_fill_id=sa.exit_fill_id join neptune_v2_private.native_fill_attribution na on na.fill_id=sa.exit_fill_id join neptune_v2_private.fills nf on nf.id=na.fill_id where na.side='sell' and na.cash_delta is null and nf.cash_delta is null and nr.currency=na.currency and nr.amount=na.net_quote and st.at>nf.at and l.delta>0 and st.payload->>'asset'=na.asset and l.id=md5('native-settle-cash'||sa.exit_fill_id) and l.fill_id is null and l.at=st.at and st.payload->>'settlement_status'='settled' and st.payload->>'observation_id'=sa.observation_id and st.payload->>'quote_currency'=nr.currency and (st.payload->>'quote_amount')::numeric=nr.amount and (st.payload->>'cash_delta_base')::numeric=l.delta)) into unknown_flow;
 end if;
 reason:=case when mark.day is null then 'Awaiting first valid equity observation today' when not good then 'Current equity observation missing or stale' when t<mark.at then 'Observation predates daily baseline' when unknown_flow then 'Unclassified cash movement; daily return unavailable' end;
 out:=jsonb_build_object('timezone','Australia/Perth','day',d,'coverage','since_first_observation','baseline_at',mark.at,'baseline_equity',mark.equity,
 'source_revision',rev,'observed_at',case when good then t end,'current_equity',case when good then v end,
 'status',case when reason is null then 'available' else 'unavailable' end,'reason',reason,
 'net_external_flows',case when mark.day is not null and not unknown_flow then 0 end,
 'net_pnl',case when reason is null then v-mark.equity end,'pct',case when reason is null then (v-mark.equity)/mark.equity*100 end);
 return out;
end$$;
revoke all on function neptune_v2_private.native_public_projection(jsonb,jsonb,jsonb,jsonb,timestamptz),neptune_v2_private.perth_daily_performance(jsonb) from public,anon,authenticated,service_role;


-- native-collector.sql
-- ISOLATED CANDIDATE: no grants, seed, cron, external calls during installation, or engine edits.
-- All functions are invoker-only. Integration must call dispatch/collect under the existing
-- collector lock AFTER legacy exits. Tables and helper routines are inaccessible to clients.
create schema neptune_mv_private;
revoke all on schema neptune_mv_private from public,anon,authenticated,service_role;
create function neptune_mv_private.num(s text) returns numeric language plpgsql immutable set search_path='' as $$
begin if s is null or length(s)>48 or s !~ '^[0-9]+(\.[0-9]{1,18})?$' then return null;end if;return s::numeric;exception when others then return null;end$$;
create function neptune_mv_private.ms(t timestamptz) returns bigint language sql immutable set search_path='' as $$select floor(extract(epoch from t)*1000)::bigint$$;
create function neptune_mv_private.limit_bytes(k text) returns int language sql immutable set search_path='' as $$select case k when 'metadata' then 1048576 when 'bars' then 65536 when 'trades' then 131072 when 'depth' then 32768 when 'fx' then 8192 when 'avg_price' then 8192 else 0 end$$;

-- Held-source checks are identity-only; execution and dust rules remain owned by the ledger.
create function neptune_mv_private.exact_identity(v text,m jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if m is null or m->>'venue' is distinct from v or m->>'kind' is distinct from 'spot' or coalesce(m->>'revision','') !~ '^[0-9a-f]{64}$' or m->>'at' is null then return false;end if;
 if v='binance' then return coalesce(m->>'asset'='binance:SOLUSDT' and m->>'instrument'='binance:SOLUSDT' and m->>'venue_id'='SOLUSDT' and m->>'base'='SOL' and m->>'quote'='USDT' and m->>'source'='https://data-api.binance.vision/api/v3/exchangeInfo?symbol=SOLUSDT' and m#>>'{instrument_identity,symbol}'='SOLUSDT' and m#>>'{instrument_identity,base}'='SOL' and m#>>'{instrument_identity,quote}'='USDT' and m#>>'{instrument_identity,isSpotTradingAllowed}'='true',false);
 elsif v='hyperliquid' then return coalesce(m->>'asset'='hyperliquid:@107' and m->>'instrument'='hyperliquid:@107' and m->>'venue_id'='@107' and m->>'base'='HYPE' and m->>'quote'='USDC' and m->>'source'='https://api.hyperliquid.xyz/info' and m#>>'{instrument_identity,universe_index}'='107' and m#>>'{instrument_identity,base_token_index}'='150' and m#>>'{instrument_identity,quote_token_index}'='0' and m#>>'{instrument_identity,base_token_id}'='0x0d01dc56dcaaca66ad901c959b4011ec' and m#>>'{instrument_identity,quote_token_id}'='0x6d1e7cde53ba9467b783cb7c530ce054',false);
 end if;return false;
end$$;
create function neptune_mv_private.held_metadata(v text) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb;a text:=case v when 'binance' then 'binance:SOLUSDT' when 'hyperliquid' then 'hyperliquid:@107' end;
begin
 if a is null then return null;end if;
 select payload->'verified_entry_rules' into m from neptune_v2_private.positions where asset=a and case when jsonb_typeof(payload->'qty')='number' then (payload->>'qty')::numeric>0 else false end;
 if not neptune_mv_private.exact_identity(v,m) then return null;end if;return m;
exception when undefined_table or invalid_schema_name then return null;
end$$;
create function neptune_mv_private.identity_conflict(v text,raw text) returns boolean language plpgsql immutable set search_path='' as $$
declare j jsonb:=raw::jsonb;p jsonb;b jsonb;q jsonb;
begin
 if v='binance' and jsonb_typeof(j->'symbols')='array' then
  if jsonb_array_length(j->'symbols')<>1 then return true;end if;
  p:=j#>'{symbols,0}';return (p->>'status' is not null and p->>'status'<>'TRADING') or p->'isSpotTradingAllowed'='false'::jsonb or p->>'symbol' is distinct from 'SOLUSDT' or p->>'baseAsset' is distinct from 'SOL' or p->>'quoteAsset' is distinct from 'USDT';
 elsif v='hyperliquid' and jsonb_typeof(j->'universe')='array' and jsonb_typeof(j->'tokens')='array' then
  if (select count(*) from jsonb_array_elements(j->'universe') e where e->>'index'='107')<>1 then return true;end if;
  select value into p from jsonb_array_elements(j->'universe') where value->>'index'='107';
  if p->>'name' is distinct from '@107' or p->'tokens' is distinct from '[150,0]'::jsonb then return true;end if;
  if (select count(*) from jsonb_array_elements(j->'tokens') e where e->>'index'='150')<>1 or (select count(*) from jsonb_array_elements(j->'tokens') e where e->>'index'='0')<>1 then return true;end if;
  select value into b from jsonb_array_elements(j->'tokens') where value->>'index'='150';select value into q from jsonb_array_elements(j->'tokens') where value->>'index'='0';
  return b->>'name' is distinct from 'HYPE' or b->>'tokenId' is distinct from '0x0d01dc56dcaaca66ad901c959b4011ec' or q->>'name' is distinct from 'USDC' or q->>'tokenId' is distinct from '0x6d1e7cde53ba9467b783cb7c530ce054';
 end if;return false;
exception when others then return false;
end$$;

create function neptune_mv_private.provider(v text) returns text language sql immutable set search_path='' as $$select case when v in ('USDT','USDC') then 'kraken' when v in ('binance','hyperliquid') then v end$$;
create function neptune_mv_private.provider_failure(status integer,headers jsonb,n timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare raw text:=coalesce(headers->>'retry-after',headers->>'Retry-After');until_at timestamptz;
begin
 if status=429 and raw is not null then
  begin
   if raw ~ '^[0-9]{1,9}$' then until_at:=n+make_interval(secs=>greatest(raw::integer,60));
   elsif raw ~ '^[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$' then until_at:=greatest(raw::timestamptz,n+interval '60 seconds');end if;
  exception when others then until_at:=null;end;
 end if;
 return jsonb_build_object('status',status,'reason',case when status=429 then 'rate_limited' else 'access_denied' end,'blocked_at',n,'retry_after',raw,'blocked_until',until_at,'permanent',until_at is null);
end$$;

-- Decimal strings preserve numeric precision for cross-language consumers.
create function neptune_mv_private.parse(v text,k text,raw text,received timestamptz,cutoff timestamptz,meta jsonb default null,protective boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare j jsonb;p jsonb;b jsonb;q jsonb;x jsonb;f jsonb;out jsonb:='{}';arr jsonb;levels jsonb;side int;px numeric;sz numeric;prev numeric;t numeric;last_t numeric;lo numeric;hi numeric;op numeric;cl numeric;vol numeric:=0;quotevol numeric:=0;lowerquote numeric:=0;cnt int:=0;id text;quote text;lot jsonb;pricefilter jsonb;notional jsonb;marketlot jsonb;upper_ms bigint:=neptune_mv_private.ms(cutoff);received_ms bigint:=neptune_mv_private.ms(received);window_ms bigint:=floor(neptune_mv_private.ms(received)/900000)*900000;rules jsonb;
begin
 if v is null or v not in ('binance','hyperliquid','USDT','USDC') or received is null or cutoff is null or received>cutoff or received<cutoff-interval '30 seconds' or raw is null or octet_length(raw)>neptune_mv_private.limit_bytes(k) then return null;end if;
 j:=raw::jsonb;
 if v in ('USDT','USDC') then
  if j->'error' is distinct from '[]'::jsonb or jsonb_typeof(j->'result') is distinct from 'object' then return null;end if;
  if (select count(*) from jsonb_object_keys(j->'result'))<>1 then return null;end if;
  p:=j->'result'->(v||'/USD');
  if k='metadata' then
   if p->>'wsname' is distinct from v||'/USD' or p->>'altname' is distinct from v||'USD' or p->>'base' is distinct from v or p->>'quote' is distinct from 'USD' or p->>'status' is distinct from 'online' or p->>'lot' is distinct from 'unit' or neptune_mv_private.num(p->>'lot_multiplier') is distinct from 1 or coalesce(neptune_mv_private.num(p->>'ordermin'),0)<=0 or coalesce(neptune_mv_private.num(p->>'costmin'),0)<=0 or coalesce(neptune_mv_private.num(p->>'tick_size'),0)<=0 or coalesce(neptune_mv_private.num(p->>'lot_decimals'),-1) not between 0 and 12 or neptune_mv_private.num(p->>'lot_decimals')<>floor(neptune_mv_private.num(p->>'lot_decimals')) then return null;end if;
   return jsonb_build_object('instrument','kraken:'||v||'/USD','asset',v||'/USD','source','https://api.kraken.com/0/public/AssetPairs','status','online','venue','kraken','kind','spot','base',v,'quote','USD','venue_id',v||'/USD','at',received,'min_qty',p->>'ordermin','min_cost',p->>'costmin','tick_size',p->>'tick_size','qty_decimals',p->'lot_decimals','raw_rules',p,'revision',encode(sha256(convert_to(raw,'UTF8')),'hex'));
  end if;
  if k<>'fx' or meta->>'kind' is distinct from 'spot' or meta->>'quote' is distinct from 'USD' or meta->>'base' is distinct from v or meta->>'instrument' is distinct from 'kraken:'||v||'/USD' or (meta->>'at')::timestamptz is null or (meta->>'at')::timestamptz not between cutoff-interval '1 hour' and received then return null;end if;
  for side in 0..1 loop
   levels:=p->(case side when 0 then 'bids' else 'asks' end);
   if jsonb_typeof(levels) is distinct from 'array' or jsonb_array_length(levels) not between 1 and 20 then return null;end if;arr:='[]';prev:=null;
   for x in select value from jsonb_array_elements(levels) loop
    if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>3 then return null;end if;
    px:=neptune_mv_private.num(x->>0);sz:=neptune_mv_private.num(x->>1);t:=neptune_mv_private.num(x->>2);
    if px is null or sz is null or px<=0 or sz<=0 or t is null or t<=0 or t*1000>received_ms or (prev is not null and ((side=0 and px>=prev) or (side=1 and px<=prev))) then return null;end if;
    arr:=arr||jsonb_build_array(jsonb_build_array(px::text,sz::text,t));prev:=px;
   end loop;out:=out||jsonb_build_object(case side when 0 then 'bids' else 'asks' end,arr);
  end loop;
  if (out#>>'{bids,0,0}')::numeric>=(out#>>'{asks,0,0}')::numeric then return null;end if;
  return jsonb_build_object('asset',v||'/USD','base',v,'quote','USD','book',out||jsonb_build_object('at',received,'timestamp_basis','http_response_observed','level_timestamp_basis','last_level_modification'),'received_at',received,'metadata',meta,'basis','observed_size_limited_depth','peg_assumed',false);
 end if;
 if v not in ('binance','hyperliquid') then return null;end if;
 id:=case v when 'binance' then 'binance:SOLUSDT' else 'hyperliquid:@107' end;quote:=case v when 'binance' then 'USDT' else 'USDC' end;
 if k='metadata' then
  if v='binance' then
   if jsonb_typeof(j->'symbols') is distinct from 'array' or jsonb_array_length(j->'symbols')<>1 then return null;end if;p:=j#>'{symbols,0}';
   if p->>'symbol' is distinct from 'SOLUSDT' or p->>'baseAsset' is distinct from 'SOL' or p->>'quoteAsset' is distinct from 'USDT' or p->>'status' is distinct from 'TRADING' or p->'isSpotTradingAllowed' is distinct from 'true'::jsonb then return null;end if;
   if jsonb_typeof(p->'filters') is distinct from 'array' then return null;end if;
   if (select count(*) from jsonb_array_elements(p->'filters') e where e->>'filterType'='LOT_SIZE')<>1 or (select count(*) from jsonb_array_elements(p->'filters') e where e->>'filterType'='PRICE_FILTER')<>1 then return null;end if;
   select value into lot from jsonb_array_elements(p->'filters') where value->>'filterType'='LOT_SIZE';select value into pricefilter from jsonb_array_elements(p->'filters') where value->>'filterType'='PRICE_FILTER';
   select value into marketlot from jsonb_array_elements(p->'filters') where value->>'filterType'='MARKET_LOT_SIZE';
   select value into notional from jsonb_array_elements(p->'filters') where value->>'filterType' in ('NOTIONAL','MIN_NOTIONAL') order by case value->>'filterType' when 'NOTIONAL' then 0 else 1 end limit 1;
   if not (coalesce(neptune_mv_private.num(lot->>'minQty'),0)>0 and coalesce(neptune_mv_private.num(lot->>'maxQty'),0)>=neptune_mv_private.num(lot->>'minQty') and coalesce(neptune_mv_private.num(lot->>'stepSize'),0)>0 and coalesce(neptune_mv_private.num(pricefilter->>'tickSize'),0)>0 and coalesce(neptune_mv_private.num(notional->>'minNotional'),0)>0) then return null;end if;
   rules:=jsonb_build_object('lot_size',lot,'market_lot_size',marketlot,'price_filter',pricefilter,'notional',notional,'all_filters',p->'filters','base_precision',p->'baseAssetPrecision','quote_precision',p->'quoteAssetPrecision','base_commission_precision',p->'baseCommissionPrecision','quote_commission_precision',p->'quoteCommissionPrecision','order_types',p->'orderTypes','validated_for_execution',false);
   if coalesce(neptune_mv_private.num(p->>'baseCommissionPrecision'),-1) not between 0 and 18 or coalesce(neptune_mv_private.num(p->>'quoteCommissionPrecision'),-1) not between 0 and 18 or neptune_mv_private.num(p->>'baseCommissionPrecision')<>floor(neptune_mv_private.num(p->>'baseCommissionPrecision')) or neptune_mv_private.num(p->>'quoteCommissionPrecision')<>floor(neptune_mv_private.num(p->>'quoteCommissionPrecision')) then return null;end if;
   out:=jsonb_build_object('base','SOL','quote','USDT','venue_id','SOLUSDT','min_qty',lot->>'minQty','qty_step',lot->>'stepSize','min_cost',notional->>'minNotional','tick_size',pricefilter->>'tickSize','qty_decimals',scale(trim_scale(neptune_mv_private.num(lot->>'stepSize'))),'price_decimals',scale(trim_scale(neptune_mv_private.num(pricefilter->>'tickSize'))),'base_fee_decimals',p->'baseCommissionPrecision','quote_fee_decimals',p->'quoteCommissionPrecision','fee_qty_decimals',jsonb_build_object('base',p->'baseCommissionPrecision','quote',p->'quoteCommissionPrecision'),'instrument_identity',jsonb_build_object('symbol','SOLUSDT','base','SOL','quote','USDT','isSpotTradingAllowed',true),'source','https://data-api.binance.vision/api/v3/exchangeInfo?symbol=SOLUSDT','rate_limits',j->'rateLimits');
  else
   if jsonb_typeof(j->'universe') is distinct from 'array' or jsonb_typeof(j->'tokens') is distinct from 'array' then return null;end if;
   -- Require a single exact mapping; never remap an ID from a familiar ticker.
   if (select count(*) from jsonb_array_elements(j->'universe') e where e->>'index'='107')<>1 then return null;end if;
   select value into p from jsonb_array_elements(j->'universe') where value->>'index'='107';
   if p->>'name' is distinct from '@107' or p->'tokens' is distinct from '[150,0]'::jsonb then return null;end if;
   if (select count(*) from jsonb_array_elements(j->'tokens') e where e->>'index'='150')<>1 or (select count(*) from jsonb_array_elements(j->'tokens') e where e->>'index'='0')<>1 then return null;end if;
   select value into b from jsonb_array_elements(j->'tokens') where value->>'index'='150';select value into q from jsonb_array_elements(j->'tokens') where value->>'index'='0';
   if b->>'name' is distinct from 'HYPE' or b->>'tokenId' is distinct from '0x0d01dc56dcaaca66ad901c959b4011ec' or q->>'name' is distinct from 'USDC' or q->>'tokenId' is distinct from '0x6d1e7cde53ba9467b783cb7c530ce054' then return null;end if;
   sz:=neptune_mv_private.num(b->>'szDecimals');if sz is null or sz<>floor(sz) or sz not between 0 and 8 then return null;end if;
   rules:=jsonb_build_object('sz_decimals',sz,'price_max_decimals',8-sz,'price_max_significant_figures',5,'integer_prices_allowed',true,'base_token',b,'quote_token',q,'min_notional','10','min_notional_currency','USDC','min_notional_source','https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses','validated_for_execution',false);
   if coalesce(neptune_mv_private.num(b->>'weiDecimals'),-1) not between 0 and 18 or coalesce(neptune_mv_private.num(q->>'weiDecimals'),-1) not between 0 and 18 or neptune_mv_private.num(b->>'weiDecimals')<>floor(neptune_mv_private.num(b->>'weiDecimals')) or neptune_mv_private.num(q->>'weiDecimals')<>floor(neptune_mv_private.num(q->>'weiDecimals')) then return null;end if;
   out:=jsonb_build_object('base','HYPE','quote','USDC','venue_id',p->>'name','base_id',b->>'tokenId','quote_id',q->>'tokenId','qty_step',power(10::numeric,-sz)::text,'qty_decimals',sz,'price_decimals',8-sz,'tick_size',null,'min_qty',power(10::numeric,-sz)::text,'min_cost','10','base_fee_decimals',b->'weiDecimals','quote_fee_decimals',q->'weiDecimals','fee_qty_decimals',jsonb_build_object('base',b->'weiDecimals','quote',q->'weiDecimals'),'instrument_identity',jsonb_build_object('coin','@107','universe_index',107,'base_token_index',150,'quote_token_index',0,'base_token_id',b->>'tokenId','quote_token_id',q->>'tokenId'),'source','https://api.hyperliquid.xyz/info');
  end if;
  return out||jsonb_build_object('instrument',id,'asset',id,'canonical_exposure_key',out->>'base','venue',v,'kind','spot','status','online','at',received,'rules',rules,'revision',encode(sha256(convert_to(raw,'UTF8')),'hex'));
 end if;
 if meta->>'asset' is distinct from id or meta->>'instrument' is distinct from id or meta->>'venue_id' is distinct from (case v when 'binance' then 'SOLUSDT' else '@107' end) or meta->>'kind' is distinct from 'spot' or meta->>'quote' is distinct from quote or (meta->>'at')::timestamptz is null or (meta->>'at')::timestamptz>received or ((meta->>'at')::timestamptz<cutoff-interval '1 hour' and not (protective and (k='depth' or (v='binance' and k='avg_price')) and neptune_mv_private.exact_identity(v,meta))) then return null;end if;
 if k='avg_price' then
  if v<>'binance' then return null;end if;
  px:=neptune_mv_private.num(j->>'price');sz:=neptune_mv_private.num(j->>'mins');t:=neptune_mv_private.num(j->>'closeTime');
  if px is null or px<=0 or sz is null or sz<>floor(sz) or t is null or t<>floor(t) or t>received_ms or t<upper_ms-60000 then return null;end if;
  cnt:=0;
  for f in select value from jsonb_array_elements(meta#>'{rules,all_filters}') where value->>'filterType' in ('PERCENT_PRICE','PERCENT_PRICE_BY_SIDE') loop
   if neptune_mv_private.num(f->>'avgPriceMins') is distinct from sz then return null;end if;cnt:=cnt+1;
  end loop;
  if cnt=0 then return null;end if;
  return jsonb_build_object('avg_price',jsonb_build_object('price',px::text,'mins',sz,'close_time_ms',t,'at',to_timestamp((t/1000)::double precision),'received_at',received,'source','https://data-api.binance.vision/api/v3/avgPrice?symbol=SOLUSDT'),'protective_only',protective,'metadata_stale',(meta->>'at')::timestamptz<cutoff-interval '1 hour','entry_eligible',false);
 end if;
 if k='depth' then
  if v='hyperliquid' and (j->>'coin' is distinct from '@107' or jsonb_array_length(j->'levels')<>2) then return null;end if;
  for side in 0..1 loop
   levels:=case when v='binance' then j->(case side when 0 then 'bids' else 'asks' end) else j->'levels'->side end;
   if jsonb_typeof(levels) is distinct from 'array' or jsonb_array_length(levels) not between 1 and 20 then return null;end if;arr:='[]';prev:=null;
   for x in select value from jsonb_array_elements(levels) loop
    if v='binance' then if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>2 then return null;end if;px:=neptune_mv_private.num(x->>0);sz:=neptune_mv_private.num(x->>1);
    else px:=neptune_mv_private.num(x->>'px');sz:=neptune_mv_private.num(x->>'sz');end if;
    if px is null or sz is null or px<=0 or sz<=0 or (prev is not null and ((side=0 and px>=prev) or (side=1 and px<=prev))) then return null;end if;
    arr:=arr||jsonb_build_array(jsonb_build_array(px::text,sz::text));prev:=px;
   end loop;out:=out||jsonb_build_object(case side when 0 then 'bids' else 'asks' end,arr);
  end loop;
  if (out#>>'{bids,0,0}')::numeric >= (out#>>'{asks,0,0}')::numeric then return null;end if;
  if v='hyperliquid' then t:=neptune_mv_private.num(j->>'time');if t is null or t<>floor(t) or t>received_ms or t<upper_ms-15000 then return null;end if;
  else t:=null;px:=neptune_mv_private.num(j->>'lastUpdateId');if px is null or px<>floor(px) or px<=0 then return null;end if;end if;
  return jsonb_build_object('book',out||jsonb_build_object('at',case when v='hyperliquid' then to_timestamp((t/1000)::double precision) else received end,'source_timestamp_ms',t,'sequence',case v when 'binance' then j->'lastUpdateId' else null end,'timestamp_basis',case v when 'binance' then 'http_response_observed' else 'venue_timestamp' end),'received_at',received,'protective_only',protective,'metadata_stale',(meta->>'at')::timestamptz<cutoff-interval '1 hour','entry_eligible',false);
 elsif k='bars' then
  if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j) not between 22 and 97 then return null;end if;arr:='[]';last_t:=null;
  for x in select value from jsonb_array_elements(j) loop
   if v='binance' then
    if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>12 then return null;end if;
    t:=neptune_mv_private.num(x->>0);px:=neptune_mv_private.num(x->>6);op:=neptune_mv_private.num(x->>1);hi:=neptune_mv_private.num(x->>2);lo:=neptune_mv_private.num(x->>3);cl:=neptune_mv_private.num(x->>4);sz:=neptune_mv_private.num(x->>5);prev:=neptune_mv_private.num(x->>7);
   else
    if x->>'s' is distinct from '@107' or x->>'i' is distinct from '15m' then return null;end if;
    t:=neptune_mv_private.num(x->>'t');px:=neptune_mv_private.num(x->>'T');op:=neptune_mv_private.num(x->>'o');hi:=neptune_mv_private.num(x->>'h');lo:=neptune_mv_private.num(x->>'l');cl:=neptune_mv_private.num(x->>'c');sz:=neptune_mv_private.num(x->>'v');prev:=null;
   end if;
   if t is null or mod(t,900000)<>0 or px is null or px<>t+899999 or t>received_ms or op is null or hi is null or lo is null or cl is null or sz is null or least(op,lo,cl)<=0 or hi<greatest(op,lo,cl) or lo>least(op,hi,cl) or (v='binance' and prev is null) then return null;end if;
   if t+900000>received_ms then continue;end if;
   if t<window_ms-86400000 then continue;end if;
   if last_t is not null and t<>last_t+900000 then return null;end if;last_t:=t;
   arr:=arr||jsonb_build_array(jsonb_build_object('t',t,'o',op::text,'h',hi::text,'l',lo::text,'c',cl::text,'v',sz::text,'quote_volume',prev::text));vol:=vol+sz;quotevol:=quotevol+coalesce(prev,0);lowerquote:=lowerquote+sz*lo;cnt:=cnt+1;
  end loop;
  if cnt<22 or last_t<>window_ms-900000 then return null;end if;
  return jsonb_build_object('bars',arr,'bars_completed_as_of',received,'volume_window_end_ms',window_ms,'volume_currency',meta->>'base','volume_24h_base',case when cnt=96 then vol::text else null end,'volume_24h_quote',case when cnt=96 and v='binance' then quotevol::text else null end,'volume_24h_quote_lower_bound',case when cnt=96 then lowerquote::text else null end,'volume_lower_bound_derivation','sum(completed_bar_base_volume * completed_bar_low), same96bar window','quote_currency',quote,'volume_window','96 completed 15m bars, not rolling ticker');
 elsif k='trades' then
  if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j) not between 1 and 200 then return null;end if;arr:='[]';last_t:=0;
  for x in select value from jsonb_array_elements(j) loop
   if v='binance' then px:=neptune_mv_private.num(x->>'price');sz:=neptune_mv_private.num(x->>'qty');
   else if x->>'coin' is distinct from '@107' then return null;end if;px:=neptune_mv_private.num(x->>'px');sz:=neptune_mv_private.num(x->>'sz');end if;
   t:=neptune_mv_private.num(x->>'time');if px is null or px<=0 or sz is null or sz<=0 or t is null or t<>floor(t) or t>received_ms or t<=0 then return null;end if;last_t:=greatest(last_t,t);
   arr:=arr||jsonb_build_array(jsonb_build_object('price',px::text,'base_qty',sz::text,'time_ms',t,'id',case v when 'binance' then x->'id' else x->'tid' end));
  end loop;
  return jsonb_build_object('trades',arr,'trade_at',to_timestamp((last_t/1000)::double precision),'trade_window_complete',false);
 end if;return null;
exception when others then return null;
end$$;

create table neptune_mv_private.control(id boolean primary key default true check(id),enabled boolean not null default false,contract_verified boolean not null default false,started_at timestamptz not null,entry_paused boolean not null default false,terminal boolean not null default false,reason text,last_epoch bigint,last_dispatch_at timestamptz,pending_epoch bigint,pending_owner_epoch bigint,pending_at timestamptz,batches int not null default 0,bytes_seen bigint not null default 0,provider_blocked jsonb not null default '{}',identity_blocked jsonb not null default '{}',metadata jsonb not null default '{}',check(octet_length(metadata::text)<=32768));
create table neptune_mv_private.requests(epoch bigint,kind text,venue text,request_id bigint unique,sent_at timestamptz not null,url text not null,body jsonb,metadata_revision text,protective_only boolean not null default false,held_rules_ref text,primary key(epoch,kind,venue));
create table neptune_mv_private.events(epoch bigint primary key,at timestamptz not null,owner_epoch bigint,outcome text not null,response_bytes bigint not null,missing_responses boolean not null,snapshot jsonb,check(octet_length(snapshot::text)<=262144));
create table neptune_mv_private.payload_blobs(id text primary key check(length(id)=64),kind text not null check(kind in ('bars','metadata')),payload jsonb not null,created_at timestamptz not null default clock_timestamp(),check(octet_length(payload::text)<=131072));
create function neptune_mv_private.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'append only';end$$;
create trigger immutable before update or delete on neptune_mv_private.requests for each row execute function neptune_mv_private.immutable();
create trigger immutable before update or delete on neptune_mv_private.events for each row execute function neptune_mv_private.immutable();
create trigger immutable_truncate before truncate on neptune_mv_private.requests for each statement execute function neptune_mv_private.immutable();
create trigger immutable_truncate before truncate on neptune_mv_private.events for each statement execute function neptune_mv_private.immutable();
create trigger immutable before update or delete on neptune_mv_private.payload_blobs for each row execute function neptune_mv_private.immutable();
create trigger immutable_truncate before truncate on neptune_mv_private.payload_blobs for each statement execute function neptune_mv_private.immutable();
alter table neptune_mv_private.payload_blobs enable row level security;
alter table neptune_mv_private.control enable row level security;alter table neptune_mv_private.requests enable row level security;alter table neptune_mv_private.events enable row level security;

-- Store immutable repeated candles/metadata once. Return payloads remain complete.
create function neptune_mv_private.pack(s jsonb) returns jsonb language plpgsql volatile set search_path='' as $$
declare out jsonb:=s;arr jsonb:='[]';m jsonb;k text;h text;p jsonb;v text;
begin
 for m in select value from jsonb_array_elements(s->'markets') loop
  foreach k in array array['bars','metadata'] loop
   if not(m?k) then continue;end if;p:=m->k;h:=encode(sha256(convert_to(k||':'||p::text,'UTF8')),'hex');
   insert into neptune_mv_private.payload_blobs(id,kind,payload) values(h,k,p) on conflict do nothing;
   m:=(m-k)||jsonb_build_object(k||'_ref',h);
  end loop;arr:=arr||jsonb_build_array(m);
 end loop;out:=jsonb_set(out,'{markets}',arr);
 foreach v in array array['USDT/USD','USDC/USD'] loop
  p:=s#>array['quote_fx',v,'metadata'];if p is null then continue;end if;
  h:=encode(sha256(convert_to('metadata:'||p::text,'UTF8')),'hex');insert into neptune_mv_private.payload_blobs(id,kind,payload) values(h,'metadata',p) on conflict do nothing;
  m:=(s#>array['quote_fx',v])-'metadata';m:=m||jsonb_build_object('metadata_ref',h);out:=jsonb_set(out,array['quote_fx',v],m);
 end loop;return out;
end$$;
create function neptune_mv_private.unpack(s jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare out jsonb:=s;arr jsonb:='[]';m jsonb;k text;h text;p jsonb;v text;
begin
 for m in select value from jsonb_array_elements(s->'markets') loop
  foreach k in array array['bars','metadata'] loop
   h:=m->>(k||'_ref');if h is null then continue;end if;
   select payload into p from neptune_mv_private.payload_blobs where id=h and kind=k;
   if p is null or encode(sha256(convert_to(k||':'||p::text,'UTF8')),'hex')<>h then raise exception 'missing or corrupt immutable evidence';end if;
   m:=(m-(k||'_ref'))||jsonb_build_object(k,p);
  end loop;arr:=arr||jsonb_build_array(m);
 end loop;out:=jsonb_set(out,'{markets}',arr);
 foreach v in array array['USDT/USD','USDC/USD'] loop
  h:=s#>>array['quote_fx',v,'metadata_ref'];if h is null then continue;end if;
  select payload into p from neptune_mv_private.payload_blobs where id=h and kind='metadata';
  if p is null or encode(sha256(convert_to('metadata:'||p::text,'UTF8')),'hex')<>h then raise exception 'missing or corrupt immutable evidence';end if;
  m:=(s#>array['quote_fx',v])-'metadata_ref';m:=m||jsonb_build_object('metadata',p);out:=jsonb_set(out,array['quote_fx',v],m);
 end loop;return out;
end$$;

-- Fixed manifest. No caller supplied URL/body, symbols, credentials, wallet addresses or endpoints.
create function neptune_mv_private.manifest(v text,k text,n timestamptz) returns jsonb language plpgsql immutable set search_path='' as $$
declare url text;body jsonb;start_ms bigint:=floor(neptune_mv_private.ms(n)/900000)*900000-86400000;
begin
 if v='binance' then
  url:=case k when 'metadata' then '/exchangeInfo?symbol=SOLUSDT' when 'depth' then '/depth?symbol=SOLUSDT&limit=20' when 'trades' then '/trades?symbol=SOLUSDT&limit=100' when 'avg_price' then '/avgPrice?symbol=SOLUSDT' when 'bars' then '/klines?symbol=SOLUSDT&interval=15m&limit=97&startTime='||start_ms::text||'&endTime='||neptune_mv_private.ms(n)::text end;
  if url is null then return null;end if;url:='https://data-api.binance.vision/api/v3'||url;
 elsif v='hyperliquid' then
  body:=case k when 'metadata' then '{"type":"spotMeta"}'::jsonb when 'depth' then '{"type":"l2Book","coin":"@107"}'::jsonb when 'trades' then '{"type":"recentTrades","coin":"@107"}'::jsonb when 'bars' then jsonb_build_object('type','candleSnapshot','req',jsonb_build_object('coin','@107','interval','15m','startTime',start_ms,'endTime',neptune_mv_private.ms(n))) end;
  if body is null then return null;end if;url:='https://api.hyperliquid.xyz/info';
 elsif v in ('USDT','USDC') and k in ('metadata','fx') then url:='https://api.kraken.com/0/public/'||case k when 'metadata' then 'AssetPairs?pair='||v||'USD&assetVersion=1' else 'Depth?pair='||v||'USD&count=20&assetVersion=1' end;
 else return null;end if;
 return jsonb_build_object('url',url,'body',body,'method',case when body is null then 'GET' else 'POST' end);
end$$;

-- Caller MUST synchronize owner control and evaluate legacy exits first. Owner epoch fences stop/resume.
-- No new watcher: call once from the existing bounded trusted feed_work transaction.
create function neptune_mv_private.dispatch(owner_epoch bigint) returns text language plpgsql volatile set search_path='' as $$
declare c neptune_mv_private.control;n timestamptz:=clock_timestamp();ep bigint:=floor(extract(epoch from n)/60);v text;k text;m jsonb;rid bigint;sz bigint;boundmeta jsonb;held jsonb;protective boolean;heldref text;prov text;block jsonb;
begin
 select * into c from neptune_mv_private.control where id for update;if not found then return 'unconfigured';end if;
 if not c.enabled or c.terminal or not c.contract_verified or owner_epoch is null then return 'disabled';end if;
 select coalesce(sum(pg_total_relation_size(cl.oid)),0) into sz from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.relkind in ('r','m') and (ns.nspname in ('neptune_mv_private','neptune_v2_private') or (ns.nspname='public' and cl.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')));
 if sz>=33554432 then update neptune_mv_private.control set entry_paused=true,reason='entry_capacity_paused' where id;c.entry_paused:=true;end if;
 if n<c.started_at or sz>=41943040 then update neptune_mv_private.control set terminal=true,reason='frozen_capacity_or_clock' where id;return 'terminal';end if;
 if c.pending_epoch is not null then return 'pending';end if;
 -- Provider quarantine owns unresolved requests; never suppress unrelated exits.
 for prov,block in select key,value from jsonb_each(c.provider_blocked) loop
  if block->>'permanent'='false' and (block->>'blocked_until')::timestamptz<=n then c.provider_blocked:=c.provider_blocked-prov;end if;
 end loop;
 update neptune_mv_private.control set provider_blocked=c.provider_blocked where id;
 if (c.provider_blocked?'binance' or c.identity_blocked?'binance') and (c.provider_blocked?'hyperliquid' or c.identity_blocked?'hyperliquid') and c.provider_blocked?'kraken' then return 'providers_blocked';end if;
 if c.last_epoch is not null and (ep<=c.last_epoch or n<c.last_dispatch_at+interval '60 seconds') then return 'rate_limited';end if;
 update neptune_mv_private.control set last_epoch=ep,last_dispatch_at=n,pending_epoch=ep,pending_owner_epoch=owner_epoch,pending_at=n,batches=batches+1 where id;
 foreach v in array array['binance','hyperliquid','USDT','USDC'] loop
  if c.identity_blocked?v or c.provider_blocked?neptune_mv_private.provider(v) then continue;end if;
  held:=neptune_mv_private.held_metadata(v);
  foreach k in array array['metadata','depth','bars','trades','avg_price','fx'] loop
   if v in ('USDT','USDC') and k not in ('metadata','fx') or v in ('binance','hyperliquid') and k='fx' then continue;end if;
   if c.entry_paused and (k in ('bars','trades') or (k='avg_price' and held is null)) then continue;end if;
   if k='avg_price' and (v<>'binance' or not exists(select 1 from jsonb_array_elements(coalesce(c.metadata->v,held)#>'{rules,all_filters}') f where f->>'filterType' in ('PERCENT_PRICE','PERCENT_PRICE_BY_SIDE'))) then continue;end if;
   if true then
    if k='metadata' and coalesce((c.metadata#>>array[v,'at'])::timestamptz>=n-interval '1 hour',false) then continue;end if;
    protective:=false;boundmeta:=c.metadata->v;heldref:=null;
    if k<>'metadata' and not coalesce((boundmeta->>'at')::timestamptz between n-interval '1 hour' and n,false) then
     if (k='depth' or (v='binance' and k='avg_price')) and held is not null and (held->>'at')::timestamptz<=n then
      boundmeta:=held;protective:=true;heldref:=encode(sha256(convert_to('metadata:'||held::text,'UTF8')),'hex');
      insert into neptune_mv_private.payload_blobs(id,kind,payload) values(heldref,'metadata',held) on conflict do nothing;
     else continue;end if;
    end if;
   end if;
   m:=neptune_mv_private.manifest(v,k,n);if m is null then continue;end if;
   if m->>'method'='GET' then rid:=net.http_get(url:=m->>'url',params:='{}'::jsonb,headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=5000);
   else rid:=net.http_post(url:=m->>'url',body:=m->'body',params:='{}'::jsonb,headers:='{"Accept":"application/json","Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=5000);end if;
   insert into neptune_mv_private.requests values(ep,k,v,rid,n,m->>'url',m->'body',boundmeta->>'revision',protective,heldref);
  end loop;
 end loop;return 'dispatched';
end$$;

create function neptune_mv_private.collect(owner_epoch bigint) returns jsonb language plpgsql volatile set search_path='' as $$
declare c neptune_mv_private.control;n timestamptz:=clock_timestamp();q record;r record;p jsonb;m jsonb;out jsonb:='{"schema_version":1,"markets":{},"quote_fx":{},"entry_eligible":false}';e jsonb;ready int;expected int;bytes bigint:=0;bad boolean:=false;outcome text:='processed';cache_age numeric;d timestamptz;prov text;block jsonb;
begin
 select * into c from neptune_mv_private.control where id for update;if not found or c.pending_epoch is null or c.terminal then return null;end if;
 select count(*) into expected from neptune_mv_private.requests where epoch=c.pending_epoch;
 select count(*) into ready from neptune_mv_private.requests rq join net._http_response rs on rs.id=rq.request_id where rq.epoch=c.pending_epoch;
 if ready<expected and n<c.pending_at+interval '15 seconds' then return null;end if;
 if owner_epoch is null or owner_epoch is distinct from c.pending_owner_epoch or not c.enabled then outcome:='owner_changed';end if;
 -- Preflight all provider outcomes before accepting any response from that provider.
 for q in select * from neptune_mv_private.requests where epoch=c.pending_epoch loop
  prov:=neptune_mv_private.provider(q.venue);select * into r from net._http_response where id=q.request_id;
  if not found then
   if not(c.provider_blocked?prov) then c.provider_blocked:=c.provider_blocked||jsonb_build_object(prov,jsonb_build_object('reason','unresolved_response','blocked_at',n,'request_id',q.request_id,'permanent',true));end if;
  else
   bytes:=bytes+coalesce(octet_length(r.content),0);
   if r.status_code in (403,418,429,451) then
    block:=neptune_mv_private.provider_failure(r.status_code,r.headers,n);
    -- A later rate-limit record cannot weaken an existing permanent access denial.
    if c.provider_blocked#>>array[prov,'permanent']='false' and block->>'permanent'='false' and (c.provider_blocked#>>array[prov,'blocked_until'])::timestamptz>(block->>'blocked_until')::timestamptz then block:=c.provider_blocked->prov;end if;
    if not(c.provider_blocked?prov) or c.provider_blocked#>>array[prov,'permanent'] is distinct from 'true' then c.provider_blocked:=c.provider_blocked||jsonb_build_object(prov,block);end if;
   end if;
  end if;
 end loop;
 if outcome='processed' and c.provider_blocked<>'{}'::jsonb then outcome:='partial_providers';end if;
 if outcome in ('processed','partial_providers') then
  for q in select * from neptune_mv_private.requests where epoch=c.pending_epoch order by case when kind='metadata' then 0 else 1 end,kind,venue loop
   select * into r from net._http_response where id=q.request_id;
   if not found or c.provider_blocked?neptune_mv_private.provider(q.venue) then continue;end if;
   if r.status_code is distinct from 200 or coalesce(r.timed_out,false) or r.error_msg is not null or r.created is null or r.created<q.sent_at or r.created>q.sent_at+interval '10 seconds' or r.created>n or r.created<n-interval '30 seconds' or coalesce(r.content_type,'') not ilike 'application/json%' or octet_length(r.content)>neptune_mv_private.limit_bytes(q.kind) then continue;end if;
   -- Cached market responses cannot masquerade as current transport evidence.
   begin
    cache_age:=neptune_mv_private.num(coalesce(r.headers->>'age',r.headers->>'Age'));
    if (r.headers?'age' or r.headers?'Age') and (cache_age is null or cache_age>case q.kind when 'metadata' then 3600 when 'bars' then 60 else 5 end) then continue;end if;
    if r.headers?'date' or r.headers?'Date' then d:=coalesce(r.headers->>'date',r.headers->>'Date')::timestamptz;if d>n+interval '5 seconds' or d<q.sent_at-make_interval(secs=>case q.kind when 'metadata' then 3600 when 'bars' then 60 else 5 end) then continue;end if;end if;
   exception when others then continue;end;
   if q.kind='metadata' and neptune_mv_private.identity_conflict(q.venue,r.content) then c.identity_blocked:=c.identity_blocked||jsonb_build_object(q.venue,jsonb_build_object('reason','source_identity_or_tradability_conflict','at',n,'request_id',q.request_id,'source',q.url,'body_sha256',encode(sha256(convert_to(r.content,'UTF8')),'hex')));continue;end if;
   if c.identity_blocked?q.venue then continue;end if;
   m:=c.metadata->q.venue;
   if q.protective_only then
    select payload into m from neptune_mv_private.payload_blobs where id=q.held_rules_ref and kind='metadata';
    if m is null or encode(sha256(convert_to('metadata:'||m::text,'UTF8')),'hex') is distinct from q.held_rules_ref or m->>'revision' is distinct from neptune_mv_private.held_metadata(q.venue)->>'revision' then continue;end if;
   end if;
   if q.kind<>'metadata' and q.metadata_revision is distinct from m->>'revision' then continue;end if;
   p:=neptune_mv_private.parse(q.venue,q.kind,r.content,r.created,n,m,q.protective_only);if p is null then continue;end if;
   e:=jsonb_build_object('request_id',q.request_id,'source',q.url,'request_body',q.body,'sent_at',q.sent_at,'received_at',r.created,'body_sha256',encode(sha256(convert_to(r.content,'UTF8')),'hex'),'epoch',q.epoch,'metadata_revision',q.metadata_revision,'protective_only',q.protective_only,'held_rules_ref',q.held_rules_ref,'http_headers',jsonb_build_object('date',coalesce(r.headers->>'date',r.headers->>'Date'),'age',cache_age),'provenance','trusted_pg_net');
   if q.kind='metadata' then c.metadata:=jsonb_set(c.metadata,array[q.venue],p||jsonb_build_object('feed_evidence',e));
   elsif q.kind='fx' then out:=jsonb_set(out,array['quote_fx',q.venue||'/USD'],p||jsonb_build_object('feed_evidence',e));
   else
    m:=coalesce(out#>array['markets',q.venue],jsonb_build_object('instrument',m->>'instrument','asset',m->>'asset','canonical_exposure_key',m->>'base','quote',m->>'quote','venue',m->>'venue','kind','spot','metadata',m,'feed_evidence','{}'::jsonb));
    m:=m||p;m:=jsonb_set(m,array['feed_evidence',q.kind],e);out:=jsonb_set(out,array['markets',q.venue],m);
   end if;
  end loop;
 end if;
 out:=jsonb_set(out,'{markets}',coalesce((select jsonb_agg(value order by key) from jsonb_each(out->'markets')),'[]'::jsonb));
 out:=out||jsonb_build_object('at',n,'epoch',c.pending_epoch,'owner_epoch',c.pending_owner_epoch,'outcome',outcome,'provenance','trusted_pg_net','identity_blocked',c.identity_blocked,'provider_blocked',c.provider_blocked);
 if octet_length(out::text)>262144 then out:=jsonb_build_object('outcome','oversize','entry_eligible',false);bad:=true;outcome:='oversize';end if;
 insert into neptune_mv_private.events values(c.pending_epoch,n,c.pending_owner_epoch,outcome,bytes,ready<expected,neptune_mv_private.pack(out));
 update neptune_mv_private.control set pending_epoch=null,pending_owner_epoch=null,pending_at=null,metadata=c.metadata,identity_blocked=c.identity_blocked,provider_blocked=c.provider_blocked,bytes_seen=bytes_seen+bytes,terminal=terminal or bad,reason=case when bad then outcome else reason end where id;
 -- Results from owner changes may never reach an engine, even if all HTTP responses exist.
 if outcome not in ('processed','partial_providers') or bad then return null;end if;return out;
end$$;
-- Isolated wrapper: a candidate parse, SQL or statement-cancellation failure cannot
-- roll back legacy protective exits already performed before this invocation.
create function neptune_mv_private.tick(owner_epoch bigint) returns jsonb language plpgsql volatile set search_path='' as $$
declare out jsonb;status text;
begin
 begin
  out:=neptune_mv_private.collect(owner_epoch);
  status:=neptune_mv_private.dispatch(owner_epoch);
  if out is not null then out:=out||jsonb_build_object('entry_capacity_paused',coalesce((select entry_paused from neptune_mv_private.control where id),true),'feed_terminal',coalesce((select terminal from neptune_mv_private.control where id),true),'provider_blocked',(select provider_blocked from neptune_mv_private.control where id));end if;
  return jsonb_build_object('snapshot',out,'dispatch',status,'entry_capacity_paused',coalesce((select entry_paused from neptune_mv_private.control where id),true),'feed_terminal',coalesce((select terminal from neptune_mv_private.control where id),true),'provider_blocked',(select provider_blocked from neptune_mv_private.control where id));
 exception when query_canceled or others then
  update neptune_mv_private.control set terminal=true,reason='collector_exception' where id;
  return jsonb_build_object('snapshot',null,'dispatch','terminal','reason','collector_exception');
 end;
end$$;
revoke all on all tables in schema neptune_mv_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_mv_private from public,anon,authenticated,service_role;


-- collector-integration.sql
-- ISOLATED ONE-SCHEDULER INTEGRATION. No cron, activation, seed, extension or grants.
-- Base collector.sql retained byte-for-byte. Load after native-collector.sql and current runtime.
create or replace function neptune_v2_private.legacy_feed_universe() returns text[] language sql immutable security invoker set search_path='' as $$select array['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD']::text[]$$;
create or replace function neptune_v2_private.native_feed_state() returns jsonb language sql stable security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('configured',true,'enabled',enabled,'contract_verified',contract_verified,'entry_capacity_paused',entry_paused,'feed_terminal',terminal,'provider_blocked',provider_blocked,'identity_blocked',identity_blocked,'reason',reason) from neptune_mv_private.control where id),'{"configured":false,"enabled":false,"contract_verified":false,"entry_capacity_paused":true,"feed_terminal":true}'::jsonb)
$$;
create or replace function neptune_v2_private.shared_provider_preflight(ep bigint,cutoff timestamptz) returns void language plpgsql volatile security invoker set search_path='' as $$
declare req record;resp record;provider text;blocked jsonb;failure jsonb;
begin
 select provider_blocked into blocked from neptune_mv_private.control where id for update;if not found then return;end if;
 for req in select * from neptune_v2_private.feed_requests where epoch=ep loop
  provider:=case req.kind when 'fx' then 'frankfurter' else 'kraken' end;
  select * into resp from net._http_response where id=req.request_id;
  failure:=null;
  if not found then
   if req.request_id is not null and cutoff>=req.sent_at+interval '15 seconds' then failure:=jsonb_build_object('reason','unresolved_legacy_response','request_id',req.request_id,'blocked_at',cutoff,'permanent',true);end if;
  elsif resp.status_code in (403,418,429,451) then failure:=neptune_mv_private.provider_failure(resp.status_code,resp.headers,cutoff);
  end if;
  if failure is null then continue;end if;
  if blocked#>>array[provider,'permanent']='true' then continue;end if;
  if blocked#>>array[provider,'permanent']='false' and failure->>'permanent'='false' and (blocked#>>array[provider,'blocked_until'])::timestamptz>(failure->>'blocked_until')::timestamptz then continue;end if;
  blocked:=blocked||jsonb_build_object(provider,failure);
 end loop;
 update neptune_mv_private.control set provider_blocked=blocked where id;
end$$;

create or replace function neptune_v2_private.feed_url(kind text,asset text) returns text language plpgsql immutable security invoker set search_path='' as $$
begin
 if kind='metadata' and asset='' then return 'https://api.kraken.com/0/public/AssetPairs?pair=ETHUSD,SOLUSD,AVAXUSD,LINKUSD,AAVEUSD,UNIUSD&assetVersion=1';end if;
 if kind='fx' and asset='' then return 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=AUD';end if;
 if asset is null or not(asset=any(neptune_v2_private.legacy_feed_universe())) then return null;end if;
 return case kind when 'depth' then 'https://api.kraken.com/0/public/Depth?pair='||replace(asset,'/','')||'&count=10&assetVersion=1'
 when 'bars' then 'https://api.kraken.com/0/public/OHLC?pair='||replace(asset,'/','')||'&interval=15&assetVersion=1'
 when 'trade' then 'https://api.kraken.com/0/public/Trades?pair='||replace(asset,'/','')||'&count=1&assetVersion=1' end;
end$$;

create or replace function neptune_v2_private.feed_parse(kind text,asset text,body text,received timestamptz,cutoff timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare j jsonb;r jsonb;v jsonb;p jsonb;out jsonb:='{}';arr jsonb:='[]';side text;t numeric;oldest timestamptz;updates jsonb:='{}';times jsonb;dt timestamptz;rate numeric;vol numeric:=0;cnt int:=0;previous numeric;a text;
begin
 if body is null or octet_length(body)>(case kind when 'bars' then 131072 when 'metadata' then 32768 when 'depth' then 32768 else 4096 end) or received>cutoff or received<cutoff-interval '30 seconds' then return null;end if;
 j:=body::jsonb;
 if kind='fx' then
  if jsonb_typeof(j)<>'array' or jsonb_array_length(j)<>1 then return null;end if;j:=j->0;
  if j->>'base' is distinct from 'USD' or j->>'quote' is distinct from 'AUD' or coalesce(j->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then return null;end if;
  dt:=((j->>'date')||'T00:00:00Z')::timestamptz;rate:=neptune_v2_private.num(j->>'rate');
  if dt>cutoff or dt<cutoff-interval '96 hours' or rate is null or rate not between .1 and 10 then return null;end if;
  return jsonb_build_object('base','USD','quote','AUD','rate',rate,'rate_date',j->>'date','at',dt,'fetched_at',received,'source','Frankfurter ECB reference');
 end if;
 if j->'error' is distinct from '[]'::jsonb or jsonb_typeof(j->'result') is distinct from 'object' then return null;end if;
 r:=j->'result';
 if kind='metadata' then
  foreach a in array neptune_v2_private.legacy_feed_universe() loop
   p:=r->a;
   if p->>'wsname'=a and p->>'altname'=replace(a,'/','') and p->>'base'=split_part(a,'/',1) and p->>'quote'='USD' and p->>'aclass_base'='currency' and p->>'aclass_quote'='currency' and p->>'status'='online' and p->>'lot'='unit' and neptune_v2_private.num(p->>'lot_multiplier')=1 and neptune_v2_private.num(p->>'ordermin')>0 and neptune_v2_private.num(p->>'costmin')>0 and neptune_v2_private.num(p->>'tick_size')>0 and neptune_v2_private.num(p->>'lot_decimals') between 0 and 12 and neptune_v2_private.num(p->>'lot_decimals')=floor(neptune_v2_private.num(p->>'lot_decimals')) then
    out:=out||jsonb_build_object(a,jsonb_build_object('asset',a,'venue','Kraken','kind','spot','quote','USD','status','online','at',received,'source','https://api.kraken.com/0/public/AssetPairs','min_qty',neptune_v2_private.num(p->>'ordermin'),'min_cost',neptune_v2_private.num(p->>'costmin'),'qty_decimals',neptune_v2_private.num(p->>'lot_decimals'),'tick_size',neptune_v2_private.num(p->>'tick_size')));
   end if;
  end loop;return out;
 end if;
 if asset is null or not(asset=any(neptune_v2_private.legacy_feed_universe())) then return null;end if;p:=r->asset;
 if kind='depth' then
  foreach side in array array['bids','asks'] loop
   if jsonb_typeof(p->side) is distinct from 'array' or jsonb_array_length(p->side) not between 1 and 10 then return null;end if;arr:='[]';times:='[]';
   for v in select value from jsonb_array_elements(p->side) loop
    if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>3 then return null;end if;
    t:=neptune_v2_private.num(v->>2);if t is null or t<0 or t>extract(epoch from received) then return null;end if;
    dt:=to_timestamp(t::double precision);
    -- Kraken level timestamps are last modifications, not snapshot observation times.
    oldest:=least(oldest,dt);times:=times||jsonb_build_array(dt);
    arr:=arr||jsonb_build_array(jsonb_build_array(neptune_v2_private.num(v->>0),neptune_v2_private.num(v->>1)));
   end loop;if jsonb_array_length(arr)=0 then return null;end if;out:=out||jsonb_build_object(side,arr);updates:=updates||jsonb_build_object(side,times);
  end loop;
  out:=out||jsonb_build_object('at',received,'timestamp_basis','http_response_observed','level_updated_at',updates,'oldest_level_update_at',oldest);
  if neptune_v2_private.book(jsonb_build_object('book',out,'received_at',received),cutoff)?'error' then return null;end if;
  return jsonb_build_object('book',out,'received_at',received);
 elsif kind='trade' then
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)<>1 or jsonb_array_length(p->0)<>7 or coalesce(neptune_v2_private.num(p#>>'{0,0}'),0)<=0 or coalesce(neptune_v2_private.num(p#>>'{0,1}'),0)<=0 then return null;end if;
  t:=neptune_v2_private.num(p#>>'{0,2}');-- Preserve genuine last-trade evidence; the unchanged core60s gate controls entry eligibility.
  if t is null or t<0 or t>extract(epoch from received) then return null;end if;
  return jsonb_build_object('trade_at',to_timestamp(t::double precision));
 elsif kind='bars' then
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 23 and 720 then return null;end if;
  -- Retain only the final 96 completed intervals; never use Kraken's current mutable bar.
  for v in select value from jsonb_array_elements(p) loop
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>8 then return null;end if;
   t:=neptune_v2_private.num(v->>0);if t is null or t<>floor(t) or mod(t,900)<>0 then return null;end if;
   if t+900>extract(epoch from received) then continue;end if;
   if t<floor(extract(epoch from received)/900)*900-86400 then continue;end if;
   if previous is not null and t<>previous+900 then return null;end if;previous:=t;
   arr:=arr||jsonb_build_array(jsonb_build_object('t',t*1000,'o',neptune_v2_private.num(v->>1),'h',neptune_v2_private.num(v->>2),'l',neptune_v2_private.num(v->>3),'c',neptune_v2_private.num(v->>4),'v',neptune_v2_private.num(v->>6)));
   if neptune_v2_private.num(v->>5) is null or neptune_v2_private.num(v->>6) is null then return null;end if;
   vol:=vol+neptune_v2_private.num(v->>5)*neptune_v2_private.num(v->>6);cnt:=cnt+1;
  end loop;
  if neptune_v2_private.bars(jsonb_build_object('bars',arr),cutoff)?'error' then return null;end if;
  select jsonb_agg(value order by ord) into arr from jsonb_array_elements(arr) with ordinality e(value,ord) where ord>jsonb_array_length(arr)-22;
  return jsonb_build_object('bars',arr,'volume_24h_usd',case when cnt=96 then vol else null end);
 end if;return null;
exception when others then return null;
end$$;

create or replace function neptune_v2_private.feed_work() returns void language plpgsql security invoker set search_path='' as $$
declare c neptune_v2_private.feed_control;ac neptune_v2_private.account;n timestamptz:=clock_timestamp();epoch bigint;req record;resp record;
 markets jsonb:='{}';m jsonb;parsed jsonb;fx jsonb;meta jsonb;scan jsonb;arr jsonb:='[]';a text;k text;url text;rid bigint;evidence jsonb;httpdate text;httpage text;cache_age_limit int;rawbytes bigint:=0;outcome text:='processed';ready int;expected int;ownbytes bigint;logbytes bigint;logrows bigint;legacy_arr jsonb;native_tick jsonb;native_snapshot jsonb;native_state jsonb;native_control neptune_mv_private.control;native_ready int;native_expected int;provider text;
begin
 -- Global lock order: owner control, account, collector state.
 perform neptune_v2_private.sync_control();
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select * into c from neptune_v2_private.feed_control where id for update;
 if not found then return;end if;
 -- Preserve lock order: owner/account/legacy-feed/native-feed. Only synchronize existing control.
 select * into native_control from neptune_mv_private.control where id for update;
 update neptune_mv_private.control set enabled=coalesce((ac.state->>'enabled')::boolean,false) and not terminal where id;
 -- Check absolute and attempted-work limits BEFORE any response parse/network work.
 update neptune_v2_private.feed_control set ticks=ticks+1 where id;
 select coalesce(sum(pg_total_relation_size(cl.oid)),0) into ownbytes from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.relkind in ('r','m') and (ns.nspname in ('neptune_v2_private','neptune_mv_private') or (ns.nspname='public' and cl.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')));
 select count(*),coalesce(sum(pg_column_size(j)),0) into logrows,logbytes from cron.job_run_details j where j.jobid=c.job_id;
 if ownbytes>=33554432 then update neptune_v2_private.account set state=state||jsonb_build_object('entry_capacity_paused',true) where id='neptune-paper-v2';end if;
 if c.terminal or n<c.started_at or ownbytes>=41943040 or logrows>=32000 or logbytes>=16777216 or coalesce((ac.state->>'capacity_paused')::boolean,false) then update neptune_mv_private.control set terminal=true,enabled=false,reason='parent_capacity_or_terminal' where id;perform neptune_v2_private.feed_stop();return;end if;
 if not c.contract_verified then perform neptune_v2_private.feed_stop();return;end if;
 if c.pending_epoch is not null and c.pending_control_epoch is distinct from (ac.state->>'control_epoch')::bigint then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  insert into neptune_v2_private.feed_events values(c.pending_epoch,n,'control_changed',0,null,ready<expected);
  update neptune_v2_private.feed_control set pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
  c.pending_epoch:=null;
 end if;
 if not coalesce((ac.state->>'enabled')::boolean,false) then return;end if;
 if c.pending_epoch is not null then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  if ready=expected or n>=c.pending_at+interval '15 seconds' then
   -- Native requests are queued before legacy, so their deadline cannot exceed this one.
   select * into native_control from neptune_mv_private.control where id;
   if found and native_control.pending_epoch is not null and not native_control.terminal then
    select count(*) into native_expected from neptune_mv_private.requests nr where nr.epoch=native_control.pending_epoch;
    select count(*) into native_ready from neptune_mv_private.requests nr join net._http_response rs on rs.id=nr.request_id where nr.epoch=native_control.pending_epoch;
    if native_ready<native_expected and n<native_control.pending_at+interval '15 seconds' and n<c.pending_at+interval '15 seconds' then return;end if;
   end if;
   perform neptune_v2_private.shared_provider_preflight(c.pending_epoch,n);
   native_tick:=neptune_mv_private.tick((ac.state->>'control_epoch')::bigint);
   native_snapshot:=native_tick->'snapshot';native_state:=neptune_v2_private.native_feed_state()||coalesce(native_tick-'snapshot','{}'::jsonb);
   meta:=c.metadata_cache;fx:=c.fx_cache;
   foreach a in array neptune_v2_private.legacy_feed_universe() loop markets:=markets||jsonb_build_object(a,jsonb_build_object('asset',a));end loop;
   for req in select * from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch order by kind,asset loop
    begin
     select * into resp from net._http_response where id=req.request_id;
     if not found then continue;end if;
     provider:=case req.kind when 'fx' then 'frankfurter' else 'kraken' end;
     if exists(select 1 from neptune_mv_private.control where id and provider_blocked?provider) then continue;end if;
     rawbytes:=rawbytes+coalesce(octet_length(resp.content),0);
     if resp.status_code<>200 or coalesce(resp.timed_out,false) or resp.error_msg is not null or resp.created<req.sent_at or resp.created>n or resp.created< n-interval '30 seconds' or coalesce(resp.content_type,'') not ilike 'application/json%' then continue;end if;
     cache_age_limit:=case when req.kind in ('metadata','fx') then 3600 when req.kind='bars' then 60 else 5 end;
     httpdate:=coalesce(resp.headers->>'date',resp.headers->>'Date');httpage:=coalesce(resp.headers->>'age',resp.headers->>'Age');
     if httpdate is not null and (neptune_v2_private.ts(httpdate) is null or neptune_v2_private.ts(httpdate)<req.sent_at-make_interval(secs=>cache_age_limit) or neptune_v2_private.ts(httpdate)>n+interval '5 seconds') then continue;end if;
     if httpage is not null and (neptune_v2_private.num(httpage) is null or neptune_v2_private.num(httpage)>cache_age_limit) then continue;end if;
     parsed:=neptune_v2_private.feed_parse(req.kind,req.asset,resp.content,resp.created,n);
     if parsed is null then continue;end if;
     evidence:=jsonb_build_object('source',req.request_url,'request_id',req.request_id,'sent_at',req.sent_at,'received_at',resp.created,'http_date',httpdate,'http_age',httpage,'body_sha256',encode(sha256(convert_to(resp.content,'UTF8')),'hex'));
     if req.kind='metadata' then
      foreach a in array neptune_v2_private.legacy_feed_universe() loop if parsed?a then parsed:=jsonb_set(parsed,array[a],parsed->a||jsonb_build_object('feed_evidence',evidence));end if;end loop;
     elsif req.kind='fx' then parsed:=parsed||jsonb_build_object('feed_evidence',evidence);
     else markets:=jsonb_set(markets,array[req.asset,'feed_evidence'],coalesce(markets#>array[req.asset,'feed_evidence'],'{}'::jsonb)||jsonb_build_object(req.kind,evidence));end if;
     if req.kind='metadata' then meta:=parsed;update neptune_v2_private.feed_control set metadata_cache=parsed where id;elsif req.kind='fx' then fx:=parsed;update neptune_v2_private.feed_control set fx_cache=parsed where id;else markets:=jsonb_set(markets,array[req.asset],markets->req.asset||parsed);end if;
    exception when others then null;end;
   end loop;
   update neptune_v2_private.feed_control set bytes_seen=bytes_seen+rawbytes,pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
   foreach a in array neptune_v2_private.legacy_feed_universe() loop m:=markets->a;if meta?a then m:=m||jsonb_build_object('metadata',meta->a);end if;arr:=arr||jsonb_build_array(m);end loop;
   -- Exactly one trusted scan. Native preflight already applied before legacy parsing.
   legacy_arr:=arr;
   if native_snapshot is not null and native_snapshot<>'null'::jsonb and (native_snapshot->>'owner_epoch')::bigint=(ac.state->>'control_epoch')::bigint then
    arr:=arr||coalesce(native_snapshot->'markets','[]'::jsonb);
   end if;
   if native_state#>'{provider_blocked}'?'frankfurter' then fx:=null;end if;
   scan:=jsonb_build_object('at',clock_timestamp(),'markets',arr,'fx',fx,'quote_fx',coalesce(native_snapshot->'quote_fx','{}'::jsonb),'native_feed',native_state);
   if jsonb_array_length(arr)>8 or octet_length(scan::text)>131072 then
    -- Oversized native evidence cannot suppress bounded legacy protective exits.
    native_state:=native_state||jsonb_build_object('snapshot_rejected',true,'feed_terminal',true,'entry_capacity_paused',true,'reason','native_snapshot_oversize');
    scan:=jsonb_build_object('at',clock_timestamp(),'markets',legacy_arr,'fx',fx,'quote_fx','{}'::jsonb,'native_feed',native_state);outcome:='native_snapshot_oversize';
   end if;
   if octet_length(scan::text)>131072 then outcome:='snapshot_oversize';else
    begin perform neptune_v2_private.process_scan(scan);exception when others then outcome:='core_rejected';end;
   end if;
   insert into neptune_v2_private.feed_events values(c.pending_epoch,n,outcome,rawbytes,md5(scan::text),ready<expected);
   if exists(select 1 from neptune_v2_private.account where id='neptune-paper-v2' and coalesce((state->>'capacity_paused')::boolean,false)) then perform neptune_v2_private.feed_stop();return;end if;
  else return;end if;
 end if;
 epoch:=floor(extract(epoch from n)/60)::bigint;
 -- Persistent epoch survives Stop/Resume; never dispatch twice within one minute.
 if c.last_epoch is not null and (epoch<=c.last_epoch or n<c.last_dispatch_at+interval '60 seconds') then return;end if;
 -- An unresolved older request cannot silently accumulate across batches.
 if exists(select 1 from neptune_v2_private.feed_events where feed_events.epoch=c.last_epoch and missing_responses) then perform neptune_v2_private.shared_provider_preflight(c.last_epoch,n);end if;
 -- Consume owner-fenced abandoned native data only; never discard a current-owner snapshot.
 select * into native_control from neptune_mv_private.control where id;
 if found and native_control.pending_epoch is not null and native_control.pending_owner_epoch is distinct from (ac.state->>'control_epoch')::bigint then
  perform neptune_mv_private.collect((ac.state->>'control_epoch')::bigint);
 end if;
 select * into native_control from neptune_mv_private.control where id;
 if found and native_control.pending_epoch is null then
  -- At this point tick cannot consume a snapshot; it can only dispatch the parallel native batch.
  native_tick:=neptune_mv_private.tick((ac.state->>'control_epoch')::bigint);
 end if;
 n:=clock_timestamp();epoch:=floor(extract(epoch from n)/60)::bigint;
 update neptune_v2_private.feed_control set last_epoch=epoch,last_dispatch_at=n,pending_epoch=epoch,pending_control_epoch=(ac.state->>'control_epoch')::bigint,pending_at=n,batches=batches+1 where id;
 foreach k in array array['metadata','fx','depth','bars','trade'] loop
  provider:=case k when 'fx' then 'frankfurter' else 'kraken' end;
  if exists(select 1 from neptune_mv_private.control where id and provider_blocked?provider) then continue;end if;
  if k='metadata' and neptune_v2_private.fresh(c.metadata_cache#>>'{ETH/USD,at}',n,3600) then continue;end if;
  if k='fx' and neptune_v2_private.fresh(c.fx_cache->>'fetched_at',n,900) then continue;end if;
  foreach a in array (case when k in ('metadata','fx') then array[''] else neptune_v2_private.legacy_feed_universe() end) loop
   rid:=null;url:=neptune_v2_private.feed_url(k,a);
   if k='bars' then url:=url||'&since='||((epoch*60/900)*900-86400)::text;end if;
   begin
    rid:=net.http_get(url:=url,params:='{}'::jsonb,headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=5000);
   exception when others then null;end;
   insert into neptune_v2_private.feed_requests values(epoch,k,a,rid,n,url);
  end loop;
 end loop;
end$$;

revoke all on function neptune_v2_private.legacy_feed_universe(),neptune_v2_private.native_feed_state(),neptune_v2_private.shared_provider_preflight(bigint,timestamptz),neptune_v2_private.feed_url(text,text),neptune_v2_private.feed_parse(text,text,text,timestamptz,timestamptz),neptune_v2_private.feed_work() from public,anon,authenticated,service_role;


-- native-audit.sql
-- Additive synthetic public audit candidate. No grants, credentials, private data or activation.
-- Load after native-ledger.sql. Apply atomically before native runtime starts.
-- Existing history sequence, access policy and immutable rows stay unchanged.
do $$begin if exists(select 1 from neptune_v2_private.fills where payload->>'asset' in ('binance:SOLUSDT','hyperliquid:@107')) or exists(select 1 from neptune_v2_private.native_fill_attribution) then raise exception 'Install native audit before first native activity; historical backfill requires separate review';end if;end$$;
alter table public.neptune_paper_v2_history drop constraint neptune_paper_v2_history_kind_check;
alter table public.neptune_paper_v2_history add constraint neptune_paper_v2_history_kind_check check(kind=any(array['decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger','native_decisions','native_orders','native_fills','native_results','native_settlements','native_order_events','native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution']));
create function neptune_v2_private.native_audit_project(raw jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare clean jsonb; c jsonb;begin
 raw:=raw||coalesce(raw->'accounting','{}'::jsonb);
 c:=raw->'quote_conversion';
 if jsonb_typeof(c)='object' then
 select raw||coalesce(jsonb_object_agg('conversion_'||key,value),'{}'::jsonb) into raw from jsonb_each(c);
 end if;
 select coalesce(jsonb_object_agg(key,case when key=any(array['price','qty','risk_base','stop','target','initial_risk_base','fx','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','fx_applied_rate','fx_cost_base','pnl_base','net_r','usd_amount','delta','balance','amount','gross_qty','gross_quote','fee_qty','fee_quote','fee_rate','net_inventory_delta','net_quote_delta','inventory_delta','net_quote','cost_base','risk_remaining','cost_remaining','qty_remaining','qty_step','dust_inventory','sellable_inventory','quote_amount','conversion_amount','conversion_usd_amount','conversion_adverse_cost_usd','conversion_raw_usd_per_quote','conversion_applied_usd_per_quote','cash_delta','liquidation_floor_base','conservative_risk_base']) and value<>'null'::jsonb then to_jsonb(value#>>'{}') else value end),'{}'::jsonb) into clean
 from jsonb_each(raw) where key=any(array['venue','market_type','specialist_id','id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','native_model_version','native_model_hash','exit_native_model_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance','schema_version','agent_id','currency','ledger_kind','amount','settlement_id','gross_qty','gross_quote','fee_qty','fee_quote','fee_currency','fee_rate','fee_model','fee_denomination_basis','order_model','net_inventory_delta','net_quote_delta','inventory_delta','net_quote','cost_base','risk_remaining','cost_remaining','qty_remaining','qty_step','dust_inventory','sellable_inventory','position_status','canonical_exposure','quote_amount','conversion_at','conversion_model','conversion_amount','conversion_source','conversion_currency','conversion_usd_amount','conversion_timestamp_basis','conversion_adverse_cost_usd','conversion_raw_usd_per_quote','conversion_applied_usd_per_quote','cash_delta','exit_source_hash','exit_config_hash','previous_native_fill_id','inventory_cycle_id','cost_basis_method','sold_entire_sellable_inventory','exit_reason','verified_fee_dust','valuation_basis','liquidation_floor_base','conservative_risk_base','last_fill_id']) and jsonb_typeof(value) in ('string','number','boolean','null');
 return clean||'{"schema_version":3}'::jsonb;
end$$;
create or replace function neptune_v2_private.mirror_history() returns trigger language plpgsql security invoker set search_path='' as $$
declare raw jsonb;clean jsonb;build neptune_v2_private.build_metadata;
begin
 if tg_table_schema<>'neptune_v2_private' or tg_table_name not in ('decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger') then raise exception 'Invalid history source';end if;
 select * into build from neptune_v2_private.build_metadata order by id desc limit 1;if not found then raise exception 'Reviewed source metadata required';end if;
 raw:=case when tg_table_name in ('cash_ledger','usd_ledger') then to_jsonb(new) else to_jsonb(new)->'payload' end;
 if tg_table_name='order_events' then raw:=raw||jsonb_build_object('order_id',to_jsonb(new)->'order_id','status',to_jsonb(new)->'status');end if;
 if tg_table_name='order_events' and raw->>'asset' is null then
 raw:=raw||coalesce((select jsonb_build_object('asset',payload->>'asset','venue',payload->>'venue','quote_currency',payload->>'quote_currency','specialist_id',payload->>'specialist_id') from neptune_v2_private.orders where id=to_jsonb(new)->>'order_id' and payload->>'asset' in ('binance:SOLUSDT','hyperliquid:@107')),'{}'::jsonb);
 end if;
 if raw->>'asset' in ('binance:SOLUSDT','hyperliquid:@107') then
 clean:=neptune_v2_private.native_audit_project(raw||jsonb_build_object('id',new.id,'at',new.at));
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash)
 values('native_'||tg_table_name,new.id,new.at,clean,coalesce(clean->>'source_hash',build.source_hash),coalesce(clean->>'config_hash',build.config_hash));return new;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into clean from jsonb_each(raw) where key=any(array[
 'venue','market_type','specialist_id','id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','native_model_version','native_model_hash','exit_native_model_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance']);
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash) values(tg_table_name,new.id,new.at,clean,coalesce(clean->>'source_hash',build.source_hash),coalesce(clean->>'config_hash',build.config_hash));return new;
end$$;
create function neptune_v2_private.mirror_native_audit() returns trigger language plpgsql security invoker set search_path='' as $$
declare raw jsonb:=to_jsonb(new);clean jsonb;eid text;t timestamptz;fid text;f neptune_v2_private.fills;build neptune_v2_private.build_metadata;
begin
 if tg_table_schema<>'neptune_v2_private' or tg_table_name not in ('native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution') then raise exception 'Invalid native audit source';end if;
 fid:=coalesce(raw->>'fill_id',raw->>'exit_fill_id');
 select * into f from neptune_v2_private.fills where id=fid;
 if not found or f.payload->>'asset' not in ('binance:SOLUSDT','hyperliquid:@107') then raise exception 'Native audit authoritative fill missing';end if;
 eid:=coalesce(raw->>'id',raw->>'fill_id',raw->>'exit_fill_id');
 t:=coalesce((raw->>'at')::timestamptz,f.at);
 if tg_table_name='native_settlement_attribution' then select at into t from neptune_v2_private.settlements where id=raw->>'settlement_id';end if;
 raw:=raw||jsonb_build_object('id',eid,'at',t,'asset',f.payload->>'asset','venue',f.payload->>'venue','quote_currency',f.payload->>'quote_currency','market_type','spot','specialist_id',f.payload->>'specialist_id','ledger_kind',raw->>'kind','native_model_version',f.payload->>'native_model_version','native_model_hash',f.payload->>'native_model_hash');
 clean:=neptune_v2_private.native_audit_project(raw);
 select * into build from neptune_v2_private.build_metadata order by id desc limit 1;if not found then raise exception 'Reviewed source metadata required';end if;
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash) values(tg_table_name,eid,t,clean,coalesce(f.payload->>'source_hash',build.source_hash),coalesce(f.payload->>'config_hash',build.config_hash));
 return new;
end$$;
do $$declare t text;begin foreach t in array array['native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution'] loop
 execute format('create trigger mirror_native_history after insert on neptune_v2_private.%I for each row execute function neptune_v2_private.mirror_native_audit()',t);
end loop;end$$;
revoke all on function neptune_v2_private.native_audit_project(jsonb),neptune_v2_private.mirror_native_audit() from public,anon,authenticated,service_role;

-- Configure disabled native collector; existing owner Resume synchronizes enabled state.
do $$begin
 if not coalesce((select contract_verified and not terminal from neptune_v2_private.feed_control where id),false) then raise exception 'Existing reviewed collector transport required';end if;
 if (select pending_epoch from neptune_v2_private.feed_control where id) is not null then raise exception 'Pending legacy batch must drain under acknowledged Stop';end if;
 if (select coalesce(sum(pg_total_relation_size(c.oid)),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','m') and (n.nspname in ('neptune_v2_private','neptune_mv_private') or (n.nspname='public' and c.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control'))))>=32*1024*1024 then raise exception 'Insufficient bounded audit headroom';end if;
 if exists(select 1 from (values('id','bigint'),('status_code','integer'),('content_type','text'),('headers','jsonb'),('content','text'),('timed_out','boolean'),('error_msg','text'),('created','timestamp with time zone')) e(name,type_name) where not exists(select 1 from pg_attribute a where a.attrelid='net._http_response'::regclass and a.attname=e.name and a.atttypid=e.type_name::regtype and a.attnum>0 and not a.attisdropped)) then raise exception 'Trusted pg_net response contract mismatch';end if;
 if not exists(select 1 from neptune_v2_private.feed_control f join cron.job j on j.jobid=f.job_id where f.id and j.jobname='neptune-v2-feed-guard' and j.username=f.job_owner and j.database=f.job_database and j.active and j.command='set statement_timeout=''8s''; select neptune_v2_private.feed_tick();') then raise exception 'Existing unchanged bounded feed guard required';end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net' and p.proname='http_get' and p.prorettype='bigint'::regtype and array['url','params','headers','timeout_milliseconds']::text[]<@p.proargnames) or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net' and p.proname='http_post' and p.prorettype='bigint'::regtype and array['url','body','params','headers','timeout_milliseconds']::text[]<@p.proargnames) then raise exception 'Reviewed pg_net transport signature missing';end if;
end$$;
insert into neptune_mv_private.control(id,enabled,contract_verified,started_at) values(true,false,true,clock_timestamp());
revoke all on schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
revoke all on all tables in schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
do $$begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private function client ACL detected';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private relation client ACL detected';end if;
 if exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private schema client ACL detected';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('neptune_v2_private','neptune_mv_private') and (p.prosecdef or not coalesce('search_path=""'=any(p.proconfig),false))) then raise exception 'Private invoker/search path contract failed';end if;
 if exists(select 1 from native_cutover_preserved p join neptune_v2_private.account a on a.id='neptune-paper-v2' where p.account_row is distinct from to_jsonb(a) or p.control_row is distinct from (select to_jsonb(c) from public.neptune_paper_v2_control c where c.id=a.id) or p.specialists is distinct from (select jsonb_agg(to_jsonb(s) order by s.id) from neptune_v2_private.specialist_accounts s) or p.history_count<>(select count(*) from public.neptune_paper_v2_history) or p.cash_count<>(select count(*) from neptune_v2_private.cash_ledger) or p.positions is distinct from (select coalesce(jsonb_agg(to_jsonb(x) order by x.asset),'[]') from neptune_v2_private.positions x) or p.public_status is distinct from (select to_jsonb(x) from public.neptune_paper_v2_status x where x.id=a.id) or p.legacy_feed is distinct from (select to_jsonb(x) from neptune_v2_private.feed_control x where x.id)) then raise exception 'Migration altered accounting/control/history';end if;
 perform neptune_v2_private.native_scan_reconcile();
end$$;
insert into neptune_v2_private.build_metadata(id,source_hash,config_hash,recorded_at) values(6,'86a41220930d1ffde29a910e9d5579dfe2add0ec2e225d937585b03600282bb9','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',clock_timestamp());
commit;
