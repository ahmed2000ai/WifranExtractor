/**
 * Wifran Extractor - Guarded Database Environment Resolver
 *
 * Implements strict, fail-closed separation between PRODUCTION and DEVELOPMENT Supabase databases:
 *
 * - PRODUCTION_UI: Used exclusively by the normal operator UI. Resolves ONLY non-DEV_ credentials
 *   and strictly verifies project ref 'swratbmclahjyekouned'. Zero fallback to development.
 *
 * - DEVELOPMENT_TEST: Used exclusively by tests, scripts, and dev tooling. Resolves ONLY DEV_ credentials
 *   and strictly verifies project ref 'gykrbpykjhpyrdrinkuk'. Zero fallback to production.
 *
 * Any cross-environment leakage, mismatched project ref, or missing configuration FAILS CLOSED
 * before any network connection or query can execute.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Client, Pool } from 'pg'
import path from 'path'
import WebSocket from 'ws'
import { loadEnvConfig } from '../config/env'

if (typeof global.WebSocket === 'undefined') {
  ;(global as any).WebSocket = WebSocket
}

export type DatabaseContext = 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'

export const PRODUCTION_PROJECT_REF = 'swratbmclahjyekouned'
export const DEVELOPMENT_PROJECT_REF = 'gykrbpykjhpyrdrinkuk'

export interface GuardedDatabaseConfig {
  context: DatabaseContext
  projectRef: string
  url: string
  cleanUrl: string
  serviceRoleKey: string
  anonKey?: string
  dbPassword?: string
  dbHost: string
  dbPort: number
  dbUser: string
  database: string
  storageBucket: string
  isValidated: boolean
}

/**
 * Extracts the Supabase project reference identifier from a URL, host, or connection string.
 * Supports:
 *   - https://<ref>.supabase.co
 *   - http://<ref>.supabase.co
 *   - db.<ref>.supabase.co
 *   - postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 */
export function extractProjectRef(urlOrHost: string | undefined | null): string | null {
  if (!urlOrHost) return null
  const trimmed = urlOrHost.trim()

  const httpsMatch = trimmed.match(/^https?:\/\/([a-z0-9_-]+)\.supabase\.co/i)
  if (httpsMatch) return httpsMatch[1].toLowerCase()

  const dbMatch = trimmed.match(/^db\.([a-z0-9_-]+)\.supabase\.co/i)
  if (dbMatch) return dbMatch[1].toLowerCase()

  const pgMatch = trimmed.match(/@(?:db\.)?([a-z0-9_-]+)\.supabase\.co/i)
  if (pgMatch) return pgMatch[1].toLowerCase()

  return null
}

/**
 * Resolves and validates database configuration for an explicit context.
 * An optional envOverrides dictionary may be supplied for deterministic unit testing.
 */
