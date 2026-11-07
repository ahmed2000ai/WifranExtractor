import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function checkConsumerOffers() {
  const supabase = getSupabaseAdminClient()

  const { data: offers, error } = await supabase
    .from('v_consumer_offers')
    .select('id, title_en, title_ar, display_image_url, display_image_kind, card_image_subject_scope')
    .order('title_en', { ascending: true })

  if (error) {
    console.error('Error querying v_consumer_offers:', error.message)
    return
  }

  console.log(`v_consumer_offers total rows: ${offers?.length || 0}`)
  let exactCount = 0
  let illustrativeCount = 0
  let nullCount = 0

  for (const o of offers || []) {
    if (o.display_image_kind === 'exact_product') exactCount++
    else if (o.display_image_kind === 'illustrative') illustrativeCount++
    else nullCount++
  }

  console.log(`- Exact Product visuals: ${exactCount}`)
  console.log(`- Illustrative visuals:  ${illustrativeCount}`)
  console.log(`- No image (null):       ${nullCount}`)
}

checkConsumerOffers()

