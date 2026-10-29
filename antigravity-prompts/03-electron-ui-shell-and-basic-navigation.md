# Antigravity Prompt Chunk 03: Electron UI Shell and Basic Navigation

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 03. Prompt Chunks 01 and 02 should already have created the base Electron + React + TypeScript skeleton and secure environment/config status foundation.

## 1. Read These Files First

Before coding, read all files inside:

```text
project-knowledge/
```

Specifically read:

```text
project-knowledge/00-prd-wifran-offers-extractor.md
project-knowledge/01-product-brief-and-scope.md
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
project-knowledge/07-sample-extraction-json.md
project-knowledge/08-antigravity-development-plan.md
```

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Build a simple, usable desktop UI shell and basic navigation.

This chunk should make the app feel like a real internal tool, but it should still only use placeholder data.

Do **not** implement Supabase reference-data loading yet.

Do **not** implement OCR yet.

Do **not** implement PDF selection yet.

Do **not** implement PDF splitting/rendering yet.

Do **not** implement image cropping yet.

Do **not** add database migrations.

Do **not** create or insert real Wifran offers.

## 3. Required Screens

Create or update the renderer so the app has these screens:

```text
Import
Results
Settings
Logs
```

These screens can be simple, but they should be clearly separated.

The user should be able to switch between them using sidebar or top navigation.

## 4. Recommended Renderer Structure

Use or create a structure similar to:

```text
src/renderer/
  components/
    AppLayout.tsx
    Navigation.tsx
    StatusBadge.tsx
    EmptyState.tsx
    PageHeader.tsx
  pages/
    ImportPage.tsx
    ResultsPage.tsx
    SettingsPage.tsx
    LogsPage.tsx
  hooks/
    useAppHealth.ts
    useConfigStatus.ts
  styles/
    global.css
```

Adapt file names if the existing skeleton uses different conventions, but preserve these responsibilities.

## 5. App Layout Requirements

Create a layout that includes:

* App title: `Wifran Offers Extractor`
* Subtitle: `Internal desktop tool for supermarket offer extraction`
* Navigation for Import, Results, Settings, and Logs
* Main content area
* Small footer/status area showing app health/config status if available

The UI does not need to be beautiful, but it should be clean and usable.

## 6. Navigation Requirements

Navigation should:

* Let the user switch between screens.
* Highlight the active screen.
* Not require external routing unless already installed.
* Use local React state if simpler.
* Preserve the secure preload API usage from earlier chunks.

Do not introduce a large routing dependency unless it is already used or clearly justified.

## 7. Import Page Placeholder

Create `ImportPage`.

For now, it should show a disabled/placeholder version of the future import form.

Include sections for:

```text
1. PDF Leaflet
2. Supermarket
3. Location
4. Offer Dates
5. Processing
```

Show placeholder controls:

* PDF file picker placeholder button, disabled or not wired yet.
* Supermarket dropdown placeholder, disabled.
* City/region dropdown placeholder, disabled.
* Start date field placeholder.
* End date field placeholder.
* Start extraction button, disabled.
* Message: `PDF selection and reference-data loading will be implemented in later prompt chunks.`

Do not implement real PDF selection in this chunk.

## 8. Results Page Placeholder

Create `ResultsPage`.

It should show:

* Empty state for no imports yet.
* Placeholder summary cards:

  * Total rows
  * Imported rows
  * Warning rows
  * Error rows
  * Skipped rows
  * Skipped promotional rows
* Placeholder results table headers:

  * Row
  * Page
  * Product
  * Price
  * Status
  * Image
  * Issues

Show message:

```text
No import has been processed yet.
```

Do not implement real data loading in this chunk.

## 9. Settings Page Update

Prompt Chunk 02 should already have a Settings page showing safe config status.

Keep that functionality.

Improve the page layout if needed so it fits into the new app shell.

Settings page should show:

* Supabase config readiness
* Mistral config readiness
* OCR processing settings
* PDF/image settings
* Import behavior settings
* Validation errors/warnings

