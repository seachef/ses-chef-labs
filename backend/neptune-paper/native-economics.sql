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
