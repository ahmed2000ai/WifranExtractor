export type AppEnvironment = 'development' | 'production';

export type AppHealthStatus = {
  ok: boolean;
  appVersion: string;
  environment: AppEnvironment;
};
