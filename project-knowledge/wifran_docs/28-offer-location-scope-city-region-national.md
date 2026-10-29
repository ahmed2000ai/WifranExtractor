# Antigravity Chunk 28 — Offer Location Scope: City, Region, and National Coverage

## Objective

Update Wifran so supermarket offers can correctly vary by city, region, or national coverage.

Do not create duplicate supermarket entities per city/region.

Keep supermarkets as brand-level entities, and handle offer coverage at the database/query/import/UI level.

---

## Problem

Saudi supermarket offers can differ by city or region.

Examples:

- Panda Riyadh offers may differ from Panda Jeddah offers.
- Othaim Riyadh Region offers may differ from Othaim Qassim offers.
- Some Carrefour offers may be national.
- Some leaflets may cover only one city.
- Some leaflets may cover a region.

Wifran must support this cleanly.

---

## Required Data Model

Keep one `supermarkets` row per supermarket brand.

Do not create:

```text
Panda Riyadh
Panda Jeddah
Othaim Riyadh
````

Instead, offers should have location coverage.

Add or verify fields on `offers`:

```text
location_scope
city_id
region_id
```

`location_scope` allowed values:

```text
national
region
city
```

Rules:

```text
national:
  city_id = null
  region_id = null

region:
  region_id required
  city_id = null

city:
  city_id required
  region_id optional or derived from city
```

If `location_scope` already exists, verify it works.

If not, create a safe migration.

---

## Public Offer Matching Rules

When user selected location is a city:

Show offers where:

```text
location_scope = national
OR region_id = selected city's region_id
OR city_id = selected city_id
```

When user selected location is a region:

Show offers where:

```text
location_scope = national
OR region_id = selected region_id
```

If no user location is selected:

Use default Riyadh beta behavior, or show national + Riyadh city/region offers depending on current app logic.

Do not show offers from unrelated cities/regions.

---

## Admin Import Form Update

Update the AI JSON import form and any manual/bulk import forms to use trusted coverage fields.

Admin should select:

```text
Supermarket
Coverage type: National / Region / City
City or Region depending on coverage type
Expiry date
```

Behavior:

* If National: no city/region required.
* If Region: region required.
* If City: city required.
* Expiry date required.
* Imported offers use this trusted context.
* JSON context does not override admin-selected context.

---

## Manual Offer Form Update

Update manual offer create/edit forms so admins can set:

```text
location_scope
city_id
region_id
```

Use the same rules:

* National → no location selection
* Region → region required
* City → city required

---

## Query Updates

Update all public offer queries:

```text
homepage offers
search results
category pages
supermarket pages
offer detail if needed
saved/list/watch matching if needed
```

Public active offer rule remains:

```text
status = published
AND (offer_start_date <= today OR offer_start_date is null)
AND offer_end_date >= today
```

Add location matching on top of that.

Do not weaken active/published rules.

---

## UI Updates

Display offer location scope clearly but subtly.

Examples:

```text
Panda · Riyadh
Panda · Riyadh Region
Panda · Saudi Arabia
```

Arabic examples:

```text
بنده · الرياض
بنده · منطقة الرياض
بنده · السعودية
```

Offer detail should show:

```text
Coverage: Riyadh
```

Arabic:

```text
نطاق العرض: الرياض
```

Keep branch note:

```text
Prices and availability may vary by branch.
```

Arabic:

```text
قد تختلف الأسعار والتوفر حسب الفرع.
```

---

## Location Selector

If the app currently has only a fixed Riyadh badge, keep Riyadh as default for now.

But prepare the query layer so location can later be changed.

If there is already a location selector, make it support:

```text
city
region
```

Do not build full geolocation/near-me in this chunk.

---

## Seed Data

Update seed/demo data so it includes:

```text
some national offers
some Riyadh city offers
some Jeddah city offers
some Riyadh Region offers
some Eastern Region offers
```

This is needed to test filtering.

Do not create duplicate supermarkets.

---

## Validation

Add validation for offers:

* `location_scope` is required.
* National offers cannot have city_id or region_id.
* Region offers require region_id.
* City offers require city_id.
* City offer region_id should match city region if region_id is stored.

Apply validation in:

```text
manual offer form
CSV import
AI JSON import
review queue
server actions
```

---

## Testing

Run:

```bash
npm run lint
npm run build
```

Manual QA:

1. Create/publish Panda Riyadh city offer.
2. Create/publish Panda Jeddah city offer.
3. Create/publish Panda Riyadh Region offer.
4. Create/publish Panda national offer.
5. With selected location Riyadh:

   * Riyadh city offer appears.
   * Riyadh Region offer appears.
   * National offer appears.
   * Jeddah offer does not appear.
6. With selected location Jeddah if location selector exists:

   * Jeddah city offer appears.
   * Makkah Region offer appears if seeded.
   * National offer appears.
   * Riyadh city offer does not appear.
7. Supermarket page should show only offers relevant to selected location.
8. Search should show only offers relevant to selected location.
9. Category pages should show only offers relevant to selected location.
10. AI JSON import should apply selected coverage type.
11. Manual offer form should require correct coverage fields.
12. No duplicate supermarket entities are created.

---

## Acceptance Criteria

This chunk is complete when:

* Supermarkets remain brand-level entities.
* Offers support national/region/city coverage.
* Public queries filter offers by selected user location.
* Admin import forms support coverage type.
* Manual offer form supports coverage type.
* AI JSON import uses trusted coverage context.
* Offer cards/details show coverage context.
* Demo data includes different city/region/national offers.
* Public active-offer rule remains unchanged.
* Admin protection remains intact.
* `npm run lint` passes.
* `npm run build` passes.