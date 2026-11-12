create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner', 'admin'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  category text not null check (length(category) between 1 and 80),
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null check (length(size) between 1 and 32),
  color text not null default 'Standard' check (length(color) between 1 and 60),
  stock integer not null default 0 check (stock >= 0),
  unique (product_id, size, color)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null unique,
  customer_name text not null,
  phone text not null,
  email text not null,
  fulfilment text not null check (fulfilment in ('delivery', 'pickup')),
  delivery_zone text,
  fulfilment_details text not null,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  delivery_fee numeric(10,2) check (delivery_fee >= 0),
  total numeric(10,2) check (total >= 0),
  order_status text not null check (order_status in ('awaiting_payment', 'awaiting_quote', 'paid', 'processing', 'ready_for_pickup', 'shipped', 'completed', 'cancelled')),
  payment_status text not null default 'awaiting_payment' check (payment_status in ('awaiting_payment', 'verified', 'rejected')),
  items jsonb not null,
  created_at timestamptz not null default now(),
  check ((delivery_fee is null and total is null) or (delivery_fee is not null and total = subtotal + delivery_fee)),
  check (order_status <> 'awaiting_quote' or (payment_status = 'awaiting_payment' and delivery_fee is null)),
  check (order_status not in ('paid', 'processing', 'ready_for_pickup', 'shipped', 'completed') or (payment_status = 'verified' and total is not null))
);

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_holder text not null,
  account_number text not null,
  branch_code text not null default '',
  account_type text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pickup_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscribers (
  id bigint generated always as identity primary key,
  email text unique not null,
  created_at timestamptz not null default now()
);

