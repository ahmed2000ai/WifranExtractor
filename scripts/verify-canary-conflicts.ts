import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function checkConflicts() {
  const sb = getSupabaseAdminClient()
  console.log('=== VERIFYING NO CONFLICTS WITH PRODUCTION DATABASE ===\n')

  // 1. Check supermarket
  const { data: sm } = await sb.from('supermarkets').select('*').ilike('slug', '%noori%')
  console.log('Existing Noori supermarkets in DB:', sm)

  // 2. Check source_offer_id prefix
  const { data: offersWithPrefix } = await sb.from('offers').select('id, source_offer_id').ilike('source_offer_id', 'noori%')
  console.log('Existing offers with "noori%" prefix:', offersWithPrefix)

  // 3. Check date range
  const { data: offersInDateRange } = await sb.from('offers').select('id, supermarket_id, offer_start_date, offer_end_date').eq('offer_start_date', '2026-11-02')
  console.log('Existing offers starting on 2026-11-02:', offersInDateRange)

  // 4. Check display image URLs for noori
  const { data: displayImgs } = await sb.from('offer_display_images').select('id, visual_subject_key').ilike('visual_subject_key', '%noori%')
  console.log('Existing display images mentioning "noori":', displayImgs)

  const isConflictFree = (sm?.length || 0) === 0 && (offersWithPrefix?.length || 0) === 0 && (offersInDateRange?.length || 0) === 0
  console.log(`\nConflict Check Verdict: ${isConflictFree ? '100% CONFLICT-FREE' : 'CONFLICT DETECTED'}`)
}

checkConflicts().catch(console.error)

