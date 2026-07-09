-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8A.2 — update_product must not wipe fields the edit form never sends
--
-- update_product did a FULL overwrite from validate_product_payload, so any
-- column the admin edit form doesn't carry got NULLed on every save:
--   - description_ar/he/en — the form has NO description inputs at all, so
--     any description (set via import/SQL/future UI) silently vanished on
--     the first edit.
--   - barcode — the form HAS a barcode input but never prefilled it in edit
--     mode. Fixed app-side in M8A (domain type + prefill), so an explicit
--     empty value remains a deliberate CLEAR.
--
-- Fix (descriptions): overwrite a description ONLY when its key is PRESENT
-- in the p_product payload (jsonb `?`), otherwise keep the current row's
-- value. The app write layer now omits absent description keys, so a
-- future description UI can still clear a value by sending an explicit
-- null/empty. Everything else (auth gate, validation, unique-SKU handling,
-- inventory upsert) is unchanged.
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.update_product(
  p_tenant_id uuid,
  p_product_id uuid,
  p_product jsonb,
  p_inventory jsonb default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v record;
begin
  p_tenant_id := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id
  ) then
    raise exception 'update_product: product is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  select * into v from public.validate_product_payload(p_tenant_id, p_product);
  begin
    update public.products p set
      manufacturer_id = v.manufacturer_id, category_id = v.category_id,
      sku = v.sku, barcode = v.barcode,
      name_ar = v.name_ar, name_he = v.name_he, name_en = v.name_en,
      -- Preserve descriptions the payload doesn't carry (M8A): the admin
      -- form has no description inputs, and a full overwrite silently
      -- destroyed values set elsewhere.
      description_ar = case when p_product ? 'description_ar' then v.description_ar else p.description_ar end,
      description_he = case when p_product ? 'description_he' then v.description_he else p.description_he end,
      description_en = case when p_product ? 'description_en' then v.description_en else p.description_en end,
      package_unit = v.package_unit, package_quantity = v.package_quantity,
      base_unit = v.base_unit, unit_size = v.unit_size,
      wholesale_price = v.wholesale_price, vat_rate = v.vat_rate,
      image_url = v.image_url, track_expiry = v.track_expiry, is_active = v.is_active
    where p.id = p_product_id and p.tenant_id = p_tenant_id;
  exception when unique_violation then
    raise exception 'update_product: a product with this SKU already exists in this tenant'
      using errcode = '22023';
  end;
  if p_inventory is not null then
    perform public.upsert_inventory_item(p_tenant_id, p_product_id, p_inventory);
  end if;
  return p_product_id;
end;
$$;