Do not display actual secret values.

Only display configured/missing status for secrets.

## 10. Logs Page Placeholder

Create `LogsPage`.

It should show a placeholder local log panel.

Include sample static entries like:

```text
App started.
Configuration status loaded.
Waiting for import.
```

Make clear that real import logs will be implemented later.

Do not implement file-based logging UI yet unless already trivial.

## 11. Shared UI Components

Create small reusable UI components as needed.

Recommended:

### `PageHeader`

Props:

```ts
type PageHeaderProps = {
  title: string;
  description?: string;
};
```

### `StatusBadge`

Props:

```ts
type StatusBadgeProps = {
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: React.ReactNode;
};
```

### `EmptyState`

Props:

```ts
type EmptyStateProps = {
  title: string;
  description?: string;
};
```

Keep components simple.

## 12. Styling Requirements

Create or update global styles.

The app should be readable and practical.

Recommended:

* Light background.
* Clear content cards.
* Comfortable spacing.
* Clear active navigation state.
* Tables should be legible.
* Avoid tiny text.
* Avoid visual clutter.

No need for a design system unless already available.

Do not spend too much effort on polish.

## 13. App Health and Config Hooks

If Prompt Chunk 02 exposed these preload APIs:

```ts
window.wifranExtractor.app.getHealth()
window.wifranExtractor.config.getStatus()
```

Create hooks:

```text
src/renderer/hooks/useAppHealth.ts
src/renderer/hooks/useConfigStatus.ts
```

These hooks should:

* Call the preload APIs.
* Track loading/error states.
* Avoid throwing uncaught errors.
* Return safe data only.

If preload API names are slightly different, adapt accordingly.

## 14. Renderer Safety Rules

The renderer must not import anything from:

```text
src/main/
```

Forbidden:

```ts
import { getAppConfig } from '../../main/config/env';
```

The renderer should only receive safe data through the preload bridge.

Do not expose `ipcRenderer` directly.

Do not expose environment variables.

Do not expose secrets.

## 15. TypeScript Requirements

Ensure TypeScript understands the preload API.

If needed, create or update a declaration file such as:

```text
src/renderer/global.d.ts
```

or

```text
src/shared/types/preload.ts
```

The declaration should include only safe APIs.

Example:

```ts
declare global {
  interface Window {
    wifranExtractor: {
      app: {
        getVersion: () => Promise<string>;
        getHealth: () => Promise<AppHealthStatus>;
      };
      config: {
        getStatus: () => Promise<SafeConfigStatus>;
      };
    };
  }
}
```

Adapt to actual existing types.

## 16. Error Handling Requirements

For app health/config status loading:

* Show loading state.
* Show safe error state if preload call fails.
* Do not crash the whole renderer.
* Do not show stack traces containing local paths unless in developer-friendly area.
* Do not show secrets.

## 17. README Update

Update `README.md` to mention:

* UI shell added.
* Screens currently available:

  * Import
  * Results
  * Settings
  * Logs
* Import/OCR/database functionality is not implemented yet.
* Next expected step is Supabase connection and reference data loading.

## 18. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in the renderer.
* Do not expose `process.env` to the renderer.
* Do not expose generic IPC.
* Do not add OCR calls.
* Do not add Supabase database calls.
* Do not implement PDF/file selection yet.
* Do not add database migrations.
* Do not create offer records.
* Do not create products, brands, or categories.
* Do not create offers from banners or promotional areas.

## 19. Acceptance Criteria

This chunk is complete when:

* The app has a usable UI shell.
* Navigation between Import, Results, Settings, and Logs works.
* Import page has placeholder form sections.
* Results page has placeholder summary and table.
* Settings page shows safe config readiness.
* Logs page shows placeholder logs.
* Renderer does not import main-process code.
* No secrets are displayed.
* TypeScript compiles.
* App still starts.
* Existing config status functionality still works.
* No OCR/Supabase/PDF/image-processing logic has been added yet.

## 20. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How navigation works.
* How settings/config status is displayed.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.