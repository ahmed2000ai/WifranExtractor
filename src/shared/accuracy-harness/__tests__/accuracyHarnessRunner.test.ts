/**
 * Accuracy Harness Runner Tests – Chunk 57
 *
 * Tests the offline harness against all golden fixtures.
 * No Mistral. No Supabase. No network.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { runAccuracyHarnessFixture } from '../runAccuracyHarnessFixture';
import type { AccuracyHarnessFixture } from '../../types/accuracyHarness';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const fixturesRoot = path.resolve(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'accuracy-harness');

function loadFixture(name: string): AccuracyHarnessFixture {
  const fixturePath = path.join(fixturesRoot, name, 'fixture.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
}

function loadAllFixtures(): AccuracyHarnessFixture[] {
  if (!fs.existsSync(fixturesRoot)) return [];
  const dirs = fs.readdirSync(fixturesRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  return dirs.map(d => {
    const fp = path.join(fixturesRoot, d.name, 'fixture.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as AccuracyHarnessFixture;
  }).filter(Boolean) as AccuracyHarnessFixture[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Accuracy Harness Runner', () => {
  it('loads fixtures from disk', () => {
    const fixtures = loadAllFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  // --- 9.1 Othaim oil 1.5L ---
  it('oil 1.5L valid fixture passes', () => {
    const fixture = loadFixture('othaim-oil-1-5l');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toEqual([]);
    expect((result.actual.comparison as any).comparison_eligible).toBe(true);
    expect((result.actual.comparison as any).comparison_unit).toBe('liter');
    expect((result.actual.decision as any).publish_decision).toBe('publish');
  });

  // --- 9.2 Bad oil size-as-price ---
  it('bad oil size-as-price fixture fails publishing', () => {
    const fixture = loadFixture('bad-oil-size-as-price');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('offer_price_matches_size_value');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
    expect((result.actual.decision as any).should_upsert_db).toBe(false);
  });

  // --- 9.3 Fairy 730ml 1+1 ---
  it('Fairy 730ml 1+1 fixture passes', () => {
    const fixture = loadFixture('fairy-730ml-1-plus-1');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(true);
    expect((result.actual.comparison as any).comparison_unit).toBe('liter');
    // 10 / (0.73 * 2) = 6.85
    const unitPrice = (result.actual.comparison as any).comparison_unit_price;
    expect(Math.abs(unitPrice - 6.85)).toBeLessThan(0.05);
    expect((result.actual.decision as any).publish_decision).toBe('publish');
  });

  // --- 9.4 Bad Fairy old-price-as-current ---
  it('bad Fairy old-price-as-current fixture fails publishing', () => {
    const fixture = loadFixture('bad-fairy-old-price-as-current');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('original_price_misclassified_as_offer_price');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  // --- 9.5 8×135g ---
  it('8x135g fixture calculates total content', () => {
    const fixture = loadFixture('pack-8x135g');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(true);
    expect((result.actual.comparison as any).comparison_unit).toBe('kilogram');
    // 12 / (0.135 * 8) = 12 / 1.08 = 11.11
    const unitPrice = (result.actual.comparison as any).comparison_unit_price;
    expect(Math.abs(unitPrice - 11.11)).toBeLessThan(0.05);
  });

  // --- 9.6 Watermelon per 2kg ---
  it('watermelon per_2kg fixture calculates unit price', () => {
    const fixture = loadFixture('watermelon-per-2kg');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(true);
    expect((result.actual.comparison as any).comparison_unit).toBe('kilogram');
    // 10 / 2 = 5
    const unitPrice = (result.actual.comparison as any).comparison_unit_price;
    expect(Math.abs(unitPrice - 5.0)).toBeLessThan(0.05);
  });

  // --- 9.7 30 pieces ---
  it('30 pieces fixture parses quantity correctly', () => {
    const fixture = loadFixture('30-pieces');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(true);
    expect((result.actual.comparison as any).comparison_unit).toBe('piece');
    // 15 / 30 = 0.5
    const unitPrice = (result.actual.comparison as any).comparison_unit_price;
    expect(Math.abs(unitPrice - 0.5)).toBeLessThan(0.05);
  });

  // --- 9.8 TV/electronics ---
  it('TV/electronics fixture is comparison excluded', () => {
    const fixture = loadFixture('tv-electronics');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(false);
    expect((result.actual.decision as any).publish_decision).toBe('publish_but_exclude_from_comparison');
    expect((result.actual.utilization as any).included_in_search).toBe(true);
    expect((result.actual.utilization as any).included_in_best_unit_price_ranking).toBe(false);
  });

  // --- 9.9 Unclear pack size ---
  it('valid but unclear pack size becomes publish_but_exclude_from_comparison', () => {
    const fixture = loadFixture('unclear-pack-size');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect((result.actual.comparison as any).comparison_eligible).toBe(false);
    expect((result.actual.decision as any).publish_decision).toBe('publish_but_exclude_from_comparison');
  });

  // --- 9.10 Missing title ---
  it('missing title becomes skip_or_quarantine', () => {
    const fixture = loadFixture('missing-title');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('missing_product_title');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  // --- 9.11 Missing offer price ---
  it('missing offer price becomes skip_or_quarantine', () => {
    const fixture = loadFixture('missing-offer-price');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('missing_offer_price');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  // --- 9.12 Invalid location scopes ---
  it('invalid city scope becomes skip_or_quarantine', () => {
    const fixture = loadFixture('invalid-location-city-scope-no-city');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('missing_city_for_city_scope');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  it('invalid region scope becomes skip_or_quarantine', () => {
    const fixture = loadFixture('invalid-location-region-scope-no-region');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('missing_region_for_region_scope');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  it('national scope with city_id becomes skip_or_quarantine', () => {
    const fixture = loadFixture('invalid-location-national-with-city');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actual.blocking_error_codes).toContain('invalid_location_scope');
    expect((result.actual.decision as any).publish_decision).toBe('skip_or_quarantine');
  });

  // --- Utilization: national visibility ---
  it('national offer appears for all cities', () => {
    const fixture = loadFixture('national-scope-offer');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    const util = result.actual.utilization as any;
    expect(util.appears_for_city_ids).toContain('city-riyadh');
    expect(util.appears_for_city_ids).toContain('city-jeddah');
    expect(util.appears_for_city_ids).toContain('city-dammam');
    expect(util.appears_for_city_ids.length).toBeGreaterThanOrEqual(5);
  });

  // --- Utilization: city visibility ---
  it('city offer appears only for matching city', () => {
    const fixture = loadFixture('city-scope-riyadh-offer');
    const result = runAccuracyHarnessFixture(fixture);
    expect(result.passed).toBe(true);
    const util = result.actual.utilization as any;
    expect(util.appears_for_city_ids).toEqual(['city-riyadh']);
    expect(util.hidden_for_city_ids).toContain('city-jeddah');
    expect(util.hidden_for_city_ids).toContain('city-dammam');
  });

  // --- Utilization: publish_but_exclude ---
  it('publish_but_exclude offer appears in search but not ranking', () => {
    const fixture = loadFixture('tv-electronics');
    const result = runAccuracyHarnessFixture(fixture);
    const util = result.actual.utilization as any;
    expect(util.included_in_search).toBe(true);
    expect(util.included_in_best_unit_price_ranking).toBe(false);
    expect(util.excluded_from_comparison).toBe(true);
  });

  // --- Utilization: skip_or_quarantine ---
  it('skip_or_quarantine does not appear in search or ranking', () => {
    const fixture = loadFixture('missing-title');
    const result = runAccuracyHarnessFixture(fixture);
    const util = result.actual.utilization as any;
    expect(util.included_in_search).toBe(false);
    expect(util.included_in_best_unit_price_ranking).toBe(false);
    expect(util.excluded_from_comparison).toBe(true);
  });

  // --- All fixtures pass (regression) ---
  it('all loaded fixtures pass', () => {
    const fixtures = loadAllFixtures();
    for (const fixture of fixtures) {
      const result = runAccuracyHarnessFixture(fixture);
      if (!result.passed) {
        console.log(`FAILED: ${fixture.id}`, result.failures);
      }
      expect(result.passed).toBe(true);
    }
  });
});
