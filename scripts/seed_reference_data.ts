// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

// Load .env.local
config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Service Role Key in environment.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

function parseCsv(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  // Remove header
  const header = lines.shift()
  return lines.map(line => {
    // Handling simple CSV Code,Description
    const parts = line.split(',')
    const code = parts[0].trim()
    const description = parts.slice(1).join(',').trim()
    return { code, description }
  })
}

async function seed() {
  console.log('Seeding Reference Data from CSVs...')
  
  // 1. Supermarkets
  const supermarketsCsv = path.join(process.cwd(), 'docs', 'saudi_supermarket_names.csv')
  const supermarkets = parseCsv(supermarketsCsv)
  
  console.log(`Parsed ${supermarkets.length} supermarkets.`)
  for (const sm of supermarkets) {
    const slug = sm.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
    const { data: existing } = await supabase.from('supermarkets').select('id').eq('slug', slug).single()
    if (!existing) {
      const { error } = await supabase.from('supermarkets').insert({
        name_en: sm.description,
        name_ar: sm.description, // Fallback
        slug: slug,
        is_active: true
      })
      if (error) console.error(`Error inserting supermarket ${sm.code}:`, error.message)
    }
  }

  // 2. Locations (Cities & Regions)
  const locationsCsv = path.join(process.cwd(), 'docs', 'saudi_supermarket_offer_locations.csv')
  const locations = parseCsv(locationsCsv)
  
  const regions = locations.filter(loc => loc.description.toLowerCase().includes('region'))
  const cities = locations.filter(loc => !loc.description.toLowerCase().includes('region'))

  console.log(`Parsed ${regions.length} regions and ${cities.length} cities.`)

  for (const r of regions) {
    const slug = r.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
    const { data: existing } = await supabase.from('regions').select('id').eq('slug', slug).single()
    if (!existing) {
      const { error } = await supabase.from('regions').insert({
        name_en: r.description,
        name_ar: r.description,
        slug: slug,
        is_active: true
      })
      if (error) console.error(`Error inserting region ${r.code}:`, error.message)
    }
  }

  for (const c of cities) {
    const slug = c.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
    const { data: existing } = await supabase.from('cities').select('id').eq('slug', slug).single()
    if (!existing) {
      const { error } = await supabase.from('cities').insert({
        name_en: c.description,
        name_ar: c.description,
        slug: slug,
        country_code: 'SA',
        is_active: true
      })
      if (error) console.error(`Error inserting city ${c.code}:`, error.message)
    }
  }

  console.log('Seed complete!')
}

seed().catch(console.error)
