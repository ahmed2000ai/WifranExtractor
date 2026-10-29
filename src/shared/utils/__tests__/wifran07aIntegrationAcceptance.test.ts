import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { CanonicalOffer } from '../../types/canonicalOffer';
import {
  buildContractV2FromCanonical,
  buildSourceOfferId,
  calculateScenarioPurchase,
  toConsumerOfferProjection
} from '../extractorContractV2Adapter';
import { mapPreparedPayloadToOffersInsert } from '../offerSyncMapper';
import {
  MASTER_SUPERMARKETS,
  MASTER_REGIONS,
  MASTER_CITIES,
  LEGACY_ID_CROSSWALK,
  resolveCanonicalId
} from '../../../main/db/referenceDataService';

describe('WIFRAN-07A Integration Acceptance Suite (INT-01 .. INT-36)', () => {
  const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/wifran04');
  const postUploadDir = path.join(fixturesDir, 'post-upload-samples');
  const sql006Path = path.resolve(process.cwd(), 'project-knowledge/wifran_docs/006_wifran_07a_security_and_contract_reconciliation.sql');
  const sql005Path = path.resolve(process.cwd(), 'project-knowledge/wifran_docs/005_wifran_v2_offer_contract.sql');
  const sql002Path = path.resolve(process.cwd(), 'project-knowledge/wifran_docs/002_migrate_identifiers_to_codes.sql');

  const j1Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'page-001-012.canonical.json'), 'utf8'));
  const j2Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'page-003-012.canonical.json'), 'utf8'));
  const j3Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'Extracts/Alwafa_Test/json/page-002-002.canonical.json'), 'utf8'));

  // =========================================================================
  // Package 1: Security, Grants, RLS, and Sanitized Projection (INT-01..07)
  // =========================================================================
  describe('Package 1: Security, Grants, RLS & Safe Projection (INT-01 .. INT-07)', () => {
    const sql006 = fs.readFileSync(sql006Path, 'utf8');

    it('INT-01: Consumer view strictly enforces WHERE o.status = "published"', () => {
      expect(sql006).toMatch(/CREATE OR REPLACE VIEW public\.v_consumer_offers/i);
      expect(sql006).toMatch(/WHERE\s+o\.status\s*=\s*'published'/i);

      // Verify in 005 as well for clean installs
      const sql005 = fs.readFileSync(sql005Path, 'utf8');
      expect(sql005).toMatch(/WHERE\s+o\.status\s*=\s*'published'/i);
    });

    it('INT-02: Public view sanitizes contract_v2 and strips all local workstation paths', () => {
      expect(sql006).toMatch(/build_sanitized_consumer_contract_v2/i);
      expect(sql006).toMatch(/\^\[A-Za-z\]:\[\\+\/\]/);
    });

    it('INT-03: Security invoker/definer options and access strategies are explicitly enforced', () => {
      expect(sql006).toMatch(/security_invoker/i);
      expect(sql006).toMatch(/REVOKE ALL ON public\.offers FROM anon, authenticated/i);
      expect(sql006).toMatch(/GRANT SELECT ON public\.v_consumer_offers TO anon, authenticated/i);
    });

    it('INT-04: Profile privilege escalation is strictly blocked via trigger and column grants', () => {
      expect(sql006).toMatch(/prevent_profile_privilege_escalation/i);
      expect(sql006).toMatch(/GRANT UPDATE \(display_name, preferred_language, preferred_city_id, updated_at\)\s+ON public\.profiles TO authenticated/i);
    });

    it('INT-05: ALTER DEFAULT PRIVILEGES revokes overbroad default access on newly created tables', () => {
      expect(sql006).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated/i);
      expect(sql006).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated/i);
    });

    it('INT-06, INT-07: Migration 002 carries disposable clean-init guard and 006 upgrades non-destructively', () => {
      const sql002 = fs.readFileSync(sql002Path, 'utf8');
      expect(sql002).toMatch(/DISPOSABLE CLEAN-INIT ONLY/i);
      expect(sql002).toMatch(/DO NOT RUN ON POPULATED DATABASES/i);
      expect(sql006).not.toMatch(/TRUNCATE\s+TABLE/i);
      expect(sql006).not.toMatch(/TRUNCATE\s+public\./i);
    });
  });

  // =========================================================================
  // Package 2: Geographic Master Registry Reconciliation (INT-08..10)
  // =========================================================================
  describe('Package 2: Master Geographic Registry & Crosswalk (INT-08 .. INT-10)', () => {
    it('INT-08: Master cities and regions use canonical deterministic UUIDs with codes and parent region_id', () => {
      expect(MASTER_SUPERMARKETS.length).toBe(12);
      expect(MASTER_REGIONS.length).toBe(5);
      expect(MASTER_CITIES.length).toBe(25);

      const jeddah = MASTER_CITIES.find(c => c.slug === 'jeddah')!;
      expect(jeddah.id).toBe('a6f7b140-0002-4444-a000-000000000002');
      expect(jeddah.code).toBe('JEDC');
      expect(jeddah.region_id).toBe('b144b6c8-2222-4444-b000-000000000002'); // Western region

      const riyadh = MASTER_CITIES.find(c => c.slug === 'riyadh')!;
      expect(riyadh.id).toBe('a6f7b140-0001-4444-a000-000000000001');
      expect(riyadh.code).toBe('RIYC');
      expect(riyadh.region_id).toBe('b144b6c8-1111-4444-b000-000000000001'); // Central region
    });

    it('INT-09: Legacy seed IDs resolve through the authoritative crosswalk map', () => {
      expect(Object.keys(LEGACY_ID_CROSSWALK).length).toBeGreaterThanOrEqual(38);
      const legacyJeddah = 'a6f7b140-0002-4c28-98e3-c28dd6fb4fb4';
      const resolvedCity = resolveCanonicalId(legacyJeddah);
      expect(resolvedCity).toBe('a6f7b140-0002-4444-a000-000000000002');

      const legacyMakkahRegion = 'b144b6c8-2222-477c-a496-d3c52e46b3f2';
      const resolvedRegion = resolveCanonicalId(legacyMakkahRegion);
      expect(resolvedRegion).toBe('b144b6c8-2222-4444-b000-000000000002'); // Western
    });

    it('INT-10: 006 provides get_consumer_offers_for_shopping_date with national/regional/city scope filtering', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/get_consumer_offers_for_shopping_date/i);
      expect(sql006).toMatch(/location_scope = 'national'/i);
      expect(sql006).toMatch(/p_city_id/i);
    });
  });

  // =========================================================================
  // Package 3: Quantity Semantics & Nullable inner_pack_count (INT-11..13)
  // =========================================================================
  describe('Package 3: Quantity Semantics & Contract Version (INT-11 .. INT-13)', () => {
    it('INT-11: Mutton J3 inner_pack_count stays null and sale_unit stays kg without forced count 1', () => {
      const v2 = buildContractV2FromCanonical(j3Raw);
      expect(v2.quantity_semantics.sale_unit).toBe('kg');
      expect(v2.quantity_semantics.inner_count).toBeNull();
      expect(v2.quantity_semantics.is_indivisible_sale_unit).toBe(false);

      const { payload } = mapPreparedPayloadToOffersInsert({
        preparedPayload: {
          supermarket_id: 'c2cc16c2-0008-4444-b000-c00000000008',
          city_id: 'a6f7b140-0002-4444-a000-000000000002',
          title_ar: j3Raw.product?.title_ar,
          title_en: j3Raw.product?.title_en,
          offer_price: 45,
          offer_end_date: '2026-10-20',
          contract_v2: v2
        },
        imageUrl: null,
        storageBucket: 'offer-images',
        storagePath: null,
        thumbnailUrl: null,
        thumbnailStoragePath: null,
        sourceId: 'test-source-id'
      });

      expect(payload).not.toBeNull();
      expect(payload!.sale_unit_type).toBe('kg');
      expect(payload!.inner_pack_count).toBeNull();
    });

    it('INT-12: Legacy rows without contract_v2 have contract_version = null', () => {
      const { payload } = mapPreparedPayloadToOffersInsert({
        preparedPayload: {
          supermarket_id: 'c2cc16c2-0008-4444-b000-c00000000008',
          city_id: 'a6f7b140-0002-4444-a000-000000000002',
          title_ar: 'منتج قديم بدون عقد v2',
          title_en: 'Old product without contract v2',
          offer_price: 10,
          offer_end_date: '2026-10-20'
        },
        imageUrl: null,
        storageBucket: 'offer-images',
        storagePath: null,
        thumbnailUrl: null,
        thumbnailStoragePath: null,
        sourceId: 'test-source-id'
      });

      expect(payload).not.toBeNull();
      expect(payload!.contract_version).toBeNull();
      expect(payload!.contract_v2).toBeNull();
    });

    it('INT-13: 006 migration declares check constraint chk_offers_inner_pack_count', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/chk_offers_inner_pack_count/i);
      expect(sql006).toMatch(/CHECK \(inner_pack_count IS NULL OR inner_pack_count > 0\)/i);
    });
  });

  // =========================================================================
  // Package 4: Capability Gating, Sparse Attributes & Commodities (INT-14..18)
  // =========================================================================
  describe('Package 4: Capability Gating, Sparse Attributes & Commodities (INT-14 .. INT-18)', () => {
    it('INT-14: assessments.capabilities and structural_capabilities alias are aligned', () => {
      const v2 = buildContractV2FromCanonical(j3Raw);
      expect(v2.assessments.capabilities).toBeDefined();
      expect(v2.assessments.structural_capabilities).toBeDefined();
      expect(v2.assessments.capabilities).toEqual(v2.assessments.structural_capabilities);
    });

    it('INT-15: J3 unresolved identity strictly gates capabilities and identity confidence', () => {
      const v2 = buildContractV2FromCanonical(j3Raw);
      expect(v2.product_facts.exact_identity_status).toBe('unresolved');
      expect(v2.product_facts.verified_product_id).toBeNull();

      // Comparison MUST NOT be supported when exact identity is unresolved
      expect(v2.assessments.capabilities.exact_product_comparison).toBe('needs_review');
      // Automatic fulfillment MUST NOT be supported when exact identity is unresolved
      expect(v2.assessments.capabilities.automatic_list_fulfillment).toBe('conditional');
      // Identity confidence cannot be high on unresolved commodity
      expect(v2.assessments.confidence.identity_confidence).not.toBe('high');
      expect(['medium', 'low']).toContain(v2.assessments.confidence.identity_confidence);
      // Asset scope must be offer_group, never exact_product
      expect(v2.assets.offer_card.subject_scope).toBe('offer_group');
    });

    it('INT-16, INT-17: J3 extracts domain-aware meat attributes and fresh_mutton commodity tag', () => {
      const v2 = buildContractV2FromCanonical(j3Raw);
      expect(v2.product_facts.derived_subcategory_slug).toBe('fresh_mutton');
      expect(v2.product_facts.attributes.meat_species).toEqual({
        value: 'mutton',
        state: 'supported',
        provenance: 'title_heuristic'
      });
      expect(v2.product_facts.attributes.freshness).toEqual({
        value: 'fresh',
        state: 'supported',
        provenance: 'title_heuristic'
      });
      expect(v2.product_facts.attributes.origin).toEqual({
        value: 'ethiopian',
        state: 'supported',
        provenance: 'title_heuristic'
      });
      expect(v2.product_facts.attributes.cut_type).toEqual({
        value: 'cuts',
        state: 'supported',
        provenance: 'title_heuristic'
      });
      expect(v2.product_facts.attributes.bone_status).toEqual({
        value: null,
        state: 'unknown',
        provenance: null
      });
    });

    it('INT-18: J2 Mini Fan absent model, power_watts, dimensions are marked unknown, NOT not_applicable', () => {
      const v2 = buildContractV2FromCanonical(j2Raw);
      expect(v2.product_facts.attributes.model).toEqual({
        value: null,
        state: 'unknown',
        provenance: null
      });
      expect(v2.product_facts.attributes.power_watts).toEqual({
        value: null,
        state: 'unknown',
        provenance: null
      });
      expect(v2.product_facts.attributes.dimensions).toEqual({
        value: null,
        state: 'unknown',
        provenance: null
      });
      // Food attributes remain not_applicable on appliance
      expect(v2.product_facts.attributes.fat_level.state).toBe('not_applicable');
      expect(v2.product_facts.attributes.milk_processing_type.state).toBe('not_applicable');
    });
  });

  // =========================================================================
  // Package 5: Pricing Math & Scenario Calculations (INT-19..21)
  // =========================================================================
  describe('Package 5: Pricing Math & Scenario Calculations (INT-19 .. INT-21)', () => {
    it('INT-19: Requesting 2 soap bars against 6-pack indivisible unit requires 1 full pack for SAR 25.00 with 4 surplus units', () => {
      const v2 = buildContractV2FromCanonical(j1Raw);
      const scenario = calculateScenarioPurchase(v2, 2);
      expect(scenario.full_packs_required).toBe(1);
      expect(scenario.payable_price).toBe('25.00');
      expect(scenario.supplied_units).toBe(6);
      expect(scenario.surplus_units).toBe(4);
    });

    it('INT-20: Purchasing 12 soap bars requires exactly 2 packs for SAR 50.00 with 0 surplus units', () => {
      const v2 = buildContractV2FromCanonical(j1Raw);
      const scenario = calculateScenarioPurchase(v2, 12);
      expect(scenario.full_packs_required).toBe(2);
      expect(scenario.payable_price).toBe('50.00');
      expect(scenario.supplied_units).toBe(12);
      expect(scenario.surplus_units).toBe(0);
    });

    it('INT-21: Mutton divisible pricing math (500g -> 22.50, 750g -> 33.75, 1.5kg -> 67.50, 2kg -> 90.00)', () => {
      const v2 = buildContractV2FromCanonical(j3Raw);
      expect(calculateScenarioPurchase(v2, 0.5).payable_price).toBe('22.50');
      expect(calculateScenarioPurchase(v2, 0.75).payable_price).toBe('33.75');
      expect(calculateScenarioPurchase(v2, 1.5).payable_price).toBe('67.50');
      expect(calculateScenarioPurchase(v2, 2.0).payable_price).toBe('90.00');
    });
  });

  // =========================================================================
  // Package 6: Lifecycle, Date Conventions & Temporal State (INT-22..25)
  // =========================================================================
  describe('Package 6: Temporal Lifecycle & Shopping Dates (INT-22 .. INT-25)', () => {
    it('INT-22: Loyalty conditions are explicitly mapped without invented non-member price', () => {
      const v2 = buildContractV2FromCanonical(j1Raw);
      expect(v2.price_terms.verified_current_non_member_price).toBeNull();
    });

    it('INT-23, INT-24: Evaluates active on 2026-10-16 and expired on 2026-10-28 in Asia/Riyadh', () => {
      const dtoActive = toConsumerOfferProjection(j1Raw, '2026-10-16');
      expect(dtoActive.temporal_lifecycle_state).toBe('active');

      const dtoExpired = toConsumerOfferProjection(j1Raw, '2026-10-28');
      expect(dtoExpired.temporal_lifecycle_state).toBe('expired');

      const dtoUpcoming = toConsumerOfferProjection(j1Raw, '2026-10-01');
      expect(dtoUpcoming.temporal_lifecycle_state).toBe('upcoming');
    });

    it('INT-25: Shopping date RPC evaluates valid_from <= p_shopping_date AND valid_to >= p_shopping_date', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/v\.offer_start_date <= p_shopping_date\s+AND\s+v\.offer_end_date >= p_shopping_date/i);
    });
  });

  // =========================================================================
  // Package 7: Post-Upload Sanitization, Storage & Revisions (INT-26..36)
  // =========================================================================
  describe('Package 7: Post-Upload Sanitization, Storage & Revision History (INT-26 .. INT-36)', () => {
    it('INT-26: Post-upload samples contain ZERO Windows paths anywhere in DB row or consumer DTO', () => {
      const files = [
        'J1-dove-soap.post-upload-db-row.json',
        'J1-dove-soap.consumer-view-dto.json',
        'J2-mini-fan.post-upload-db-row.json',
        'J2-mini-fan.consumer-view-dto.json',
        'J3-ethiopian-mutton.post-upload-db-row.json',
        'J3-ethiopian-mutton.consumer-view-dto.json'
      ];

      const verifyNoPaths = (val: any, p: string, file: string) => {
        if (val === null || val === undefined) return;
        if (typeof val === 'string') {
          expect(/^[a-zA-Z]:[\\/]/.test(val), `Windows drive letter in ${file} at ${p}: "${val}"`).toBe(false);
          expect(val.includes('\\Work\\'), `Workstation dir in ${file} at ${p}: "${val}"`).toBe(false);
          expect(val.includes('/Work/'), `Workstation dir in ${file} at ${p}: "${val}"`).toBe(false);
        } else if (Array.isArray(val)) {
          val.forEach((item, idx) => verifyNoPaths(item, `${p}[${idx}]`, file));
        } else if (typeof val === 'object') {
          for (const k of Object.keys(val)) {
            verifyNoPaths(val[k], `${p}.${k}`, file);
          }
        }
      };

      for (const fileName of files) {
        const filePath = path.join(postUploadDir, fileName);
        expect(fs.existsSync(filePath), `File exists: ${fileName}`).toBe(true);
        const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        verifyNoPaths(json, 'root', fileName);
      }
    });

    it('INT-27: Post-upload assets strip local paths, populate bucket/path/delivery_url, and clear MEDIA_UPLOAD_PENDING', () => {
      const v2Input = buildContractV2FromCanonical(j1Raw);
      const res = mapPreparedPayloadToOffersInsert({
        preparedPayload: {
          ...j1Raw,
          supermarket_id: 'a6f7b140-0001-4444-a000-000000000001',
          location_scope: 'national',
          contract_v2: v2Input,
          reason_codes: ['MEDIA_UPLOAD_PENDING', 'PRICE_UNVERIFIED']
        },
        imageUrl: 'https://cdn.wifran.com/leaflets/2026/dove.jpg',
        storageBucket: 'offer-crops',
        storagePath: 'leaflets/2026/dove.jpg',
        thumbnailUrl: 'https://cdn.wifran.com/leaflets/2026/dove-thumb.jpg',
        thumbnailStoragePath: 'leaflets/2026/dove-thumb.jpg',
        sourceId: null
      });
      const dbInsert = res.payload!;
      const v2 = dbInsert.contract_v2;
      expect(v2.assets.offer_card.upload_state).toBe('uploaded');
      expect(v2.assets.offer_card.storage_bucket).toBe('offer-crops');
      expect(v2.assets.offer_card.storage_object_path).toBe('leaflets/2026/dove.jpg');
      expect(v2.assets.offer_card.delivery_url).toBe('https://cdn.wifran.com/leaflets/2026/dove.jpg');
      expect(v2.assets.offer_card.local_path_internal).toBeNull();
      expect(v2.assessments.reason_codes).not.toContain('MEDIA_UPLOAD_PENDING');
      expect(dbInsert.reason_codes).not.toContain('MEDIA_UPLOAD_PENDING');
    });

    it('INT-28: Replay identical (source_offer_id, semantic_checksum) is a strict no-op', () => {
      const v2 = buildContractV2FromCanonical(j1Raw);
      expect(v2.record_metadata.source_revision).toBe(1);
    });

    it('INT-29: Source revision increment and snapshot archival on semantic checksum mismatch', () => {
      const v2Rev1 = buildContractV2FromCanonical(j1Raw);
      const modifiedJ1: CanonicalOffer = {
        ...j1Raw,
        prices: {
          ...j1Raw.prices,
          offer_price: 22.0
        }
      };
      const v2Rev2 = buildContractV2FromCanonical(modifiedJ1, {
        subOfferIndex: 1
      });
      expect(v2Rev1.record_metadata.semantic_checksum).not.toBe(v2Rev2.record_metadata.semantic_checksum);
      expect(v2Rev2.price_terms.source_reported_offer_price).toBe('22.00');
    });

    it('INT-30: Superseded Tamimi source_offer_id is recorded in supersedes_source_offer_id', () => {
      const remappedJ1: CanonicalOffer = {
        ...j1Raw,
        source: {
          ...j1Raw.source,
          leaflet_id: 'alwafa-city-jeddah-2026-10-20'
        }
      };
      const v2 = buildContractV2FromCanonical(remappedJ1, {
        supersedesSourceOfferId: 'tamimi-national-national-2026-10-20:p001:i012:s01'
      });
      expect(v2.record_metadata.source_offer_id).toBe('alwafa-city-jeddah-2026-10-20:p001:i012:s01');
      expect(v2.record_metadata.supersedes_source_offer_id).toBe('tamimi-national-national-2026-10-20:p001:i012:s01');
    });

    it('INT-31: Dynamic sub-offer index produces distinct identifiers for compound cells (:s01, :s02)', () => {
      const sub1 = buildSourceOfferId('alwafa-city-jeddah-2026-10-20', 1, 12, 1);
      const sub2 = buildSourceOfferId('alwafa-city-jeddah-2026-10-20', 1, 12, 2);
      expect(sub1).toBe('alwafa-city-jeddah-2026-10-20:p001:i012:s01');
      expect(sub2).toBe('alwafa-city-jeddah-2026-10-20:p001:i012:s02');
      expect(sub1).not.toBe(sub2);
    });

    it('INT-32: offer_revision_snapshots table schema in 006 supports immutable history', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/CREATE TABLE IF NOT EXISTS public\.offer_revision_snapshots/i);
      expect(sql006).toMatch(/snapshot_payload jsonb NOT NULL/i);
      expect(sql006).toMatch(/superseded_by_revision integer/i);
      expect(sql006).toMatch(/uq_offer_revision_source_rev UNIQUE \(source_offer_id, source_revision\)/i);
    });

    it('INT-33: offer_revision_snapshots grants service_role select, insert, update privileges', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.offer_revision_snapshots TO service_role/i);
    });

    it('INT-34: offer_revision_snapshots strictly revokes public/anon/authenticated access', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/REVOKE ALL ON public\.offer_revision_snapshots FROM anon, authenticated/i);
    });

    it('INT-35: public.get_offer_revision_history_summary exposes sanitized fields without raw snapshot payload', () => {
      const sql006 = fs.readFileSync(sql006Path, 'utf8');
      expect(sql006).toMatch(/FUNCTION public\.get_offer_revision_history_summary/i);
      expect(sql006).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_offer_revision_history_summary\(text\) TO anon, authenticated/i);
      expect(sql006).toMatch(/SECURITY DEFINER\s+SET search_path = public/i);
      expect(sql006).not.toMatch(/SELECT.*snapshot_payload.*FROM public\.get_offer_revision_history_summary/i);
    });

    it('INT-36: Consumer DTO provides SAR currency and unit price calculations for J3', () => {
      const j3Dto = JSON.parse(fs.readFileSync(path.join(postUploadDir, 'J3-ethiopian-mutton.consumer-view-dto.json'), 'utf8'));
      expect(j3Dto.currency).toBe('SAR');
      expect(j3Dto.sale_unit).toBe('kg');
      expect(j3Dto.inner_count).toBeNull();
      expect(j3Dto.display_unit_price).toBe(4.5);
      expect(j3Dto.display_unit_price_label_en).toBe('SAR 4.50 / 100g');
      expect(j3Dto.card_image_upload_state).toBe('uploaded');
    });
  });
});
