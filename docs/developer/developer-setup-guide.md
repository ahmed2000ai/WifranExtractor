# Developer Setup Guide

## Project Overview
The Wifran Offers Extractor is an Electron + React + TypeScript desktop application.
It acts as a local ETL (Extract, Transform, Load) pipeline for processing PDFs using Mistral OCR, and then synchronizes the parsed offers safely directly to a Wifran Supabase instance.

## Installation
1. Ensure Node.js 18+ is installed.
2. Clone the repository.
3. Run `npm install`.

## Environment Setup
1. Copy `.env.example` to `.env.local` in the project root.
2. Fill in the real `SUPABASE_SERVICE_ROLE_KEY` and `MISTRAL_API_KEY`.
   - *Note: Since this app uses the service role key to bypass RLS during data import, this key MUST remain exclusively in the Main Process.*

## Running the App
- **Dev Mode**: `npm run dev`
  - Vite will automatically start the renderer on a local port, and Electron will attach.

## Testing & Validation
We rely on a robust test suite instead of live Wifran DB testing for regression checks.
- `npm run typecheck` - Validates TypeScript types for Main, Preload, and Renderer.
- `npm run validate:fixtures` - Tests `ocrNormalization.ts` and `promotionalFilter.ts` logic against static JSON Mistral responses.
- `npm run test:smoke` - Executes pure unit math and checks the renderer code for accidentally leaked secrets.
- `npm run test` - Runs all of the above sequentially.

## Architecture
- `src/main`: Electron Main Process. Handles DB connections, OS File System, and API requests to Mistral. This is the **trusted environment**.
- `src/preload`: Safely exposes main APIs to the React renderer via context bridge.
- `src/renderer`: React UI. **Untrusted environment**. It manages state and UI but cannot touch the `.env.local` file or access node modules directly.
- `src/shared`: TypeScript types, schemas, and pure utility functions that both Main and Renderer share.

## Future Development Guidelines
- Always preserve the Main/Renderer security boundary.
- Do not expose `process.env` to the Renderer.
- Do not add database migrations to this codebase. This app assumes the Wifran DB schema already exists.
