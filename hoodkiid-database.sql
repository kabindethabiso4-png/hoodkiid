create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  whatsapp_phone text not null check (length(whatsapp_phone) between 7 and 40),
  call_phone text check (call_phone is null or length(call_phone) between 7 and 40),
  created_at timestamptz not null default now()
);

alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner', 'admin'));

create or replace function public.create_customer_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_name_value text;
  last_name_value text;
  whatsapp_value text;
  call_value text;
begin
  first_name_value := trim(coalesce(new.raw_user_meta_data->>'first_name', ''));
  last_name_value := trim(coalesce(new.raw_user_meta_data->>'last_name', ''));
  whatsapp_value := trim(coalesce(new.raw_user_meta_data->>'whatsapp_phone', ''));
  call_value := nullif(trim(coalesce(new.raw_user_meta_data->>'call_phone', '')), '');
  if length(first_name_value) between 1 and 80
     and length(last_name_value) between 1 and 80
     and length(whatsapp_value) between 7 and 40
     and (call_value is null or length(call_value) between 7 and 40) then
    insert into public.customer_profiles (user_id, first_name, last_name, whatsapp_phone, call_phone)
    values (new.id, first_name_value, last_name_value, whatsapp_value, call_value)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists create_customer_profile_after_signup on auth.users;
create trigger create_customer_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_customer_profile_for_auth_user();

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
  image_urls text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products add column if not exists image_urls text[] not null default '{}';
update public.products set active = false where active and cardinality(image_urls) = 0;
alter table public.products drop constraint if exists products_active_requires_image;
alter table public.products add constraint products_active_requires_image
  check (not active or (cardinality(image_urls) > 0 and array_position(image_urls, null) is null));

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
  customer_id uuid references auth.users(id) on delete set null,
  order_reference text not null unique,
  customer_name text not null,
  phone text not null,
  whatsapp_phone text not null default '',
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

alter table public.orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists whatsapp_phone text not null default '';
update public.orders set whatsapp_phone = phone where whatsapp_phone = '';
update public.orders orders
  set customer_id = users.id
  from auth.users users
  where orders.customer_id is null and lower(orders.email) = lower(users.email);
create index if not exists orders_customer_id_created_at_idx on public.orders (customer_id, created_at desc);

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

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  request_type text not null check (request_type in ('deletion')),
  status text not null default 'pending' check (status in ('pending', 'in_review', 'completed', 'declined')),
  created_at timestamptz not null default now()
);

create unique index if not exists privacy_requests_one_open_deletion_per_user_idx
  on public.privacy_requests (user_id)
  where user_id is not null and status in ('pending', 'in_review');

