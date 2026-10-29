/**
 * Runtime Fixture Candidate Service – Chunk 58
 *
 * Creates local fixture candidates for suspicious or blocked rows.
 * The operator/developer can later promote them to golden fixtures.
 */

import fs from 'fs';
import path from 'path';
import type { CanonicalOffer } from '../../shared/types/canonicalOffer';
import type { RuntimeSuspiciousRow, RuntimeFixtureCandidate } from '../../shared/types/runtimeAccuracyHarness';

/**
 * Creates fixture candidate folders under metadata/fixture-candidates/
 * for each suspicious row.
 */
export async function createFixtureCandidates(
  workspacePath: string,
  suspiciousRows: RuntimeSuspiciousRow[],
  canonicalItems: CanonicalOffer[]
): Promise<RuntimeFixtureCandidate[]> {
  const fixtureCandidatesDir = path.join(workspacePath, 'metadata', 'fixture-candidates');
  const candidates: RuntimeFixtureCandidate[] = [];

  // Build lookup by page+item
  const itemLookup = new Map<string, CanonicalOffer>();
  for (const item of canonicalItems) {
    const key = `${item.source.source_page_number}-${item.source.source_item_number}`;
    itemLookup.set(key, item);
  }

  for (const row of suspiciousRows) {
    const pageStr = String(row.source_page_number ?? 0).padStart(3, '0');
    const itemStr = row.source_item_number || 'unknown';
    const candidateId = `page-${pageStr}-item-${itemStr}`;
    const candidateDir = path.join(fixtureCandidatesDir, candidateId);

    if (!fs.existsSync(candidateDir)) {
      fs.mkdirSync(candidateDir, { recursive: true });
    }

    // Look up the canonical item
    const lookupKey = `${row.source_page_number}-${row.source_item_number}`;
    const canonical = itemLookup.get(lookupKey);

    // Write fixture-candidate.json
    const candidateJson = {
      fixture_candidate_id: candidateId,
      created_at: new Date().toISOString(),
      reason_codes: row.reason_codes,
      messages: row.messages,
      source_page_number: row.source_page_number,
      source_item_number: row.source_item_number,
      publish_decision: row.publish_decision,
      offer_price: row.offer_price,
      original_price: row.original_price,
      size_text: row.size_text,
      comparison_eligible: row.comparison_eligible,
      note: 'This is a fixture candidate. To promote it to a golden fixture, review the data and copy it to tests/fixtures/accuracy-harness/.',
    };
    fs.writeFileSync(
      path.join(candidateDir, 'fixture-candidate.json'),
      JSON.stringify(candidateJson, null, 2)
    );

    // Write canonical.json if available
    if (canonical) {
      fs.writeFileSync(
        path.join(candidateDir, 'canonical.json'),
        JSON.stringify(canonical, null, 2)
      );

      // Write raw_mistral_response.json if available
      if (canonical.raw?.raw_ocr_json) {
        fs.writeFileSync(
          path.join(candidateDir, 'raw_mistral_response.json'),
          JSON.stringify(canonical.raw.raw_ocr_json, null, 2)
        );
      }

      // Write validation.json if available
      if (canonical.raw?.raw_validation_json) {
        fs.writeFileSync(
          path.join(candidateDir, 'validation.json'),
          JSON.stringify(canonical.raw.raw_validation_json, null, 2)
        );
      }

      // Copy crop if available
      if (canonical.source.crop_path && fs.existsSync(canonical.source.crop_path)) {
        const cropDest = path.join(candidateDir, path.basename(canonical.source.crop_path));
        try {
          fs.copyFileSync(canonical.source.crop_path, cropDest);
        } catch {
          // Non-critical: crop copy failed
        }
      }
    }

    // Write runtime_issue.json
    const issueJson = {
      reason_codes: row.reason_codes,
      messages: row.messages,
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(candidateDir, 'runtime_issue.json'),
      JSON.stringify(issueJson, null, 2)
    );

    candidates.push({
      fixture_candidate_id: candidateId,
      path: path.relative(workspacePath, candidateDir),
      reason_codes: row.reason_codes,
      source_page_number: row.source_page_number,
      source_item_number: row.source_item_number,
    });
  }

  return candidates;
}
