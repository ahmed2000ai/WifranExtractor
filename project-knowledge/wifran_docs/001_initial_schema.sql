-- =========================================================================
-- Wifran Initial Database Schema
-- Migration: 001_initial_schema.sql
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. Required Extensions & Setup
-- -------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Supabase manages the auth schema and auth.users table internally.
-- We do NOT create or modify it here.

-- Reusable function to update updated_at timestamps
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- -------------------------------------------------------------------------
-- 1. Phase 1: Core Catalog Tables
-- -------------------------------------------------------------------------

-- cities
create table if not exists public.cities (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  slug text unique not null,
  country_code text not null default 'SA',
  is_active boolean not null default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- regions
create table if not exists public.regions (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  slug text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- supermarkets
create table if not exists public.supermarkets (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  slug text unique not null,
  logo_url text,
  website_url text,
  is_active boolean not null default true,
  sort_order integer default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- supermarket_regions (mapping supermarkets to cities and regions)
create table if not exists public.supermarket_regions (
  id uuid primary key default gen_random_uuid(),
  supermarket_id text not null references public.supermarkets(id) on delete cascade,
  city_id text references public.cities(id) on delete cascade,
  region_id text references public.regions(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_city_or_region check (city_id is not null or region_id is not null)
);

-- Enforce uniqueness of supermarket-city-region mapping (coalesce handles null values)
create unique index unique_supermarket_city_region 
  on public.supermarket_regions (
    supermarket_id, 
    coalesce(city_id, 'NONE'::text), 
    coalesce(region_id, 'NONE'::text)
  );

-- categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete set null,
  name_ar text not null,
  name_en text not null,
  slug text unique not null,
  description_ar text,
  description_en text,
  icon_name text,
  is_active boolean not null default true,
  sort_order integer default 0,
  requires_unit_price boolean not null default false,
  default_unit_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- brands
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name_ar text,
  name_en text,
  slug text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_brand_name check (name_ar is not null or name_en is not null)
);

-- units
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_ar text not null,
  name_en text not null,
  symbol_ar text,
  symbol_en text,
  base_unit_code text,
  conversion_to_base numeric,
  is_active boolean not null default true,
  sort_order integer default 0
);

-- products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  name_ar text,
  name_en text,
  slug text unique,
  description_ar text,
  description_en text,
  default_image_url text,
  default_pack_size_value numeric,
  default_pack_size_unit text,
  default_unit_type text,
  is_normalized boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_product_name check (name_ar is not null or name_en is not null)
);

-- product_aliases (for handling variant text naming in leaflets/receipts)
create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias_text text not null,
  language text,
  source text,
  created_at timestamptz not null default now()
);


-- -------------------------------------------------------------------------
-- 2. Phase 3: Profiles (User Tables - placed before Phase 2 dependencies)
-- -------------------------------------------------------------------------

-- profiles (extends Supabase Auth User record)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user' constraint chk_user_role check (role in ('user', 'admin', 'super_admin')),
  preferred_language text not null default 'ar' constraint chk_preferred_language check (preferred_language in ('ar', 'en')),
  preferred_city_id text references public.cities(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SQL Helper function to evaluate user permission role
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin')
      and is_active = true
  );
$$;


-- -------------------------------------------------------------------------
-- 3. Phase 2: Offer Tables
-- -------------------------------------------------------------------------

-- offer_sources
create table if not exists public.offer_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null, -- 'leaflet_pdf', 'leaflet_image', 'web_scraping', 'store_visit'
  supermarket_id text references public.supermarkets(id) on delete set null,
  city_id text references public.cities(id) on delete set null,
  region_id text references public.regions(id) on delete set null,
  title text,
  source_url text,
  file_url text,
  leaflet_id text,
  storage_prefix text,
  image_count integer,
  valid_from date,
  valid_to date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- offers (Master savings table)
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  
  -- Relational taxonomy
  product_id uuid references public.products(id) on delete set null,
  supermarket_id text not null references public.supermarkets(id) on delete cascade,
  city_id text references public.cities(id) on delete set null,
  region_id text references public.regions(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,

  -- Bilingual Titles
  title_ar text,
  title_en text,

  -- Pricing info
  offer_price numeric(10,2) not null,
  original_price numeric(10,2),
  discount_amount numeric(10,2),
  discount_percentage numeric(5,2),

  -- Sizing & Comparison
  pack_size_value numeric,
  pack_size_unit text,
  pack_quantity numeric default 1,
  unit_price numeric(12,4),
  unit_price_unit text,

  -- Validity & Workflow
  offer_start_date date,
  offer_end_date date not null,
  status text not null default 'draft',

  -- Meta details
  image_url text,
  image_path text,
  image_bucket text default 'offer-images',
  image_source_type text,
  source_id uuid references public.offer_sources(id) on delete set null,
  source_page_number integer,
  source_item_number text,
  source_reference text,
  external_image_id text,
  ingestion_source text,

  -- Coverage info
  location_scope text not null default 'national' constraint chk_offer_location_scope check (location_scope in ('national', 'region', 'city')),

  -- Analytics & Quality
  deal_score numeric(6,2),
  deal_label text,
  data_quality_score numeric(5,2),

  -- Loyalty info
  is_loyalty_required boolean not null default false,
  loyalty_notes_ar text,
  loyalty_notes_en text,

  -- Constraints/Limits
  quantity_limit text,
  notes_ar text,
  notes_en text,

  -- Authorship
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Core table constraints
  constraint chk_offer_price_positive check (offer_price > 0),
  constraint chk_original_price_ge check (original_price is null or original_price >= offer_price),
  constraint chk_offer_dates check (offer_start_date is null or offer_end_date >= offer_start_date),
  constraint chk_offer_title check (title_ar is not null or title_en is not null),
  constraint chk_offer_location_scope_rules check (
    (location_scope = 'national' and city_id is null and region_id is null) or
    (location_scope = 'region' and region_id is not null and city_id is null) or
    (location_scope = 'city' and city_id is not null)
  ),
  constraint chk_offer_status check (status in ('draft', 'needs_review', 'approved', 'published', 'expired', 'rejected'))
);