create or replace function public.admin_create_product(
  p_name text,
  p_category text,
  p_description text,
  p_price numeric,
  p_size text,
  p_color text,
  p_stock integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_product_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 120
     or length(trim(coalesce(p_category, ''))) not between 1 and 80
     or p_price is null or p_price < 0
     or length(trim(coalesce(p_size, ''))) not between 1 and 32
     or length(trim(coalesce(p_color, ''))) not between 1 and 60
     or p_stock is null or p_stock < 0 then
    raise exception 'Product or initial stock details are invalid';
  end if;
  insert into public.products (name, category, description, price)
    values (trim(p_name), trim(p_category), coalesce(trim(p_description), ''), p_price)
    returning id into new_product_id;
  insert into public.product_variants (product_id, size, color, stock)
    values (new_product_id, trim(p_size), trim(p_color), p_stock);
  return new_product_id;
end;
$$;

create or replace function public.create_order(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_fulfilment text,
  p_delivery_zone text,
  p_pickup_location_id uuid,
  p_fulfilment_details text,
  p_items jsonb
)
returns table (order_reference text, subtotal numeric, order_status text, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  variant_row public.product_variants%rowtype;
  product_row public.products%rowtype;
  line_quantity integer;
  order_subtotal numeric(10,2) := 0;
  order_items jsonb := '[]'::jsonb;
  order_id uuid := gen_random_uuid();
  order_ref text := 'HK-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  next_status text;
  next_fee numeric(10,2);
begin
  if length(trim(coalesce(p_customer_name, ''))) not between 2 and 120
     or length(trim(coalesce(p_phone, ''))) not between 7 and 40
     or length(trim(coalesce(p_email, ''))) not between 5 and 254
     or trim(coalesce(p_email, '')) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
     or p_fulfilment is null
     or p_fulfilment not in ('delivery', 'pickup')
     or length(trim(coalesce(p_fulfilment_details, ''))) not between 3 and 500 then
    raise exception 'Please provide valid contact and fulfilment details';
  end if;
  if p_fulfilment = 'delivery' and coalesce(p_delivery_zone, '') not in ('Soshanguve', 'Pretoria', 'Other') then
    raise exception 'Please select a valid delivery area';
  end if;
  if p_fulfilment = 'pickup' and not exists (
    select 1 from public.pickup_locations where id = p_pickup_location_id and active = true
  ) then
    raise exception 'Please choose an available pickup location';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then
    raise exception 'The order items must be an array';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'The order must contain between 1 and 50 items';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(item->>'variant_id', '') = '' or coalesce(item->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'An order item is invalid';
    end if;
    line_quantity := (item->>'quantity')::integer;
    if line_quantity < 1 or line_quantity > 20 then
      raise exception 'Item quantity must be between 1 and 20';
    end if;
    select * into variant_row from public.product_variants
      where id = (item->>'variant_id')::uuid for update;
    if not found or variant_row.stock < line_quantity then
      raise exception 'An item is unavailable or has insufficient stock';
    end if;
    select * into product_row from public.products
      where id = variant_row.product_id and active = true;
    if not found then
      raise exception 'An item is no longer available';
    end if;
    order_subtotal := order_subtotal + (product_row.price * line_quantity);
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'product_id', product_row.id,
      'variant_id', variant_row.id,
      'name', product_row.name,
      'size', variant_row.size,
      'color', variant_row.color,
      'unit_price', product_row.price,
      'quantity', line_quantity
    ));
    update public.product_variants set stock = stock - line_quantity where id = variant_row.id;
  end loop;

  if p_fulfilment = 'pickup' then
    next_fee := 0;
    next_status := 'awaiting_payment';
  elsif order_subtotal > 1500 and p_delivery_zone in ('Soshanguve', 'Pretoria') then
    next_fee := 0;
    next_status := 'awaiting_payment';
  else
    next_fee := null;
    next_status := 'awaiting_quote';
  end if;

  insert into public.orders (
    id, order_reference, customer_name, phone, email, fulfilment, delivery_zone,
    fulfilment_details, subtotal, delivery_fee, total, order_status, payment_status, items
  ) values (
    order_id, order_ref, trim(p_customer_name), trim(p_phone), lower(trim(p_email)),
    p_fulfilment, case when p_fulfilment = 'delivery' then p_delivery_zone else null end,
    trim(p_fulfilment_details), order_subtotal, next_fee,
    case when next_fee is null then null else order_subtotal + next_fee end,
    next_status, 'awaiting_payment', order_items
  );
  return query select order_ref, order_subtotal, next_status,
    case when next_fee is null then null else order_subtotal + next_fee end;
end;
$$;

create or replace function public.restore_cancelled_order_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
begin
  if old.order_status <> 'cancelled' and new.order_status = 'cancelled' then
    for item in select value from jsonb_array_elements(new.items)
    loop
      update public.product_variants
        set stock = stock + (item->>'quantity')::integer
        where id = (item->>'variant_id')::uuid;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_restore_stock_on_cancel on public.orders;
create trigger orders_restore_stock_on_cancel
  after update of order_status on public.orders
  for each row execute function public.restore_cancelled_order_stock();

create or replace function public.set_order_delivery_fee(p_order_id uuid, p_delivery_fee numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_delivery_fee is null or p_delivery_fee < 0 then
    raise exception 'Delivery fee must be zero or more';
  end if;
  update public.orders
    set delivery_fee = p_delivery_fee,
        total = subtotal + p_delivery_fee,
        order_status = 'awaiting_payment'
    where id = p_order_id and order_status = 'awaiting_quote';
  if not found then
    raise exception 'Order not found or delivery fee is already set';
  end if;
end;
$$;

create or replace function public.admin_list_users()
returns table (user_id uuid, email text, role text)
language sql
security definer
set search_path = ''
as $$
  select au.id, au.email::text, admins.role
  from auth.users au
  join public.admin_users admins on admins.user_id = au.id
  where public.is_owner()
  order by admins.created_at;
$$;

create or replace function public.admin_grant_user(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;
  select id into target_user_id from auth.users
    where lower(email) = lower(trim(p_email));
  if target_user_id is null then
    raise exception 'No registered account exists for that email';
  end if;
  insert into public.admin_users(user_id, role) values (target_user_id, 'admin')
    on conflict (user_id) do nothing;
end;
$$;

create or replace function public.admin_revoke_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;
  delete from public.admin_users where user_id = p_user_id and role = 'admin';
  if not found then
    raise exception 'Admin not found or owner access cannot be removed';
  end if;
end;
$$;

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.pickup_locations enable row level security;
alter table public.subscribers enable row level security;

drop policy if exists "Admins can read admin assignments" on public.admin_users;
drop policy if exists "public read products" on public.products;
drop policy if exists "public place orders" on public.orders;
drop policy if exists "Anyone can view active products" on public.products;
drop policy if exists "Admins manage products" on public.products;
drop policy if exists "Anyone can view available product variants" on public.product_variants;
drop policy if exists "Admins manage product variants" on public.product_variants;
drop policy if exists "Admins can view orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Anyone can view active payment accounts" on public.payment_accounts;
drop policy if exists "Admins manage payment accounts" on public.payment_accounts;
drop policy if exists "Anyone can view active pickup locations" on public.pickup_locations;
drop policy if exists "Admins manage pickup locations" on public.pickup_locations;
drop policy if exists "public subscribe" on public.subscribers;

create policy "Admins can read admin assignments" on public.admin_users
  for select to authenticated using (public.is_admin() or user_id = (select auth.uid()));
create policy "Anyone can view active products" on public.products
  for select to anon, authenticated using (active or public.is_admin());
create policy "Admins manage products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Anyone can view available product variants" on public.product_variants
  for select to anon, authenticated using (
    stock > 0 and exists (select 1 from public.products p where p.id = product_id and p.active = true)
    or public.is_admin()
  );
create policy "Admins manage product variants" on public.product_variants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can view orders" on public.orders
  for select to authenticated using (public.is_admin());
create policy "Admins can update orders" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Anyone can view active payment accounts" on public.payment_accounts
  for select to anon, authenticated using (active or public.is_admin());
create policy "Admins manage payment accounts" on public.payment_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Anyone can view active pickup locations" on public.pickup_locations
  for select to anon, authenticated using (active or public.is_admin());
create policy "Admins manage pickup locations" on public.pickup_locations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Public can subscribe" on public.subscribers
  for insert to anon, authenticated with check (length(email) between 5 and 254);

revoke all on function public.create_order(text, text, text, text, text, uuid, text, jsonb) from public;
grant execute on function public.create_order(text, text, text, text, text, uuid, text, jsonb) to anon, authenticated;
revoke all on function public.admin_create_product(text, text, text, numeric, text, text, integer) from public;
grant execute on function public.admin_create_product(text, text, text, numeric, text, text, integer) to authenticated;
revoke all on function public.set_order_delivery_fee(uuid, numeric) from public;
grant execute on function public.set_order_delivery_fee(uuid, numeric) to authenticated;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
revoke all on function public.admin_grant_user(text) from public;
grant execute on function public.admin_grant_user(text) to authenticated;
revoke all on function public.admin_revoke_user(uuid) from public;
grant execute on function public.admin_revoke_user(uuid) to authenticated;

grant select on public.products, public.product_variants, public.payment_accounts, public.pickup_locations to anon, authenticated;
grant select, update on public.orders to authenticated;
grant select on public.admin_users to authenticated;
grant insert on public.subscribers to anon, authenticated;