export function resolveDatabaseConfig(
  context: DatabaseContext,
  envOverrides?: Record<string, string | undefined>
): GuardedDatabaseConfig {
  // Ensure base environment variables are loaded
  loadEnvConfig()

  const getEnv = (key: string): string | undefined => {
    if (envOverrides && Object.prototype.hasOwnProperty.call(envOverrides, key)) {
      return envOverrides[key]
    }
    return process.env[key]
  }

  if (context === 'PRODUCTION_UI') {
    const rawUrl = getEnv('SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL') || ''
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey = getEnv('SUPABASE_ANON_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const dbPassword = getEnv('SUPABASE_DB_PASSWORD')
    const storageBucket = getEnv('SUPABASE_STORAGE_BUCKET') || 'offer-images'

    if (!rawUrl || rawUrl.trim() === '') {
      throw new Error('[PRODUCTION_UI Guard] SUPABASE_URL is missing in environment variables.')
    }
    if (!serviceRoleKey || serviceRoleKey.trim() === '') {
      throw new Error('[PRODUCTION_UI Guard] SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.')
    }

    const projectRef = extractProjectRef(rawUrl)
    if (!projectRef) {
      throw new Error(`[PRODUCTION_UI Guard] Could not extract Supabase project ref from URL: "${rawUrl}"`)
    }

    if (projectRef === DEVELOPMENT_PROJECT_REF) {
      throw new Error(
        `[PRODUCTION_UI Guard] CRITICAL SAFETY VIOLATION: Production UI configuration points to DEVELOPMENT project ref (${DEVELOPMENT_PROJECT_REF})! Operation blocked.`
      )
    }

    if (projectRef !== PRODUCTION_PROJECT_REF) {
      throw new Error(
        `[PRODUCTION_UI Guard] Project ref mismatch: Expected production ref "${PRODUCTION_PROJECT_REF}", but got "${projectRef}".`
      )
    }

    const cleanUrl = rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')

    return {
      context: 'PRODUCTION_UI',
      projectRef,
      url: rawUrl,
      cleanUrl,
      serviceRoleKey,
      anonKey,
      dbPassword,
      dbHost: `db.${projectRef}.supabase.co`,
      dbPort: 5432,
      dbUser: 'postgres',
      database: 'postgres',
      storageBucket,
      isValidated: true
    }
  }

  if (context === 'DEVELOPMENT_TEST') {
    const rawUrl = getEnv('DEV_SUPABASE_URL') || getEnv('DEV_NEXT_PUBLIC_SUPABASE_URL') || ''
    const serviceRoleKey = getEnv('DEV_SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey = getEnv('DEV_SUPABASE_ANON_KEY') || getEnv('DEV_NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const dbPassword = getEnv('DEV_SUPABASE_DB_PASSWORD')
    const storageBucket = getEnv('DEV_SUPABASE_STORAGE_BUCKET') || 'offer-images'

    // Fail-closed checks: Development must NEVER fall back to production
    if (!rawUrl || rawUrl.trim() === '') {
      throw new Error(
        '[DEVELOPMENT_TEST Guard] DEV_SUPABASE_URL is missing. Automatic fallback to production is strictly forbidden.'
      )
    }
    if (!serviceRoleKey || serviceRoleKey.trim() === '') {
      throw new Error(
        '[DEVELOPMENT_TEST Guard] DEV_SUPABASE_SERVICE_ROLE_KEY is missing. Development test operations fail closed.'
      )
    }

    const projectRef = extractProjectRef(rawUrl)
    if (!projectRef) {
      throw new Error(
        `[DEVELOPMENT_TEST Guard] Could not extract Supabase project ref from development URL: "${rawUrl}"`
      )
    }

    // Hard safety guards against targeting production
    if (projectRef === PRODUCTION_PROJECT_REF) {
      throw new Error(
        `[DEVELOPMENT_TEST Guard] CRITICAL SAFETY VIOLATION: Development test configuration attempted to target PRODUCTION project ref (${PRODUCTION_PROJECT_REF})! Operation blocked immediately.`
      )
    }

    if (projectRef !== DEVELOPMENT_PROJECT_REF) {
      throw new Error(
        `[DEVELOPMENT_TEST Guard] Project ref mismatch: Expected development ref "${DEVELOPMENT_PROJECT_REF}", but got "${projectRef}".`
      )
    }

    // Check cross-environment URL equality
    const prodUrl = getEnv('SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL')
    if (prodUrl && rawUrl.trim().toLowerCase() === prodUrl.trim().toLowerCase()) {
      throw new Error(
        '[DEVELOPMENT_TEST Guard] CRITICAL SAFETY VIOLATION: DEV_SUPABASE_URL matches production SUPABASE_URL! Operation blocked.'
      )
    }

    // Check cross-environment service-role credential leakage
    const prodServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    if (prodServiceKey && serviceRoleKey.trim() === prodServiceKey.trim()) {
      throw new Error(
        '[DEVELOPMENT_TEST Guard] CRITICAL SAFETY VIOLATION: DEV_SUPABASE_SERVICE_ROLE_KEY matches production SUPABASE_SERVICE_ROLE_KEY! Operation blocked.'
      )
    }

    // Check cross-environment DB password leakage
    const prodDbPassword = getEnv('SUPABASE_DB_PASSWORD')
    if (prodDbPassword && dbPassword && dbPassword.trim() === prodDbPassword.trim()) {
      throw new Error(
        '[DEVELOPMENT_TEST Guard] CRITICAL SAFETY VIOLATION: DEV_SUPABASE_DB_PASSWORD matches production SUPABASE_DB_PASSWORD! Operation blocked.'
      )
    }

    const cleanUrl = rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')

    return {
      context: 'DEVELOPMENT_TEST',
      projectRef,
      url: rawUrl,
      cleanUrl,
      serviceRoleKey,
      anonKey,
      dbPassword,
      dbHost: `db.${projectRef}.supabase.co`,
      dbPort: 5432,
      dbUser: 'postgres',
      database: 'postgres',
      storageBucket,
      isValidated: true
    }
  }

  throw new Error(`[GuardedDatabaseResolver] Unknown database context: "${context}"`)
}

/**
 * Creates or retrieves a validated, guarded Supabase client for the requested context.
 */
export function getGuardedSupabaseClient(
  context: DatabaseContext,
  envOverrides?: Record<string, string | undefined>
): SupabaseClient {
  const config = resolveDatabaseConfig(context, envOverrides)

  return createClient(config.cleanUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * Creates a validated, guarded pg.Client connection for the requested context.
 */
export function createGuardedPgClient(
  context: DatabaseContext,
  envOverrides?: Record<string, string | undefined>
): Client {
  const config = resolveDatabaseConfig(context, envOverrides)

  if (!config.dbPassword) {
    throw new Error(`[createGuardedPgClient] Database password for ${context} is missing.`)
  }

  return new Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.database,
    ssl: { rejectUnauthorized: false }
  })
}

/**
 * Creates a validated, guarded pg.Pool connection pool for the requested context.
 */
export function createGuardedPgPool(
  context: DatabaseContext,
  envOverrides?: Record<string, string | undefined>
): Pool {
  const config = resolveDatabaseConfig(context, envOverrides)

  if (!config.dbPassword) {
    throw new Error(`[createGuardedPgPool] Database password for ${context} is missing.`)
  }

  return new Pool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.database,
    ssl: { rejectUnauthorized: false }
  })
}

