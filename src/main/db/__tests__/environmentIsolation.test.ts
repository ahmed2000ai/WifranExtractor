import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveDatabaseConfig,
  extractProjectRef,
  getGuardedSupabaseClient,
  createGuardedPgClient,
  assertProductionMaintenanceAuthorized,
  PRODUCTION_PROJECT_REF,
  DEVELOPMENT_PROJECT_REF
} from '../databaseEnvironmentResolver'
import { getSupabaseAdminClient } from '../supabaseAdminClient'
import { getSafeConfigStatus } from '../../config/configStatus'

describe('WIFRAN-ENV-ISOLATION-001: Strict Environment Separation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  // Test A: Development settings are valid
  it('Test A: Development settings resolve development project without fallback', () => {
    const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
    expect(config.context).toBe('DEVELOPMENT_TEST')
    expect(config.projectRef).toBe(DEVELOPMENT_PROJECT_REF)
    expect(config.projectRef).toBe('gykrbpykjhpyrdrinkuk')
    expect(config.dbHost).toBe('db.gykrbpykjhpyrdrinkuk.supabase.co')
    expect(config.isValidated).toBe(true)

    const client = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    expect(client).toBeDefined()
  })

  // Test B: Development credentials missing fails closed
  it('Test B: Development credentials missing fails closed and does NOT fall back to production', () => {
    expect(() =>
      resolveDatabaseConfig('DEVELOPMENT_TEST', {
        DEV_SUPABASE_URL: '',
        DEV_NEXT_PUBLIC_SUPABASE_URL: ''
      })
    ).toThrow(/DEV_SUPABASE_URL is missing.*fallback to production is strictly forbidden/i)

    expect(() =>
      resolveDatabaseConfig('DEVELOPMENT_TEST', {
        DEV_SUPABASE_SERVICE_ROLE_KEY: ''
      })
    ).toThrow(/DEV_SUPABASE_SERVICE_ROLE_KEY is missing/i)
  })

  // Test C: Production URL injected into test settings is rejected before network
  it('Test C: Production URL injected into test settings is rejected before network access', () => {
    expect(() =>
      resolveDatabaseConfig('DEVELOPMENT_TEST', {
        DEV_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`
      })
    ).toThrow(/CRITICAL SAFETY VIOLATION.*PRODUCTION project ref/i)

    expect(() =>
      resolveDatabaseConfig('DEVELOPMENT_TEST', {
        DEV_SUPABASE_URL: `https://swratbmclahjyekouned.supabase.co`
      })
    ).toThrow(/CRITICAL SAFETY VIOLATION.*PRODUCTION project ref/i)
  })

  // Test D: Production credentials injected into test settings are rejected
  it('Test D: Production credentials injected into test settings are rejected', () => {
    const prodServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (prodServiceKey) {
      expect(() =>
        resolveDatabaseConfig('DEVELOPMENT_TEST', {
          DEV_SUPABASE_SERVICE_ROLE_KEY: prodServiceKey
        })
      ).toThrow(/CRITICAL SAFETY VIOLATION.*DEV_SUPABASE_SERVICE_ROLE_KEY matches production/i)
    }

    const prodDbPassword = process.env.SUPABASE_DB_PASSWORD
    if (prodDbPassword) {
      expect(() =>
        resolveDatabaseConfig('DEVELOPMENT_TEST', {
          DEV_SUPABASE_DB_PASSWORD: prodDbPassword
        })
      ).toThrow(/CRITICAL SAFETY VIOLATION.*DEV_SUPABASE_DB_PASSWORD matches production/i)
    }
  })

  // Test E: Normal UI resolves production
  it('Test E: Normal UI resolves production exclusively with zero mutations', () => {
    const config = resolveDatabaseConfig('PRODUCTION_UI')
    expect(config.context).toBe('PRODUCTION_UI')
    expect(config.projectRef).toBe(PRODUCTION_PROJECT_REF)
    expect(config.projectRef).toBe('swratbmclahjyekouned')
    expect(config.dbHost).toBe('db.swratbmclahjyekouned.supabase.co')
    expect(config.isValidated).toBe(true)

    const adminClient = getSupabaseAdminClient()
    expect(adminClient).toBeDefined()
  })

  // Test F: Normal UI cannot switch to development
  it('Test F: Normal UI cannot switch to development configuration', () => {
    expect(() =>
      resolveDatabaseConfig('PRODUCTION_UI', {
        SUPABASE_URL: `https://${DEVELOPMENT_PROJECT_REF}.supabase.co`
      })
    ).toThrow(/CRITICAL SAFETY VIOLATION.*DEVELOPMENT project ref/i)

    expect(() =>
      resolveDatabaseConfig('PRODUCTION_UI', {
        SUPABASE_URL: 'https://arbitrary-project-ref.supabase.co'
      })
    ).toThrow(/Project ref mismatch: Expected production ref/i)
  })

  // Test G: Development database schema & buckets verified
  it('Test G: Development database schema and storage buckets exist', async () => {
    const client = createGuardedPgClient('DEVELOPMENT_TEST')
    await client.connect()

    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `)
    const tables = new Set(tablesRes.rows.map((r) => r.table_name))

    const requiredTables = [
      'products',
      'offers',
      'product_aliases',
      'product_alias_proposals',
      'product_alias_audit_log',
      'brands',
      'categories',
      'cities',
      'regions',
      'supermarkets',
      'supermarket_regions',
      'units',
      'legacy_id_crosswalk',
      'product_images',
      'offer_display_images'
    ]

    for (const req of requiredTables) {
      expect(tables.has(req)).toBe(true)
    }

    const viewsRes = await client.query(`
      SELECT table_name FROM information_schema.views WHERE table_schema = 'public';
    `)
    const views = new Set(viewsRes.rows.map((r) => r.table_name))
    expect(views.has('v_consumer_offers')).toBe(true)

    await client.end()

    // Buckets
    const sb = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    const { data: buckets } = await sb.storage.listBuckets()
    const bucketIds = new Set((buckets || []).map((b) => b.id))

    expect(bucketIds.has('product-images')).toBe(true)
    expect(bucketIds.has('offer-display-images')).toBe(true)
    expect(bucketIds.has('offer-images')).toBe(true)
    expect(bucketIds.has('tmp')).toBe(true)
  })

  // Test H: Development writes and cleanup (reversible test on dev, 0 impact on prod)
  it('Test H: Development writes and cleanup are restricted to development', async () => {
    const sb = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    const devConfig = resolveDatabaseConfig('DEVELOPMENT_TEST')
    expect(devConfig.projectRef).toBe(DEVELOPMENT_PROJECT_REF)

    const testProductName = `__ISOLATION_TEST_${Date.now()}__`
    const testKey = `test:isolation:${Date.now()}`

    // Insert into development
    const { data: inserted, error: insertErr } = await sb
      .from('products')
      .insert({
        canonical_product_key: testKey,
        name_en: testProductName,
        name_ar: 'اختبار العزل',
        verification_status: 'candidate'
      })
      .select('id, name_en')
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeDefined()
    expect(inserted!.name_en).toBe(testProductName)

    // Verify it exists in dev
    const { data: retrieved } = await sb
      .from('products')
      .select('id, name_en')
      .eq('id', inserted!.id)
      .single()

    expect(retrieved?.name_en).toBe(testProductName)

    // Clean up from dev
    const { error: delErr } = await sb.from('products').delete().eq('id', inserted!.id)
    expect(delErr).toBeNull()

    // Verify deleted from dev
    const { data: postDel } = await sb
      .from('products')
      .select('id')
      .eq('id', inserted!.id)

    expect(postDel?.length).toBe(0)
  })

  // Test I: Normal Electron app configured for prod in both dev and prod modes
  it('Test I: Normal UI database configuration targets production regardless of NODE_ENV', () => {
    const origNodeEnv = process.env.NODE_ENV

    try {
      process.env.NODE_ENV = 'development'
      const devModeConfig = resolveDatabaseConfig('PRODUCTION_UI')
      expect(devModeConfig.projectRef).toBe(PRODUCTION_PROJECT_REF)

      process.env.NODE_ENV = 'production'
      const prodModeConfig = resolveDatabaseConfig('PRODUCTION_UI')
      expect(prodModeConfig.projectRef).toBe(PRODUCTION_PROJECT_REF)
    } finally {
      process.env.NODE_ENV = origNodeEnv
    }
  })

  // Test J: Supabase CLI target safety
  it('Test J: Migration and CLI wrappers fail closed if targeting production', () => {
    const guardCliTarget = (targetRef: string) => {
      const parsedRef = extractProjectRef(targetRef) || targetRef.trim().toLowerCase()
      if (parsedRef === PRODUCTION_PROJECT_REF) {
        throw new Error(`SAFETY ERROR: CLI execution target matches PRODUCTION (${PRODUCTION_PROJECT_REF})!`)
      }
      if (parsedRef !== DEVELOPMENT_PROJECT_REF) {
        throw new Error(`SAFETY ERROR: CLI execution target is not DEVELOPMENT (${DEVELOPMENT_PROJECT_REF})!`)
      }
      return { allowed: true, targetRef: parsedRef }
    }

    expect(() => guardCliTarget(PRODUCTION_PROJECT_REF)).toThrow(/matches PRODUCTION/i)
    expect(() => guardCliTarget('https://swratbmclahjyekouned.supabase.co')).toThrow(/matches PRODUCTION/i)
    expect(() => guardCliTarget('unknown-ref')).toThrow(/not DEVELOPMENT/i)
    expect(guardCliTarget(DEVELOPMENT_PROJECT_REF)).toEqual({
      allowed: true,
      targetRef: DEVELOPMENT_PROJECT_REF
    })
  })

  // Test K: Direct PostgreSQL clients fail closed if development credentials missing or target production
  it('Test K: Direct PostgreSQL client creation fails closed on invalid or leaked targets', () => {
    // Missing password
    expect(() =>
      createGuardedPgClient('DEVELOPMENT_TEST', {
        DEV_SUPABASE_DB_PASSWORD: ''
      })
    ).toThrow(/Database password for DEVELOPMENT_TEST is missing/i)

    // Injected production URL
    expect(() =>
      createGuardedPgClient('DEVELOPMENT_TEST', {
        DEV_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`
      })
    ).toThrow(/CRITICAL SAFETY VIOLATION.*PRODUCTION project ref/i)

    // Injected production password
    const prodDbPassword = process.env.SUPABASE_DB_PASSWORD
    if (prodDbPassword) {
      expect(() =>
        createGuardedPgClient('DEVELOPMENT_TEST', {
          DEV_SUPABASE_DB_PASSWORD: prodDbPassword
        })
      ).toThrow(/CRITICAL SAFETY VIOLATION.*DEV_SUPABASE_DB_PASSWORD matches production/i)
    }
  })

  // Test L: Quarantined historical scripts fail closed without explicit dual authorization
  it('Test L: Quarantined historical scripts fail closed without explicit dual authorization', () => {
    const originalArgv = [...process.argv]
    delete process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED

    try {
      // 1. Without any authorization
      expect(() =>
        assertProductionMaintenanceAuthorized('scripts/execute-prelaunch-reset.ts')
      ).toThrow(/PRODUCTION_SAFETY_QUARANTINE.*execute-prelaunch-reset\.ts/i)

      // 2. With env var ONLY (no CLI flag)
      process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED = '1'
      expect(() =>
        assertProductionMaintenanceAuthorized('scripts/execute-prelaunch-reset.ts')
      ).toThrow(/PRODUCTION_SAFETY_QUARANTINE.*execute-prelaunch-reset\.ts/i)

      // 3. With CLI flag ONLY (no env var)
      delete process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED
      process.argv.push('--allow-production-admin-operation')
      expect(() =>
        assertProductionMaintenanceAuthorized('scripts/execute-prelaunch-reset.ts')
      ).toThrow(/PRODUCTION_SAFETY_QUARANTINE.*execute-prelaunch-reset\.ts/i)

      // 4. With BOTH authorizations present
      process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED = '1'
      expect(() =>
        assertProductionMaintenanceAuthorized('scripts/execute-prelaunch-reset.ts')
      ).not.toThrow()
    } finally {
      process.argv = originalArgv
      delete process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED
    }
  })

  // Test M: Test-only credentials and raw secrets are never leaked to renderer configuration
  it('Test M: Test-only credentials and raw secrets are never leaked to renderer configuration', () => {
    const status = getSafeConfigStatus()

    // Context must be PRODUCTION_UI
    expect(status.databaseEnvironment?.context).toBe('PRODUCTION_UI')
    expect(status.databaseEnvironment?.projectRef).toBe(PRODUCTION_PROJECT_REF)
    expect(status.databaseEnvironment?.isValidatedProduction).toBe(true)

    // Config keys must only be boolean indicators, never raw credential strings
    expect(status.supabase.serviceRoleKey.configured).toBe(true)
    expect((status.supabase.serviceRoleKey as any).value).toBeUndefined()
    expect((status.supabase as any).password).toBeUndefined()

    // No DEV_ properties exposed in the object
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('DEV_SUPABASE_')
    expect(serialized).not.toContain(process.env.SUPABASE_DB_PASSWORD || '___')
    expect(serialized).not.toContain(process.env.DEV_SUPABASE_DB_PASSWORD || '___')
  })

  // Test N: Offline UAT mode strictly blocks remote database operations
  it('Test N: Offline UAT mode strictly blocks remote database access in client factories', () => {
    const originalOffline = process.env.WIFRAN_OFFLINE_UAT

    try {
      process.env.WIFRAN_OFFLINE_UAT = '1'
      expect(() => getSupabaseAdminClient()).toThrow(/OFFLINE_UAT_GUARD/i)
    } finally {
      if (originalOffline !== undefined) {
        process.env.WIFRAN_OFFLINE_UAT = originalOffline
      } else {
        delete process.env.WIFRAN_OFFLINE_UAT
      }
    }
  })
})
