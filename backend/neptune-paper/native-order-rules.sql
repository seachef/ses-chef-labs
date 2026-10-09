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
