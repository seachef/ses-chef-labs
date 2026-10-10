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
create function neptune_mv_private.parse(v text,k text,raw text,received timestamptz,cutoff timestamptz,meta jsonb default null,protective boolean default false,observed_upper timestamptz default null) returns jsonb language plpgsql stable set search_path='' as $$
declare j jsonb;p jsonb;b jsonb;q jsonb;x jsonb;f jsonb;out jsonb:='{}';arr jsonb;levels jsonb;side int;px numeric;sz numeric;prev numeric;t numeric;last_t numeric;lo numeric;hi numeric;op numeric;cl numeric;vol numeric:=0;quotevol numeric:=0;lowerquote numeric:=0;cnt int:=0;id text;quote text;lot jsonb;pricefilter jsonb;notional jsonb;marketlot jsonb;upper_ms bigint:=neptune_mv_private.ms(cutoff);received_ms bigint:=neptune_mv_private.ms(received);observed_time timestamptz:=coalesce(observed_upper,received);observed_ms bigint:=neptune_mv_private.ms(coalesce(observed_upper,received));window_ms bigint:=floor(neptune_mv_private.ms(received)/900000)*900000;rules jsonb;
begin
 if v is null or v not in ('binance','hyperliquid','USDT','USDC') or received is null or cutoff is null or observed_time is null or observed_time<received or observed_time>cutoff or received>cutoff or received<cutoff-interval '30 seconds' or raw is null or octet_length(raw)>neptune_mv_private.limit_bytes(k) then return null;end if;
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
    if px is null or sz is null or px<=0 or sz<=0 or t is null or t<=0 or t*1000>observed_ms or (prev is not null and ((side=0 and px>=prev) or (side=1 and px<=prev))) then return null;end if;
    arr:=arr||jsonb_build_array(jsonb_build_array(px::text,sz::text,t));prev:=px;
   end loop;out:=out||jsonb_build_object(case side when 0 then 'bids' else 'asks' end,arr);
  end loop;
  if (out#>>'{bids,0,0}')::numeric>=(out#>>'{asks,0,0}')::numeric then return null;end if;
  return jsonb_build_object('asset',v||'/USD','base',v,'quote','USD','book',out||jsonb_build_object('at',received,'timestamp_basis','conservative_sample_lower_bound','level_timestamp_basis','last_level_modification'),'received_at',received,'metadata',meta,'basis','observed_size_limited_depth','peg_assumed',false);
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
  if px is null or px<=0 or sz is null or sz<>floor(sz) or t is null or t<>floor(t) or t>observed_ms or t<upper_ms-60000 then return null;end if;
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
  if v='hyperliquid' then t:=neptune_mv_private.num(j->>'time');if t is null or t<>floor(t) or t>observed_ms or t<upper_ms-15000 then return null;end if;
  else t:=null;px:=neptune_mv_private.num(j->>'lastUpdateId');if px is null or px<>floor(px) or px<=0 then return null;end if;end if;
  return jsonb_build_object('book',out||jsonb_build_object('at',case when v='hyperliquid' then to_timestamp((t/1000)::double precision) else received end,'source_timestamp_ms',t,'sequence',case v when 'binance' then j->'lastUpdateId' else null end,'timestamp_basis',case v when 'binance' then 'conservative_sample_lower_bound' else 'venue_timestamp' end),'received_at',received,'protective_only',protective,'metadata_stale',(meta->>'at')::timestamptz<cutoff-interval '1 hour','entry_eligible',false);
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
   if t is null or mod(t,900000)<>0 or px is null or px<>t+899999 or t>observed_ms or op is null or hi is null or lo is null or cl is null or sz is null or least(op,lo,cl)<=0 or hi<greatest(op,lo,cl) or lo>least(op,hi,cl) or (v='binance' and prev is null) then return null;end if;
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
   t:=neptune_mv_private.num(x->>'time');if px is null or px<=0 or sz is null or sz<=0 or t is null or t<>floor(t) or t>observed_ms or t<=0 then return null;end if;last_t:=greatest(last_t,t);
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
 update neptune_mv_private.control set provider_blocked=c.provider_blocked where id and provider_blocked is distinct from c.provider_blocked;
 if not exists(select 1 from jsonb_array_elements_text(neptune_v2_private.native_activation_policy()->'native_collection_venues') x(v) where not(c.identity_blocked?x.v) and not(c.provider_blocked?neptune_mv_private.provider(x.v))) then return 'providers_blocked';end if;
 if c.last_epoch is not null and (ep<=c.last_epoch or n<c.last_dispatch_at+interval '60 seconds') then return 'rate_limited';end if;
 update neptune_mv_private.control set last_epoch=ep,last_dispatch_at=n,pending_epoch=ep,pending_owner_epoch=owner_epoch,pending_at=n,batches=batches+1 where id;
 foreach v in array array['binance','hyperliquid','USDT','USDC'] loop
  if not coalesce((neptune_v2_private.native_activation_policy()->'native_collection_venues')?v,false) then continue;end if;
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
declare c neptune_mv_private.control;n timestamptz:=clock_timestamp();q record;r record;p jsonb;m jsonb;out jsonb:='{"schema_version":1,"markets":{},"quote_fx":{},"entry_eligible":false}';e jsonb;ready int;expected int;bytes bigint:=0;bad boolean:=false;outcome text:='processed';cache_age numeric;d timestamptz;prov text;block jsonb;receipt jsonb;lower_time timestamptz;observed_time timestamptz;
begin
 select * into c from neptune_mv_private.control where id for update;if not found or c.pending_epoch is null or c.terminal then return null;end if;
 perform neptune_mv_private.observe_pending('native',c.pending_epoch);n:=clock_timestamp();
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
   receipt:=neptune_mv_private.observe_response('native',q.request_id);
   if receipt is null or c.provider_blocked?neptune_mv_private.provider(q.venue) then continue;end if;
   select * into r from jsonb_populate_record(null::net._http_response,receipt->'response');
   lower_time:=(receipt->>'sample_lower_bound')::timestamptz;observed_time:=(receipt->>'first_observed_at')::timestamptz;
   if observed_time>n then continue;end if;
   if r.status_code is distinct from 200 or coalesce(r.timed_out,false) or r.error_msg is not null or r.created is null or lower_time<q.sent_at or lower_time>q.sent_at+interval '10 seconds' or lower_time>n or lower_time<n-interval '30 seconds' or observed_time<lower_time or coalesce(r.content_type,'') not ilike 'application/json%' or octet_length(r.content)>neptune_mv_private.limit_bytes(q.kind) then continue;end if;
   -- Cached market responses cannot masquerade as current transport evidence.
   begin
    cache_age:=neptune_mv_private.num(coalesce(r.headers->>'age',r.headers->>'Age'));
    if (r.headers?'age' or r.headers?'Age') and (cache_age is null or cache_age>case q.kind when 'metadata' then 3600 when 'bars' then 60 else 5 end) then continue;end if;
    if r.headers?'date' or r.headers?'Date' then d:=coalesce(r.headers->>'date',r.headers->>'Date')::timestamptz;if d>observed_time+interval '5 seconds' or d<q.sent_at-make_interval(secs=>case q.kind when 'metadata' then 3600 when 'bars' then 60 else 5 end) then continue;end if;end if;
   exception when others then continue;end;
   if q.kind='metadata' and neptune_mv_private.identity_conflict(q.venue,r.content) then c.identity_blocked:=c.identity_blocked||jsonb_build_object(q.venue,jsonb_build_object('reason','source_identity_or_tradability_conflict','at',n,'request_id',q.request_id,'source',q.url,'body_sha256',encode(sha256(convert_to(r.content,'UTF8')),'hex')));continue;end if;
   if c.identity_blocked?q.venue then continue;end if;
   m:=c.metadata->q.venue;
   if q.protective_only then
    select payload into m from neptune_mv_private.payload_blobs where id=q.held_rules_ref and kind='metadata';
    if m is null or encode(sha256(convert_to('metadata:'||m::text,'UTF8')),'hex') is distinct from q.held_rules_ref or m->>'revision' is distinct from neptune_mv_private.held_metadata(q.venue)->>'revision' then continue;end if;
   end if;
   if q.kind<>'metadata' and q.metadata_revision is distinct from m->>'revision' then continue;end if;
   p:=neptune_mv_private.parse(q.venue,q.kind,r.content,lower_time,n,m,q.protective_only,observed_time);if p is null then continue;end if;
   e:=jsonb_build_object('request_id',q.request_id,'source',q.url,'request_body',q.body,'sent_at',q.sent_at,'received_at',lower_time,'received_at_basis','conservative_sample_lower_bound','batch_started_at',r.created,'first_observed_at',observed_time,'wire_received_at',null,'request_sha256',receipt->>'request_sha256','response_sha256',receipt->>'response_sha256','body_sha256',encode(sha256(convert_to(r.content,'UTF8')),'hex'),'epoch',q.epoch,'metadata_revision',q.metadata_revision,'protective_only',q.protective_only,'held_rules_ref',q.held_rules_ref,'http_headers',jsonb_build_object('date',coalesce(r.headers->>'date',r.headers->>'Date'),'age',cache_age),'provenance','trusted_pg_net');
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
