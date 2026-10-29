import { loadExtractionManifest } from '../extraction/extractionManifestService'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import { loadEnvConfig } from '../config/env'
import { mapOfferSourcePayload, mapImportBatchPayload, buildImportRowsPayloads } from './importTrackingMappers'
import type { PersistImportTrackingInput, PersistImportTrackingResult } from '../../shared/types/importTracking'

export async function persistImportTracking(
  input: PersistImportTrackingInput
): Promise<PersistImportTrackingResult> {
  const config = loadEnvConfig()

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    return {
      ok: false,
      error: {
        code: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase URL or Service Role Key is missing.'
      }
    }
  }

  let supabase;
  try {
    supabase = getSupabaseAdminClient()
  } catch (err: any) {
    return {
      ok: false,
      error: {
        code: 'SUPABASE_CLIENT_ERROR',
        message: err.message || 'Failed to initialize Supabase client.'
      }
    }
  }

  try {
    if (input.dryRun) {
      return {
        ok: true,
        sourceId: 'dry-run-source',
        importBatchId: 'dry-run-batch',
        insertedImportRowCount: 0,
        insertedValidationErrorCount: 0,
        batchStatus: 'failed'
      }
    }

    // Manual publish gate: ensure Pre-Publish Preview approval before modifying DB
    if (input.metadata.workspacePath) {
      const manifest = await loadExtractionManifest(input.metadata.workspacePath)
      if (manifest && manifest.pre_publish_preview?.status !== 'approved') {
        return {
          ok: false,
          error: {
            code: 'PUBLISH_APPROVAL_REQUIRED',
            message: 'Database write blocked: Pre-Publish Preview approval is required.'
          }
        }
      }
    }

    // 1. Insert offer_sources
    const sourcePayload = mapOfferSourcePayload(input)
    const { data: sourceData, error: sourceError } = await supabase
      .from('offer_sources')
      .insert(sourcePayload)
      .select('id')
      .single()

    if (sourceError || !sourceData) {
      console.error('Failed to insert offer source:', sourceError)
      return {
        ok: false,
        error: {
          code: 'OFFER_SOURCE_INSERT_FAILED',
          message: sourceError?.message || 'Unknown error creating offer source.'
        }
      }
    }
    const sourceId = sourceData.id

    // 2. Insert import_batches
    const batchPayload = mapImportBatchPayload(input, sourceId)
    const { data: batchData, error: batchError } = await supabase
      .from('import_batches')
      .insert(batchPayload)
      .select('id, status')
      .single()

    if (batchError || !batchData) {
      console.error('Failed to insert import batch:', batchError)
      return {
        ok: false,
        sourceId,
        error: {
          code: 'IMPORT_BATCH_INSERT_FAILED',
          message: batchError?.message || 'Unknown error creating import batch.'
        }
      }
    }
    const batchId = batchData.id
    const batchStatus = batchData.status as any

    // 3. Prepare rows and errors
    const rawRows = buildImportRowsPayloads(input, batchId)
    
    if (rawRows.length === 0) {
      // Nothing to insert
      return {
        ok: true,
        sourceId,
        importBatchId: batchId,
        insertedImportRowCount: 0,
        insertedValidationErrorCount: 0,
        batchStatus
      }
    }

    // Insert rows in chunks of 100
    const CHUNK_SIZE = 100
    let insertedRowCount = 0
    let insertedErrorCount = 0
    const validationErrorsToInsert: any[] = []

    for (let i = 0; i < rawRows.length; i += CHUNK_SIZE) {
      const chunk = rawRows.slice(i, i + CHUNK_SIZE)
      
      // Strip temp fields before DB insert
      const dbRows = chunk.map(r => {
        const { _temp_row_id, _temp_errors, ...dbRow } = r
        return dbRow
      })

      const { data: insertedRows, error: rowsError } = await supabase
        .from('import_rows')
        .insert(dbRows)
        .select('id, row_number')

      if (rowsError || !insertedRows) {
        console.error('Failed to insert import rows chunk:', rowsError)
        // Try to update batch to failed
        await supabase.from('import_batches').update({ status: 'failed' }).eq('id', batchId)
        
        return {
          ok: false,
          sourceId,
          importBatchId: batchId,
          insertedImportRowCount: insertedRowCount,
          insertedValidationErrorCount: insertedErrorCount,
          batchStatus: 'failed',
          error: {
            code: 'IMPORT_ROWS_INSERT_FAILED',
            message: rowsError?.message || 'Unknown error inserting import rows.'
          }
        }
      }

      insertedRowCount += insertedRows.length

      // Map back the generated import_row_id to the validation errors
      // We use row_number to match them back, since row_number is preserved
      chunk.forEach(origRow => {
        const insertedDbRow = insertedRows.find(ir => ir.row_number === origRow.row_number)
        if (insertedDbRow && origRow._temp_errors.length > 0) {
          origRow._temp_errors.forEach((err: any) => {
            err.import_row_id = insertedDbRow.id
            validationErrorsToInsert.push(err)
          })
        }
      })
    }

    // 4. Insert validation_errors in chunks
    for (let i = 0; i < validationErrorsToInsert.length; i += CHUNK_SIZE) {
      const errorChunk = validationErrorsToInsert.slice(i, i + CHUNK_SIZE)
      
      const { error: valError } = await supabase
        .from('validation_errors')
        .insert(errorChunk)

      if (valError) {
        console.error('Failed to insert validation errors chunk:', valError)
        // Try to update batch to failed
        await supabase.from('import_batches').update({ status: 'failed' }).eq('id', batchId)

        return {
          ok: false,
          sourceId,
          importBatchId: batchId,
          insertedImportRowCount: insertedRowCount,
          insertedValidationErrorCount: insertedErrorCount,
          batchStatus: 'failed',
          error: {
            code: 'VALIDATION_ERRORS_INSERT_FAILED',
            message: valError.message || 'Unknown error inserting validation errors.'
          }
        }
      }
      
      insertedErrorCount += errorChunk.length
    }

    return {
      ok: true,
      sourceId,
      importBatchId: batchId,
      insertedImportRowCount: insertedRowCount,
      insertedValidationErrorCount: insertedErrorCount,
      batchStatus
    }

  } catch (error: any) {
    console.error('Unexpected error in persistImportTracking:', error)
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED_DB_ERROR',
        message: error.message || 'An unexpected error occurred during database persistence.'
      }
    }
  }
}
