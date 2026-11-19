export type AppEnvironment = 'development' | 'production'

export interface DatabaseEnvironmentStatus {
  context: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  projectRef: string
  displayBadge: string
  isValidatedProduction: boolean
  error?: string
}

export type AppHealthStatus = {
  ok: boolean
  appVersion: string
  environment: AppEnvironment
  isOfflineUat?: boolean
  databaseEnvironment?: DatabaseEnvironmentStatus
}