-- offer_status_history
create table if not exists public.offer_status_history (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);


-- -------------------------------------------------------------------------
-- 4. User Interaction Tables (Phase 3 continuation)
-- -------------------------------------------------------------------------

-- saved_offers
create table if not exists public.saved_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint unique_user_saved_offer unique(user_id, offer_id)
);

-- watched_items
create table if not exists public.watched_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  watch_text text,
  preferred_pack_size_value numeric,
  preferred_pack_size_unit text,
  target_price numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_watched_item_target check (product_id is not null or category_id is not null or brand_id is not null or watch_text is not null)
);

-- shopping_lists
create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null default 'My Shopping List',
  city_id text references public.cities(id) on delete set null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial index to enforce only one default list per user
create unique index idx_shopping_lists_user_default 
  on public.shopping_lists (user_id) 
  where (is_default = true);

-- shopping_list_items
create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  custom_name text,
  quantity numeric not null default 1,
  is_checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_list_item_target check (offer_id is not null or product_id is not null or custom_name is not null)
);

-- Partial index preventing duplicate offers in the same list
create unique index idx_shopping_list_items_unique_offer 
  on public.shopping_list_items (shopping_list_id, offer_id) 
  where (offer_id is not null);


-- -------------------------------------------------------------------------
-- 5. Phase 4: Trust & Admin Tables
-- -------------------------------------------------------------------------

-- issue_reports
create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  issue_type text not null,
  status text not null default 'open',
  comment text,
  reporter_email text,
  admin_notes text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_issue_type check (issue_type in ('wrong_price', 'expired_offer', 'wrong_product', 'wrong_image', 'wrong_supermarket', 'wrong_pack_size', 'duplicate_offer', 'offer_unavailable', 'other')),
  constraint chk_issue_status check (status in ('open', 'in_review', 'resolved', 'dismissed', 'needs_follow_up'))
);

-- import_batches
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  supermarket_id text references public.supermarkets(id) on delete set null,
  location_scope text constraint chk_import_batch_location_scope check (location_scope in ('national', 'region', 'city')),
  city_id text references public.cities(id) on delete set null,
  region_id text references public.regions(id) on delete set null,
  source_id uuid references public.offer_sources(id) on delete set null,
  file_name text,
  file_url text,
  file_type text,
  status text not null default 'uploaded',
  total_rows integer default 0,
  valid_rows integer default 0,
  warning_rows integer default 0,
  error_rows integer default 0,
  imported_rows integer default 0,
  skipped_rows integer default 0,
  offer_start_date date,
  offer_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint chk_import_batch_status check (status in ('uploaded', 'parsed', 'validated', 'imported', 'partially_imported', 'failed', 'cancelled'))
);

-- import_rows
create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb,
  status text not null default 'valid',
  created_offer_id uuid references public.offers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_import_row_status check (status in ('valid', 'warning', 'error', 'imported', 'skipped'))
);

-- validation_errors
create table if not exists public.validation_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  import_row_id uuid references public.import_rows(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  severity text not null constraint chk_error_severity check (severity in ('error', 'warning', 'info')),
  field_name text,
  error_code text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- audit_logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);


-- -------------------------------------------------------------------------
-- 6. Phase 5: Optional app_events & public views
-- -------------------------------------------------------------------------

