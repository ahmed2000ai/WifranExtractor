import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { EvidenceOverlayFile } from '../src/main/db/matchingEvidenceOverlayService'
import type { MatchingEvidenceAnnotation } from '../src/shared/types/catalogMatching'

const FACTUAL_OVERLAY_NOTES: Record<string, string> = {
  Lulu_Test_p001_003:
    'Crop audit (page-001/offer-003) confirms both Blue and Green Persil 2.25Kg boxes offered under a single offer card; extractor omitted variant assortment.',
  Lulu_Test_p002_004:
    'Crop audit (page-002/offer-004) confirms 3 flavor cartons of Al Batal Popcorn 12x23g priced @ 10.50 EACH; extractor omitted flavor assortment.',
  Alwafa_Test_p001_007:
    'Crop audit (page-001/offer-007) shows conflicting weight text on the same card: Arabic reads 700g while English reads 600Gm, alongside a BUY 2 PCS badge.',
  Alwafa_Test_p003_014:
    'Crop audit (page-003/offer-014) confirms ASSORTED (منوع) 4-color Perinna Bed Sheet 225x250cm variants under one offer card; extractor omitted assortment.',
  'noori-supermarket-229798534-jeddah_p001_006':
    'Crop audit (page-001/offer-006) prices Pride Creamy Labneh loose per Kg deli weight (بالكيلو), whereas extraction normalized it as a 1Kg packaged tub.',
  'noori-supermarket-229798534-jeddah_p001_008':
    'Crop audit (page-001/offer-008) shows caption text (Wafir Blue 2.5kg) conflicting with pictured packaging (Purple 2kg x 2 bags).'
}

function main(): void {
  const v2Path = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v2.json')
  const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))
  const nowIso = '2026-11-13T10:45:00.000Z'

  const overlayAnnotations: Record<string, MatchingEvidenceAnnotation> = {}

  const items004 = (v2.items as any[]).map((item) => {
    const cloned = JSON.parse(JSON.stringify(item))
    const rawCanonical = JSON.parse(readFileSync(join(process.cwd(), cloned.sourceFilePath), 'utf8'))

    // §3.1 Reconcile Softy Tissues packaging discrepancy against original canonical JSON & crop
    if (cloned.canonicalSourceId === 'noori-supermarket-229798534-jeddah_p001_009') {
      const canonicalPackQty = Number(rawCanonical?.content?.pack_quantity ?? 10)
      const promoCondQty =
        typeof rawCanonical?.promotion?.condition_quantity === 'number'
          ? rawCanonical.promotion.condition_quantity
          : null
      cloned.manufacturerPackCount = canonicalPackQty // 10 (from content.pack_quantity)
      cloned.promoConditionQuantity = promoCondQty // null (7+3 Free is in-pack bonus, standard_price)
      cloned.physicalTruth.softyReconciliationNote =
        'Reconciled in 004 preflight: canonical content.pack_quantity=10 and offer_card_crop.webp (ربطة / 10 / 7+3 FREE 10x130) prove sealed 10-box manufacturer bundle rather than 1-box x 10 retail promo.'
    }

    if (cloned.requiresEvidenceOverlayForTruth && cloned.overlayCorrection) {
      const factualNote = FACTUAL_OVERLAY_NOTES[cloned.canonicalSourceId] || cloned.overlayCorrection.notes
      overlayAnnotations[cloned.canonicalSourceId] = {
        source_id: cloned.canonicalSourceId,
        evidence_source: 'operator_verified_card',
        assortment_status: cloned.overlayCorrection.assortment_status,
        identity_resolution: cloned.overlayCorrection.identity_resolution,
        notes: factualNote,
        reviewer_id: 'owner_benchmark_review_004',
        created_at: nowIso,
        updated_at: nowIso,
        reversible: true
      }
      // Remove embedded overlay from frozen benchmark source item so runtime reads ONLY verified_evidence_annotations_004.json
      delete cloned.overlayCorrection
    }

    return cloned
  })

  const uniquePhysicalCount = items004.filter((x) => !x.physicalTruth.isGenuineRepeat).length
  const existingOccurrences = items004.filter((x) => x.trueSafeDecision === 'existing').length
  const existingUnique = items004.filter((x) => !x.physicalTruth.isGenuineRepeat && x.trueSafeDecision === 'existing').length

  const dataset004 = {
    schemaVersion: '2.1',
    milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-004',
    generatedAt: nowIso,
    predecessorDataset: 'test-fixtures/matching-benchmarks/real_world_100_dataset_v2.json',
    provenanceNote:
      '106 real extracted offers (105 unique canonical physical identities; 1 verified cross-retailer repeat Tanmiah 1100g). Softy 10x130 reconciled from canonical content.pack_quantity=10; 1 provisional no-crop item (othaim-week24_006_004) flagged for exclusion from definitive exact-ID scoring. Ground truth frozen offline independently of matching outputs.',
    counts: {
      totalExtractedOffers: items004.length,
      uniquePhysicalIdentities: uniquePhysicalCount,
      genuineRepeatedIdentities: items004.length - uniquePhysicalCount,
      cropVerifiedCount: items004.filter((x) => x.physicalTruth.verificationMethod === 'crop_and_canonical_verified').length,
      provisionalNoCropCount: items004.filter((x) => x.physicalTruth.verificationMethod !== 'crop_and_canonical_verified').length,
      trueSafeDecisionBreakdown: {
        existingOccurrences,
        existingUnique,
        temporary: items004.filter((x) => x.trueSafeDecision === 'temporary').length,
        unresolved: items004.filter((x) => x.trueSafeDecision === 'unresolved').length
      },
      overlayAnnotationsCount: Object.keys(overlayAnnotations).length
    },
    items: items004
  }

  const overlayFile: EvidenceOverlayFile = {
    version: '1.0',
    scope: 'benchmark:004_evidence_assisted',
    updatedAt: nowIso,
    annotations: overlayAnnotations
  }

  const outDatasetPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_004.json')
  const outOverlayPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'verified_evidence_annotations_004.json')
  writeFileSync(outDatasetPath, JSON.stringify(dataset004, null, 2), 'utf8')
  writeFileSync(outOverlayPath, JSON.stringify(overlayFile, null, 2), 'utf8')

  console.log('[004 Dataset] Wrote', outDatasetPath)
  console.log('[004 Counts]', JSON.stringify(dataset004.counts, null, 2))
  console.log('[004 Overlay] Wrote', outOverlayPath, 'entries=', Object.keys(overlayAnnotations).length)
}

main()

