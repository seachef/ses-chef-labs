-- LOCAL CANDIDATE ONLY. No seed, grants, scheduler, extensions, or existing-object changes.
create schema neptune_v2_private;
revoke all on schema neptune_v2_private from public;
create table neptune_v2_private.account (
 id text primary key check(id='neptune-paper-v2'), currency text not null check(currency in ('AUD','USD')),
 initial_cash numeric(30,12) not null check(initial_cash=10000),
 cash numeric(30,12) not null check(cash>=0 and cash<=1000000000),
 state jsonb not null check(octet_length(state::text)<=262144),
 revision bigint not null default 0, observations bigint not null default 0,
 created_at timestamptz not null default clock_timestamp()
);
create table neptune_v2_private.observations (
 id text primary key check(length(id)<=128), at timestamptz not null,
 payload jsonb not null check(octet_length(payload::text)<=262144)
);
create table neptune_v2_private.decisions (
 id text primary key, observation_id text not null references neptune_v2_private.observations(id),
 at timestamptz not null, payload jsonb not null check(octet_length(payload::text)<=8192)
);
create table neptune_v2_private.orders (
 id text primary key, decision_id text not null unique references neptune_v2_private.decisions(id),
 observation_id text not null references neptune_v2_private.observations(id), at timestamptz not null,
 payload jsonb not null check(octet_length(payload::text)<=8192)
);
create table neptune_v2_private.fills (
 id text primary key, order_id text not null unique references neptune_v2_private.orders(id),
 observation_id text not null references neptune_v2_private.observations(id), at timestamptz not null,
 cash_delta numeric(30,12) check(cash_delta between -1000000000 and 1000000000),
 payload jsonb not null check(octet_length(payload::text)<=8192)
);
create table neptune_v2_private.cash_ledger (
 id text primary key, fill_id text unique references neptune_v2_private.fills(id), at timestamptz not null,
 delta numeric(30,12) not null check(delta between -1000000000 and 1000000000),
 balance numeric(30,12) not null check(balance between 0 and 1000000000)
);
create table neptune_v2_private.results (
 id text primary key, exit_fill_id text not null references neptune_v2_private.fills(id),
 at timestamptz not null, payload jsonb not null check(octet_length(payload::text)<=8192)
);
create function neptune_v2_private.immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Append-only paper audit records'; end $$;
revoke all on function neptune_v2_private.immutable() from public;
do $$ declare t text; begin
 foreach t in array array['observations','decisions','orders','fills','cash_ledger','results'] loop
 execute format('create trigger immutable_rows before update or delete on neptune_v2_private.%I for each row execute function neptune_v2_private.immutable()',t);
 execute format('create trigger immutable_table before truncate on neptune_v2_private.%I for each statement execute function neptune_v2_private.immutable()',t);
 end loop;
 foreach t in array array['account','observations','decisions','orders','fills','cash_ledger','results'] loop
 execute format('alter table neptune_v2_private.%I enable row level security',t);
 execute format('revoke all on neptune_v2_private.%I from public',t);
 end loop;
end $$;
create table public.neptune_paper_v2_status (
 id text primary key check(id='neptune-paper-v2'),
 payload jsonb not null check(octet_length(payload::text)<=262144), updated_at timestamptz not null
);
alter table public.neptune_paper_v2_status enable row level security;
revoke all on public.neptune_paper_v2_status from public;
-- Intentionally NO SELECT policy or client grants. Independent review and approval precede publication.

create table neptune_v2_private.usd_ledger (
 id text primary key, fill_id text references neptune_v2_private.fills(id), at timestamptz not null,
 delta numeric(30,12) not null check(delta between -1000000000 and 1000000000)
);
create table neptune_v2_private.settlements (
 id text primary key, exit_fill_id text not null unique references neptune_v2_private.fills(id),
 at timestamptz not null, payload jsonb not null check(octet_length(payload::text)<=8192)
);
alter table neptune_v2_private.usd_ledger enable row level security;
alter table neptune_v2_private.settlements enable row level security;
create trigger immutable_rows before update or delete on neptune_v2_private.usd_ledger for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.usd_ledger for each statement execute function neptune_v2_private.immutable();
create trigger immutable_rows before update or delete on neptune_v2_private.settlements for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.settlements for each statement execute function neptune_v2_private.immutable();

create table neptune_v2_private.order_events (
 id text primary key, order_id text not null references neptune_v2_private.orders(id),
 observation_id text not null references neptune_v2_private.observations(id), at timestamptz not null,
 status text not null check(status in ('pending','filled','cancelled','blocked')), payload jsonb not null
);
alter table neptune_v2_private.order_events enable row level security;
create trigger immutable_rows before update or delete on neptune_v2_private.order_events for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.order_events for each statement execute function neptune_v2_private.immutable();

create table neptune_v2_private.build_metadata (
 id bigint primary key check(id>0), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 config_hash text not null check(config_hash ~ '^[a-f0-9]{64}$'), recorded_at timestamptz not null default clock_timestamp()
);
alter table neptune_v2_private.build_metadata enable row level security;
create trigger immutable_rows before update or delete on neptune_v2_private.build_metadata for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.build_metadata for each statement execute function neptune_v2_private.immutable();
