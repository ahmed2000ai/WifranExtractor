import { readFileSync } from 'fs'
import { join } from 'path'

const d = JSON.parse(readFileSync(join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json'), 'utf8'))
for (const r of d.records) {
  if (r.isIdentitySufficient && (r.brandKey === 'unknown_brand' || r.brandKey === 'softy' || r.brandStatus !== 'known')) {
    console.log(r.canonicalSourceId, '| brandKey=', r.brandKey, '| brandStatus=', r.brandStatus, '| brandRaw=', r.brandRaw, '| size=', r.eachSizeValue, r.eachSizeUnit, 'x', r.manufacturerPackCount, '| title=', r.titleEn)
  }
}
console.log('Also check Nadec / Dari / Al Batal / Tiffany / Fakieh 600g sufficiency:')
for (const id of ['Alwafa_Test_p001_003', 'Lulu_Test_p001_004', 'Alwafa_Test_p001_007', 'Lulu_Test_p002_004', 'Lulu_Test_p002_011']) {
  const r = d.records.find((x: any) => x.canonicalSourceId === id)
  console.log(id, '| suf=', r.isIdentitySufficient, '| codes=', r.sufficiencyCodes, '| sem=', r.quantitySemantics, '| pack=', r.manufacturerPackCount, '| promo=', r.promoConditionQuantity)
}

