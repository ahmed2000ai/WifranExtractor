# Developer Security Notes

This application handles highly sensitive API keys. You MUST follow these security patterns.

## The Security Boundary
The React application (`src/renderer`) runs in an untrusted browser context. The Electron Node application (`src/main`) runs in a trusted desktop context. The two communicate via `src/preload/index.ts`.

### 🚨 FORBIDDEN PATTERNS
Never do any of the following:

- **NO** exposing secrets to the renderer. 
  ```typescript
  // ❌ BAD (in preload or main IPC)
  ipcMain.handle('get-env', () => process.env)
  ```
- **NO** using the Supabase Service Role Key or Mistral API Key in the frontend.
  ```tsx
  // ❌ BAD (in React components)
  const supabase = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  ```

### Operator Configuration
The operator only needs to fill these 4 keys in `.env.local`:
```env
MISTRAL_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```
All other keys fallback to safe defaults. This guarantees the minimum attack surface while preserving maximum required capabilities.
- **NO** generic DB IPC bridges.
  ```typescript
  // ❌ BAD
  ipcMain.handle('db-execute', (_, sql) => db.query(sql))
  ```
- **NO** bypassing validation gates.
  Offers must **always** pass strict publishing validation gates. Rows with blocking errors must never be synced as `published`. They must be skipped or marked as error. Promotional rows or isolated SKU/badge texts are strictly rejected.
- **NO** destructive operations. Do not create IPC methods to delete Wifran categories or wipe out user data.

### ✅ SAFE PATTERNS
- The Renderer calls specific, purpose-built IPC methods:
  ```typescript
  // ✅ GOOD
  window.api.getSupabaseConnectionStatus() // returns boolean
  window.api.runOcrExtraction(imagePath)   // returns parsed OCR data
  ```
- All external API calls (Supabase/Mistral) happen entirely in `src/main/services/`.
- Local `.env.local` file is explicitly ignored in `.gitignore` and `electron-builder.yml`.
