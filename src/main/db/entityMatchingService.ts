import { getSupabaseAdminClient } from './supabaseAdminClient'
import { matchOrCreateBrand } from './brandMatchingService'
import { matchOrCreateCategory } from './categoryMatchingService'
import { matchOrCreateProduct } from './productMatchingService'
import { ensureProductAliases } from './productAliasService'
import type { 
  EntityMatchingInput, 
  EntityMatchingResult,
  EntityMatchIssue,
  MatchedEntityIds
} from '../../shared/types/entityMatching'

export async function matchEntitiesForRows(
  input: EntityMatchingInput
): Promise<EntityMatchingResult> {
  const result: EntityMatchingResult = {
    ok: true,
    totalRows: input.rows.length,
    matchedRows: 0,
    warningRows: 0,
    errorRows: 0,
    skippedRows: 0,
    brandsCreated: 0,
    productsCreated: 0,
    aliasesCreated: 0,
    categoriesCreated: 0,
    results: []
  }

  const supabase = getSupabaseAdminClient()

  for (const row of input.rows) {
    if (row.status === 'skipped' || row.skipReason === 'NON_PRODUCT_PROMOTIONAL_AREA') {
      result.skippedRows++
      result.results.push({
        rowId: row.rowId,
        importRowId: row.importRowId,
        rowNumber: row.rowNumber,
        status: 'skipped',
        matched: { brandId: null, categoryId: null, productId: null },
        created: { brandCreated: false, productCreated: false, aliasCreated: false, categoryCreated: false },
        updatedNormalizedData: row.normalizedData,
        issues: [{ severity: 'info', code: 'ENTITY_MATCHING_SKIPPED_ROW', message: 'Row skipped, no matching required.' }]
      })
      continue
    }

    const { normalizedData } = row
    const originalOffer = normalizedData.offer || normalizedData.original || {}
    const issues: EntityMatchIssue[] = []
    
    let matchedBrandId: string | null = null
    let brandCreated = false
    
    let matchedCategoryId: string | null = null
    let categoryCreated = false
    
    let matchedProductId: string | number | null = null
    let productCreated = false
    let aliasesCreated = false

    const contractV2 = normalizedData.contract_v2 || normalizedData.canonical?.contract_v2 || originalOffer.contract_v2 || null

    // 1. Match Brand
    const brandNameAr = originalOffer.brand_ar || null
    const brandNameEn = originalOffer.brand_en || null
    
    if (brandNameAr || brandNameEn) {
      const brandRes = await matchOrCreateBrand({
        brandNameAr,
        brandNameEn,
        autoCreate: input.options.autoCreateBrands,
        brandState: originalOffer.brand_state || contractV2?.product_facts?.brand_assertion?.state,
        candidateUnverified: originalOffer.brand_candidate_text || contractV2?.product_facts?.brand_assertion?.candidate_unverified,
        contractV2
      })
      matchedBrandId = brandRes.brandId
      brandCreated = brandRes.created
      issues.push(...brandRes.issues)
      if (brandCreated) result.brandsCreated++
    }

    // 2. Match Category
    const categoryNameAr = originalOffer.category_ar || null
    const categoryNameEn = originalOffer.category_en || null
    
    if (categoryNameAr || categoryNameEn) {
      const catRes = await matchOrCreateCategory({
        categoryNameAr,
        categoryNameEn,
        autoCreate: input.options.autoCreateCategories
      })
      matchedCategoryId = catRes.categoryId
      categoryCreated = catRes.created
      issues.push(...catRes.issues)
      if (categoryCreated) result.categoriesCreated++
    }

    // 3. Match Product
    const productNameAr = originalOffer.title_ar || originalOffer.product_name_ar || null
    const productNameEn = originalOffer.title_en || originalOffer.product_name_en || null
    const descriptionAr = originalOffer.description_ar || null
    const descriptionEn = originalOffer.description_en || null
    const packSizeValue = originalOffer.pack_size_value ? Number(originalOffer.pack_size_value) : null
    const packSizeUnit = originalOffer.pack_size_unit || null

    const prodRes = await matchOrCreateProduct({
      productNameAr,
      productNameEn,
      descriptionAr,
      descriptionEn,
      brandId: matchedBrandId,
      categoryId: matchedCategoryId,
      packSizeValue,
      packSizeUnit,
      autoCreate: input.options.autoCreateProducts,
      contractV2,
      assortmentStatus: originalOffer.assortment_status || contractV2?.assortment?.status,
      exactIdentityStatus: originalOffer.exact_identity_status || contractV2?.product_facts?.exact_identity_status
    })
    
    matchedProductId = prodRes.productId
    productCreated = prodRes.created
    issues.push(...prodRes.issues)
    if (productCreated) result.productsCreated++

    // 4. Aliases
    if (matchedProductId) {
      const aliasesToEnsure: Array<{
        aliasText: string
        language: 'ar' | 'en' | 'mixed' | 'unknown'
        source: string
      }> = []
      if (productNameAr) aliasesToEnsure.push({ aliasText: productNameAr, language: 'ar' as const, source: 'wifran_offers_extractor' })
      if (productNameEn) aliasesToEnsure.push({ aliasText: productNameEn, language: 'en' as const, source: 'wifran_offers_extractor' })

      const aliasRes = await ensureProductAliases({
        productId: matchedProductId,
        aliases: aliasesToEnsure
      })
      
      issues.push(...aliasRes.issues)
      if (aliasRes.createdCount > 0) {
        aliasesCreated = true
        result.aliasesCreated += aliasRes.createdCount
      }
    }

    // 5. Build matched ids and update row
    const matched: MatchedEntityIds = {
      brandId: matchedBrandId,
      categoryId: matchedCategoryId,
      productId: matchedProductId
    }

    // Safely update matched object in normalized data
    const updatedNormalizedData = { ...normalizedData }
    updatedNormalizedData.matched = {
      ...(updatedNormalizedData.matched || {}),
      product_id: matchedProductId,
      brand_id: matchedBrandId,
      category_id: matchedCategoryId,
      duplicate_offer_id: null
    }

    // Calculate row status
    const hasError = issues.some(i => i.severity === 'error')
    const hasWarning = issues.some(i => i.severity === 'warning')
    
    let newStatus = row.status
    let rowStatusResult: 'matched' | 'warning' | 'error' | 'skipped' = 'matched'

    if (hasError) {
      newStatus = 'error'
      rowStatusResult = 'error'
      result.errorRows++
    } else if (hasWarning || row.status === 'warning') {
      newStatus = 'warning'
      rowStatusResult = 'warning'
      result.warningRows++
    } else {
      result.matchedRows++
    }

    // Update import_rows and validation_errors safely
    if (row.importRowId) {
      const { error: rowUpdateError } = await supabase
        .from('import_rows')
        .update({
          normalized_data: updatedNormalizedData,
          status: newStatus
        })
        .eq('id', row.importRowId)

      if (rowUpdateError) {
        console.error(`Failed to update import row ${row.importRowId}:`, rowUpdateError)
        issues.push({ severity: 'error', code: 'IMPORT_ROW_UPDATE_FAILED', message: rowUpdateError.message })
      }

      if (input.importBatchId && issues.length > 0) {
        const errorInserts = issues.filter(i => i.severity !== 'info').map(issue => ({
          import_batch_id: input.importBatchId,
          import_row_id: row.importRowId,
          offer_id: null,
          severity: issue.severity,
          field_name: issue.fieldName || null,
          error_code: issue.code,
          message: issue.message
        }))

        if (errorInserts.length > 0) {
          const { error: valError } = await supabase.from('validation_errors').insert(errorInserts)
          if (valError) {
            console.error(`Failed to insert validation errors for row ${row.importRowId}:`, valError)
          }
        }
      }
    }

    result.results.push({
      rowId: row.rowId,
      importRowId: row.importRowId,
      rowNumber: row.rowNumber,
      status: rowStatusResult,
      matched,
      created: {
        brandCreated,
        categoryCreated,
        productCreated,
        aliasCreated: aliasesCreated
      },
      updatedNormalizedData,
      issues
    })
  }

  return result
}
