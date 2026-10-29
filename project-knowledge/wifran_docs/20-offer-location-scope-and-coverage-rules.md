# Wifran Offer Location Scope and Coverage Rules

## Purpose

Wifran must support the reality that Saudi supermarket offers can differ by city, region, or nationwide campaign.

Examples:

* Panda Riyadh offers may differ from Panda Jeddah offers.
* Othaim Riyadh Region offers may differ from Othaim Qassim offers.
* Some Carrefour offers may apply nationally.
* Some weekly leaflets may apply only to one city.
* Some weekly leaflets may apply to a whole region.

Wifran must handle this through offer-level coverage, not by duplicating supermarket brands.

---

## Core Rule

Do **not** create separate supermarket entities for each city or region.

Do not create rows like:

```text
Panda Riyadh
Panda Jeddah
Othaim Riyadh
Othaim Qassim
```

Instead, keep supermarkets as brand-level entities:

```text
Panda
Othaim
Danube
BinDawood
LuLu
Tamimi
Carrefour
```

Then attach location coverage to each offer.

---

## Correct Data Model

Supermarkets remain brand-level:

```text
supermarkets
- id
- name_ar
- name_en
- slug
- logo_url
- website_url
- is_active
```

Locations are modeled separately:

```text
regions
- id
- name_ar
- name_en
- slug

cities
- id
- region_id
- name_ar
- name_en
- slug
```

Offers carry coverage:

```text
offers
- supermarket_id
- location_scope
- city_id
- region_id
```

Allowed `location_scope` values:

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

---

## Public Offer Matching

When the selected user location is a city:

Show offers where:

```text
location_scope = national
OR city_id = selected_city_id
OR region_id = selected_city.region_id
```

When the selected user location is a region:

Show offers where:

```text
location_scope = national
OR region_id = selected_region_id
```

If no user location is selected:

Use the existing Riyadh-first default behavior until full location selection is implemented.

Do not show offers from unrelated cities or regions.

---

## Public Active Offer Rule

The existing active-offer rule must remain unchanged:

```text
status = published
AND (offer_start_date <= today OR offer_start_date is null)
AND offer_end_date >= today
```

Location matching is added on top of this rule.

Never weaken the published/active filtering rule.

---

## Admin Import Context

Admin imports must use trusted admin-selected coverage context.

For AI JSON import, CSV import, and manual offer entry, admins should select:

```text
Supermarket
Coverage type: National / Region / City
Region or City depending on coverage type
Expiry date
```

Rules:

```text
National:
  no city/region required

Region:
  region required

City:
  city required
```

The admin-selected context overrides any supermarket/location/expiry data inside uploaded JSON or CSV files.

AI-extracted JSON is untrusted input. It should never override admin-selected trusted context.

---

## User-Facing Display

Offer cards and offer detail should display coverage subtly.

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

Also keep the trust note:

```text
Prices and availability may vary by branch.
```

Arabic:

```text
قد تختلف الأسعار والتوفر حسب الفرع.
```

---

## Branch-Level Offers

Branch-level offers are out of scope for MVP.

Do not implement branch-level availability yet.

Branch-level support may be added later with:

```text
branches
branch addresses
geolocation
branch-specific offer coverage
near-me filtering
```

For now, Wifran supports:

```text
national
region
city
```

---

## Testing Expectations

The implementation should support these tests:

1. Panda Riyadh city offer appears for Riyadh users.
2. Panda Jeddah city offer does not appear for Riyadh users.
3. Panda Riyadh Region offer appears for Riyadh users.
4. National Panda offer appears for all users.
5. Search respects selected location.
6. Category pages respect selected location.
7. Supermarket pages respect selected location.
8. Admin import applies selected coverage type.
9. Manual offer creation applies selected coverage type.
10. No duplicate supermarket entities are created.

---

## Summary

Wifran should model:

```text
One supermarket brand
Many offers
Each offer has city/region/national coverage
```

Not:

```text
Duplicate supermarket rows per city or region
```

This keeps branding, logos, analytics, search, and admin workflows clean and scalable.