/**
 * Hard safety quarantine for historical production administrative scripts.
 * Prevents accidental execution of legacy scripts that target production.
 *
 * To execute a quarantined script, the operator must explicitly supply BOTH:
 *   1. WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1 (in environment)
 *   2. --allow-production-admin-operation (CLI flag)
 */
export function assertProductionMaintenanceAuthorized(scriptIdentifier: string): void {
  const confirmed = process.env.WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED === '1'
  const cliFlag = process.argv.includes('--allow-production-admin-operation')

  if (!confirmed || !cliFlag) {
    const baseName = path.basename(scriptIdentifier)
    const errorMsg = [
      '=========================================================================',
      '  CRITICAL SAFETY VIOLATION: HISTORICAL PRODUCTION SCRIPT BLOCKED',
      '=========================================================================',
      `Script: ${baseName} (${scriptIdentifier})`,
      'This script is a historical production utility and targets PRODUCTION (swratbmclahjyekouned).',
      'Automated or unvetted execution of this script is strictly blocked by WIFRAN-ENV-ISOLATION.',
      '',
      'If you are an authorized operator performing deliberate production maintenance,',
      'you MUST provide BOTH of the following explicit authorizations:',
      '  1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1',
      '  2. CLI command-line flag: --allow-production-admin-operation',
      '========================================================================='
    ].join('\n')

    console.error(errorMsg)
    throw new Error(
      `[PRODUCTION_SAFETY_QUARANTINE] Execution of "${baseName}" is blocked without explicit owner authorization.`
    )
  }
}