-- app_events
create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  anonymous_id text,
  event_name text not null,
  properties jsonb,
  page_url text,
  locale text,
  city_id text references public.cities(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Public Active Offers view
create or replace view public.public_active_offers as
select *
from public.offers
where status = 'published'
  and (offer_start_date is null or offer_start_date <= current_date)
  and offer_end_date >= current_date;


-- -------------------------------------------------------------------------
-- 7. Triggers for updated_at tracking
-- -------------------------------------------------------------------------
create trigger update_cities_updated_at before update on public.cities for each row execute procedure update_updated_at_column();
create trigger update_regions_updated_at before update on public.regions for each row execute procedure update_updated_at_column();
create trigger update_supermarkets_updated_at before update on public.supermarkets for each row execute procedure update_updated_at_column();
create trigger update_categories_updated_at before update on public.categories for each row execute procedure update_updated_at_column();
create trigger update_brands_updated_at before update on public.brands for each row execute procedure update_updated_at_column();
create trigger update_products_updated_at before update on public.products for each row execute procedure update_updated_at_column();
create trigger update_profiles_updated_at before update on public.profiles for each row execute procedure update_updated_at_column();
create trigger update_offers_updated_at before update on public.offers for each row execute procedure update_updated_at_column();
create trigger update_watched_items_updated_at before update on public.watched_items for each row execute procedure update_updated_at_column();
create trigger update_shopping_lists_updated_at before update on public.shopping_lists for each row execute procedure update_updated_at_column();
create trigger update_shopping_list_items_updated_at before update on public.shopping_list_items for each row execute procedure update_updated_at_column();
create trigger update_issue_reports_updated_at before update on public.issue_reports for each row execute procedure update_updated_at_column();
create trigger update_import_batches_updated_at before update on public.import_batches for each row execute procedure update_updated_at_column();
create trigger update_import_rows_updated_at before update on public.import_rows for each row execute procedure update_updated_at_column();


-- -------------------------------------------------------------------------
-- 8. Table Indexes
-- -------------------------------------------------------------------------
create index if not exists idx_offers_status on public.offers(status);
create index if not exists idx_offers_supermarket_id on public.offers(supermarket_id);
create index if not exists idx_offers_location_scope on public.offers(location_scope);
create index if not exists idx_offers_city_id on public.offers(city_id);
create index if not exists idx_offers_region_id on public.offers(region_id);
create index if not exists idx_offers_category_id on public.offers(category_id);
create index if not exists idx_offers_brand_id on public.offers(brand_id);
create index if not exists idx_offers_product_id on public.offers(product_id);
create index if not exists idx_offers_offer_start_date on public.offers(offer_start_date);
create index if not exists idx_offers_offer_end_date on public.offers(offer_end_date);
create index if not exists idx_offers_unit_price on public.offers(unit_price);
create index if not exists idx_offers_deal_score on public.offers(deal_score);
create index if not exists idx_offers_created_at on public.offers(created_at);

create index if not exists idx_saved_offers_user_id on public.saved_offers(user_id);
create index if not exists idx_watched_items_user_id on public.watched_items(user_id);
create index if not exists idx_shopping_lists_user_id on public.shopping_lists(user_id);
create index if not exists idx_shopping_list_items_list_id on public.shopping_list_items(shopping_list_id);

create index if not exists idx_issue_reports_status on public.issue_reports(status);
create index if not exists idx_issue_reports_offer_id on public.issue_reports(offer_id);

create index if not exists idx_import_batches_status on public.import_batches(status);
create index if not exists idx_import_rows_batch_id on public.import_rows(import_batch_id);
create index if not exists idx_validation_errors_batch_id on public.validation_errors(import_batch_id);

-- Trigram Indexes for search optimisation
create index if not exists idx_offers_title_ar_trgm on public.offers using gin (title_ar gin_trgm_ops);
create index if not exists idx_offers_title_en_trgm on public.offers using gin (title_en gin_trgm_ops);
create index if not exists idx_products_name_ar_trgm on public.products using gin (name_ar gin_trgm_ops);
create index if not exists idx_products_name_en_trgm on public.products using gin (name_en gin_trgm_ops);
create index if not exists idx_product_aliases_alias_trgm on public.product_aliases using gin (alias_text gin_trgm_ops);
create index if not exists idx_brands_name_ar_trgm on public.brands using gin (name_ar gin_trgm_ops);
create index if not exists idx_brands_name_en_trgm on public.brands using gin (name_en gin_trgm_ops);


-- -------------------------------------------------------------------------
-- 9. Row Level Security Policies
-- -------------------------------------------------------------------------

-- Enable RLS on user/admin sensitive tables
alter table public.profiles enable row level security;
alter table public.saved_offers enable row level security;
alter table public.watched_items enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.issue_reports enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.validation_errors enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_events enable row level security;

-- Enable RLS on catalog & offer tables for security consistency
alter table public.cities enable row level security;
alter table public.regions enable row level security;
alter table public.supermarkets enable row level security;
alter table public.supermarket_regions enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.units enable row level security;
alter table public.products enable row level security;
alter table public.product_aliases enable row level security;
alter table public.offer_sources enable row level security;
alter table public.offers enable row level security;
alter table public.offer_status_history enable row level security;

-- Policies for catalog tables (read is public, write is admin-only)
create policy "Allow public read access to cities" on public.cities for select using (true);
create policy "Allow admins to manage cities" on public.cities for all using (public.is_admin());

create policy "Allow public read access to regions" on public.regions for select using (true);
create policy "Allow admins to manage regions" on public.regions for all using (public.is_admin());

create policy "Allow public read access to supermarkets" on public.supermarkets for select using (true);
create policy "Allow admins to manage supermarkets" on public.supermarkets for all using (public.is_admin());

create policy "Allow public read access to supermarket_regions" on public.supermarket_regions for select using (true);
create policy "Allow admins to manage supermarket_regions" on public.supermarket_regions for all using (public.is_admin());

create policy "Allow public read access to categories" on public.categories for select using (true);
create policy "Allow admins to manage categories" on public.categories for all using (public.is_admin());

create policy "Allow public read access to brands" on public.brands for select using (true);
create policy "Allow admins to manage brands" on public.brands for all using (public.is_admin());

create policy "Allow public read access to units" on public.units for select using (true);
create policy "Allow admins to manage units" on public.units for all using (public.is_admin());

create policy "Allow public read access to products" on public.products for select using (true);
create policy "Allow admins to manage products" on public.products for all using (public.is_admin());

create policy "Allow public read access to product_aliases" on public.product_aliases for select using (true);
create policy "Allow admins to manage product_aliases" on public.product_aliases for all using (public.is_admin());

create policy "Allow public read access to offer_sources" on public.offer_sources for select using (true);
create policy "Allow admins to manage offer_sources" on public.offer_sources for all using (public.is_admin());

-- Policies for Profiles (users read/write own, admin reads all)
create policy "Allow users to view own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "Allow users to edit own profile" on public.profiles for update using (id = auth.uid());
create policy "Allow admins to insert/delete profiles" on public.profiles for all using (public.is_admin());

-- Policies for Offers (public reads only active published offers, admin reads/writes all)
create policy "Allow public select active published offers" on public.offers for select using (
  status = 'published'
  and (offer_start_date is null or offer_start_date <= current_date)
  and offer_end_date >= current_date
);
create policy "Allow admins manage offers" on public.offers for all using (public.is_admin());

create policy "Allow public read offer history" on public.offer_status_history for select using (true);
create policy "Allow admins to manage offer history" on public.offer_status_history for all using (public.is_admin());

-- Policies for Saved Offers (user manages own, admin views all)
create policy "Allow users to manage own saved offers" on public.saved_offers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Allow admins select saved offers" on public.saved_offers
  for select using (public.is_admin());

-- Policies for Watched Items (user manages own, admin views all)
create policy "Allow users to manage own watched items" on public.watched_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Allow admins select watched items" on public.watched_items
  for select using (public.is_admin());

-- Policies for Shopping Lists (user manages own, admin views all)
create policy "Allow users to manage own shopping lists" on public.shopping_lists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Allow admins select shopping lists" on public.shopping_lists
  for select using (public.is_admin());

-- Policies for Shopping List Items (user manages own, admin views all)
create policy "Allow users to manage own shopping list items" on public.shopping_list_items
  for all using (exists (
    select 1 from public.shopping_lists 
    where public.shopping_lists.id = shopping_list_id 
      and public.shopping_lists.user_id = auth.uid()
  ));

-- Policies for Issue Reports (anyone can insert report, user views own, admin manages all)
create policy "Allow public insertion of issue reports" on public.issue_reports for insert with check (true);
create policy "Allow users to view own issue reports" on public.issue_reports for select using (user_id = auth.uid());
create policy "Allow admins full access to issue reports" on public.issue_reports for all using (public.is_admin());

-- Policies for Import Batches, Import Rows, Validation Errors, Audit Logs (Admin-only)
create policy "Allow admins access to import batches" on public.import_batches for all using (public.is_admin());
create policy "Allow admins access to import rows" on public.import_rows for all using (public.is_admin());
create policy "Allow admins access to validation errors" on public.validation_errors for all using (public.is_admin());
create policy "Allow admins access to audit logs" on public.audit_logs for all using (public.is_admin());

-- Policies for App Events (anyone can insert, admin select)
create policy "Allow public insert app events" on public.app_events for insert with check (true);
create policy "Allow admins select app events" on public.app_events for select using (public.is_admin());

-- -------------------------------------------------------------------------
-- 10. Role Permissions (Grants)
-- -------------------------------------------------------------------------
-- Grant access to anon and authenticated roles so they can interact with the schema.
-- (Row Level Security will enforce actual access policies)

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Ensure future tables also inherit these permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
