import { readFileSync } from 'fs'
import { join } from 'path'

const d = JSON.parse(readFileSync(join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json'), 'utf8'))

const byCropAndTitle = new Map<string, any[]>()
for (const r of d.records) {
  const key = `${r.retailer}|${r.cropPath || r.canonicalSourceId}|${(r.titleEn || r.titleAr || '').toLowerCase().trim()}`
  if (!byCropAndTitle.has(key)) byCropAndTitle.set(key, [])
  byCropAndTitle.get(key)!.push(r)
}

console.log('Total 190 records -> distinct (retailer + crop + title):', byCropAndTitle.size)

// Print breakdown by brandStatus & assortment & sufficiency
const cats = {
  sufficient_non_assortment: [] as any[],
  packaging_ambiguous_known_brand: [] as any[],
  assortment_known_or_multi_brand: [] as any[],
  missing_size_known_brand: [] as any[],
  unbranded_commodity: [] as any[],
  unknown_brand: [] as any[]
}

for (const r of d.records) {
  if (r.isIdentitySufficient) cats.sufficient_non_assortment.push(r)
  else if (r.sufficiencyCodes.includes('PACKAGING_SEMANTICS_AMBIGUOUS') && !r.isAssortmentEvaluated)
    cats.packaging_ambiguous_known_brand.push(r)
  else if (r.isAssortmentEvaluated) cats.assortment_known_or_multi_brand.push(r)
  else if (r.brandStatus === 'unbranded') cats.unbranded_commodity.push(r)
  else if (r.brandStatus === 'unknown') cats.unknown_brand.push(r)
  else cats.missing_size_known_brand.push(r)
}

for (const [k, list] of Object.entries(cats)) {
  console.log(`${k}: ${list.length}`)
}