drop function if exists public.admin_create_product(text, text, text, numeric, text, text, integer);
create or replace function public.admin_create_product(
  p_name text,
  p_category text,
  p_description text,
  p_price numeric,
  p_size text,
  p_color text,
  p_stock integer,
  p_image_urls text[]
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
     or p_stock is null or p_stock < 0
     or p_image_urls is null or cardinality(p_image_urls) < 1 or cardinality(p_image_urls) > 5
     or exists (
       select 1 from unnest(p_image_urls) as image_urls(image_url)
       where image_url is null
         or length(image_url) > 2048
         or image_url !~ '^https://[^/]+/storage/v1/object/public/product-images/.+'
     ) then
    raise exception 'Product or initial stock details are invalid';
  end if;
  insert into public.products (name, category, description, price, image_urls)
    values (trim(p_name), trim(p_category), coalesce(trim(p_description), ''), p_price, p_image_urls)
    returning id into new_product_id;
  insert into public.product_variants (product_id, size, color, stock)
    values (new_product_id, trim(p_size), trim(p_color), p_stock);
  return new_product_id;
end;
$$;

drop function if exists public.create_order(text, text, text, text, text, uuid, text, jsonb);

create or replace function public.create_order(
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
  customer_user_id uuid := auth.uid();
  customer_profile public.customer_profiles%rowtype;
  customer_email text := auth.jwt()->>'email';
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
  if customer_user_id is null then
    raise exception 'Please sign in before placing an order';
  end if;
  select * into customer_profile from public.customer_profiles
    where user_id = customer_user_id;
  if not found then
    raise exception 'Please complete your account contact details before placing an order';
  end if;
  if length(trim(coalesce(customer_email, ''))) not between 5 and 254
     or customer_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
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
    id, order_reference, customer_id, customer_name, phone, whatsapp_phone, email, fulfilment, delivery_zone,
    fulfilment_details, subtotal, delivery_fee, total, order_status, payment_status, items
  ) values (
    order_id, order_ref, customer_user_id,
    trim(customer_profile.first_name || ' ' || customer_profile.last_name),
    coalesce(nullif(trim(customer_profile.call_phone), ''), trim(customer_profile.whatsapp_phone)),
    trim(customer_profile.whatsapp_phone), lower(trim(customer_email)),
    p_fulfilment, case when p_fulfilment = 'delivery' then p_delivery_zone else null end,
    trim(p_fulfilment_details), order_subtotal, next_fee,
    case when next_fee is null then null else order_subtotal + next_fee end,
    next_status, 'awaiting_payment', order_items
  );
  return query select order_ref, order_subtotal, next_status,
    case when next_fee is null then null else order_subtotal + next_fee end;
end;
$$;

create or replace function public.edit_own_unpaid_order(p_order_id uuid, p_items jsonb)
returns table (
  order_reference text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  order_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_user_id uuid := auth.uid();
  order_row public.orders%rowtype;
  item jsonb;
  variant_row public.product_variants%rowtype;
  product_row public.products%rowtype;
  variant_lock_id uuid;
  line_quantity integer;
  order_subtotal numeric(10,2) := 0;
  order_items jsonb := '[]'::jsonb;
  next_fee numeric(10,2);
  next_status text;
begin
  if customer_user_id is null then
    raise exception 'Please sign in before editing an order';
  end if;
  select * into order_row from public.orders
    where id = p_order_id and customer_id = customer_user_id
    for update;
  if not found or order_row.payment_status <> 'awaiting_payment'
     or order_row.order_status not in ('awaiting_payment', 'awaiting_quote') then
    raise exception 'This order is no longer available for editing';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'The order items must be an array';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'The order must contain between 1 and 50 items';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(item->>'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'An order item is invalid';
    end if;
    line_quantity := (item->>'quantity')::integer;
    if line_quantity < 1 or line_quantity > 20 then
      raise exception 'Item quantity must be between 1 and 20';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(order_row.items)
  loop
    if coalesce(item->>'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'This order cannot be edited because its saved items are invalid';
    end if;
  end loop;

  for variant_lock_id in
    select variant_ids.id
    from (
      select (old_item.value->>'variant_id')::uuid as id
      from jsonb_array_elements(order_row.items) as old_item(value)
      union
      select (new_item.value->>'variant_id')::uuid as id
      from jsonb_array_elements(p_items) as new_item(value)
    ) as variant_ids
    order by variant_ids.id
  loop
    perform 1 from public.product_variants where id = variant_lock_id for update;
  end loop;

  for item in select value from jsonb_array_elements(order_row.items)
  loop
    update public.product_variants
      set stock = stock + (item->>'quantity')::integer
      where id = (item->>'variant_id')::uuid;
  end loop;

  for item in select value from jsonb_array_elements(p_items)
  loop
    line_quantity := (item->>'quantity')::integer;
    select * into variant_row from public.product_variants
      where id = (item->>'variant_id')::uuid;
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

  if order_row.fulfilment = 'pickup' then
    next_fee := 0;
    next_status := 'awaiting_payment';
  elsif order_subtotal > 1500 and order_row.delivery_zone in ('Soshanguve', 'Pretoria') then
    next_fee := 0;
    next_status := 'awaiting_payment';
  else
    next_fee := null;
    next_status := 'awaiting_quote';
  end if;

  update public.orders
    set items = order_items,
        subtotal = order_subtotal,
        delivery_fee = next_fee,
        total = case when next_fee is null then null else order_subtotal + next_fee end,
        order_status = next_status
    where id = p_order_id;

  return query
    select updated.order_reference, updated.subtotal, updated.delivery_fee, updated.total, updated.order_status
    from public.orders updated
    where updated.id = p_order_id;
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
alter table public.customer_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.pickup_locations enable row level security;
alter table public.subscribers enable row level security;
alter table public.privacy_requests enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read admin assignments" on public.admin_users;
drop policy if exists "Customers can read own profile" on public.customer_profiles;
drop policy if exists "Customers can create own profile" on public.customer_profiles;
drop policy if exists "Customers can update own profile" on public.customer_profiles;
drop policy if exists "public read products" on public.products;
drop policy if exists "public place orders" on public.orders;
drop policy if exists "Anyone can view active products" on public.products;
drop policy if exists "Admins manage products" on public.products;
drop policy if exists "Anyone can view available product variants" on public.product_variants;
drop policy if exists "Admins manage product variants" on public.product_variants;
drop policy if exists "Admins can view orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Customers can view own orders" on public.orders;
drop policy if exists "Anyone can view active payment accounts" on public.payment_accounts;
drop policy if exists "Admins manage payment accounts" on public.payment_accounts;
drop policy if exists "Anyone can view active pickup locations" on public.pickup_locations;
drop policy if exists "Admins manage pickup locations" on public.pickup_locations;
drop policy if exists "public subscribe" on public.subscribers;
drop policy if exists "Customers can read own newsletter subscription" on public.subscribers;
drop policy if exists "Customers can read own privacy requests" on public.privacy_requests;
drop policy if exists "Customers can create own privacy requests" on public.privacy_requests;
drop policy if exists "Admins can read privacy requests" on public.privacy_requests;
drop policy if exists "Admins can update privacy requests" on public.privacy_requests;
drop policy if exists "Admins can upload product images" on storage.objects;
drop policy if exists "Admins can update product images" on storage.objects;
drop policy if exists "Admins can delete product images" on storage.objects;

create policy "Admins can read admin assignments" on public.admin_users
  for select to authenticated using (public.is_admin() or user_id = (select auth.uid()));
create policy "Customers can read own profile" on public.customer_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Customers can create own profile" on public.customer_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Customers can update own profile" on public.customer_profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Anyone can view active products" on public.products
  for select to anon, authenticated using (active or public.is_admin());
create policy "Admins manage products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Anyone can view available product variants" on public.product_variants
  for select to anon, authenticated using (
    stock > 0 and exists (select 1 from public.products p where p.id = product_id and p.active = true)
    or exists (
      select 1
      from public.orders o
      cross join lateral jsonb_array_elements(o.items) as order_item(value)
      where o.customer_id = (select auth.uid())
        and o.payment_status = 'awaiting_payment'
        and o.order_status in ('awaiting_payment', 'awaiting_quote')
        and order_item.value->>'variant_id' = product_variants.id::text
    )
    or public.is_admin()
  );
create policy "Admins manage product variants" on public.product_variants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can view orders" on public.orders
  for select to authenticated using (public.is_admin());
create policy "Customers can view own orders" on public.orders
  for select to authenticated using (customer_id = (select auth.uid()));
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
create policy "Customers can read own newsletter subscription" on public.subscribers
  for select to authenticated using (lower(email) = lower((select auth.jwt() ->> 'email')));
create policy "Customers can read own privacy requests" on public.privacy_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Customers can create own privacy requests" on public.privacy_requests
  for insert to authenticated with check (
    user_id = (select auth.uid()) and request_type = 'deletion' and status = 'pending'
  );
create policy "Admins can read privacy requests" on public.privacy_requests
  for select to authenticated using (public.is_admin());
create policy "Admins can update privacy requests" on public.privacy_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can upload product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
create policy "Admins can update product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "Admins can delete product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());

revoke all on function public.create_order(text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.create_order(text, text, uuid, text, jsonb) to authenticated;
revoke all on function public.edit_own_unpaid_order(uuid, jsonb) from public, anon;
grant execute on function public.edit_own_unpaid_order(uuid, jsonb) to authenticated;
revoke all on function public.admin_create_product(text, text, text, numeric, text, text, integer, text[]) from public;
grant execute on function public.admin_create_product(text, text, text, numeric, text, text, integer, text[]) to authenticated;
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
grant select, insert, update on public.customer_profiles to authenticated;
grant insert on public.subscribers to anon, authenticated;
grant select on public.subscribers to authenticated;
grant select, insert, update on public.privacy_requests to authenticated;

create or replace function public.valid_product_review_image_urls(p_urls text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p_urls) <= 3
    and array_position(p_urls, null) is null
    and not exists (
      select 1 from unnest(p_urls) as urls(url)
      where length(url) > 2048
        or url !~ '^https://[^/]+/storage/v1/object/public/product-review-images/.+'
    );
$$;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review_text text not null check (length(trim(review_text)) between 10 and 1500),
  image_urls text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_reply text check (admin_reply is null or length(admin_reply) <= 1500),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_reviews_images_valid check (public.valid_product_review_image_urls(image_urls))
);
alter table public.product_reviews drop constraint if exists product_reviews_images_valid;
alter table public.product_reviews add constraint product_reviews_images_valid
  check (public.valid_product_review_image_urls(image_urls));

create index if not exists product_reviews_product_created_idx
  on public.product_reviews (product_id, created_at desc);
create index if not exists product_reviews_customer_created_idx
  on public.product_reviews (customer_id, created_at desc);

create table if not exists public.product_review_votes (
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote text not null check (vote in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists public.website_visits (
  id bigint generated always as identity primary key,
  path text not null check (length(path) between 1 and 200 and left(path, 1) = '/'),
  created_at timestamptz not null default now()
);
create index if not exists website_visits_created_at_idx on public.website_visits (created_at desc);

create table if not exists public.customer_carts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  updated_at timestamptz not null default now()
);

alter table public.product_reviews enable row level security;
alter table public.product_review_votes enable row level security;
alter table public.website_visits enable row level security;
alter table public.customer_carts enable row level security;

drop policy if exists "Anyone can view approved product reviews" on public.product_reviews;
drop policy if exists "Customers can submit own product reviews" on public.product_reviews;
drop policy if exists "Admins can manage product reviews" on public.product_reviews;
drop policy if exists "Anyone can record page visits" on public.website_visits;
drop policy if exists "Admins can view page visits" on public.website_visits;
drop policy if exists "Customers can manage own cart" on public.customer_carts;
drop policy if exists "Admins can view customer carts" on public.customer_carts;
drop policy if exists "Customers can upload own review images" on storage.objects;
drop policy if exists "Customers can delete own review images" on storage.objects;
drop policy if exists "Admins can delete review images" on storage.objects;

create policy "Anyone can view approved product reviews" on public.product_reviews
  for select to anon, authenticated using (status = 'approved' or customer_id = (select auth.uid()) or public.is_admin());
create policy "Customers can submit own product reviews" on public.product_reviews
  for insert to authenticated with check (
    customer_id = (select auth.uid()) and status = 'pending' and admin_reply is null and replied_at is null
  );
create policy "Admins can manage product reviews" on public.product_reviews
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Anyone can record page visits" on public.website_visits
  for insert to anon, authenticated with check (length(path) between 1 and 200 and left(path, 1) = '/');
create policy "Admins can view page visits" on public.website_visits
  for select to authenticated using (public.is_admin());
create policy "Customers can manage own cart" on public.customer_carts
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Admins can view customer carts" on public.customer_carts
  for select to authenticated using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-review-images', 'product-review-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can upload own review images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-review-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Customers can delete own review images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-review-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Admins can delete review images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-review-images' and public.is_admin());

create or replace function public.list_public_product_reviews()
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  customer_name text,
  rating integer,
  review_text text,
  image_urls text[],
  admin_reply text,
  created_at timestamptz,
  like_count bigint,
  dislike_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.product_id, p.name,
    coalesce(nullif(trim(cp.first_name), ''), 'HOODKIID customer'),
    r.rating, r.review_text, r.image_urls, r.admin_reply, r.created_at,
    count(v.user_id) filter (where v.vote = 'like'),
    count(v.user_id) filter (where v.vote = 'dislike')
  from public.product_reviews r
  join public.products p on p.id = r.product_id
  left join public.customer_profiles cp on cp.user_id = r.customer_id
  left join public.product_review_votes v on v.review_id = r.id
  where r.status = 'approved'
  group by r.id, p.name, cp.first_name, cp.last_name
  order by r.created_at desc
  limit 100;
$$;

create or replace function public.vote_product_review(p_review_id uuid, p_vote text)
returns table (like_count bigint, dislike_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_vote text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to react to a review';
  end if;
  if p_vote not in ('like', 'dislike') then
    raise exception 'Choose like or dislike';
  end if;
  perform 1 from public.product_reviews
    where id = p_review_id and status = 'approved' for update;
  if not found then
    raise exception 'Review not found';
  end if;
  select vote into current_vote from public.product_review_votes
    where review_id = p_review_id and user_id = auth.uid();
  if current_vote = p_vote then
    delete from public.product_review_votes
      where review_id = p_review_id and user_id = auth.uid();
  else
    insert into public.product_review_votes (review_id, user_id, vote)
      values (p_review_id, auth.uid(), p_vote)
      on conflict (review_id, user_id) do update set vote = excluded.vote, created_at = now();
  end if;
  return query
    select count(*) filter (where vote = 'like'), count(*) filter (where vote = 'dislike')
    from public.product_review_votes where review_id = p_review_id;
end;
$$;

create or replace function public.admin_list_open_carts()
returns table (user_id uuid, email text, first_name text, last_name text, items jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  return query
    select c.user_id, u.email::text, cp.first_name, cp.last_name, c.items, c.updated_at
    from public.customer_carts c
    left join auth.users u on u.id = c.user_id
    left join public.customer_profiles cp on cp.user_id = c.user_id
    order by c.updated_at desc
    limit 100;
end;
$$;

revoke all on function public.list_public_product_reviews() from public;
grant execute on function public.list_public_product_reviews() to anon, authenticated;
revoke all on function public.vote_product_review(uuid, text) from public, anon;
grant execute on function public.vote_product_review(uuid, text) to authenticated;
revoke all on function public.admin_list_open_carts() from public;
grant execute on function public.admin_list_open_carts() to authenticated;

grant select, insert, update on public.product_reviews to authenticated;
grant select on public.product_reviews to anon;
grant insert on public.website_visits to anon, authenticated;
grant select on public.website_visits to authenticated;
grant select, insert, update, delete on public.customer_carts to authenticated;
