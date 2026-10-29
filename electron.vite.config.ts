import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Ensure process.env in node environment has these loaded env vars
  for (const [key, val] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@main': resolve('src/main'),
          '@shared': resolve('src/shared')
        }
      },
      define: {
        'process.env.MISTRAL_API_KEY': JSON.stringify(env.MISTRAL_API_KEY || process.env.MISTRAL_API_KEY || '')
      },
      build: {
        watch: {
          exclude: ['**/Extracts/**']
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      build: {
        watch: {
          exclude: ['**/Extracts/**']
        }
      }
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()],
      server: {
        watch: {
          ignored: ['**/Extracts/**']
        }
      }
    }
  }
})

