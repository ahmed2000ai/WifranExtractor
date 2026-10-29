# Pre-Release Checklist

Before handing over a packaged `.exe` to operators, developers must verify the following checklist to ensure app safety and integrity.

## 1. Local Code Integrity
- [ ] `npm install` completes without critical warnings.
- [ ] `npm run typecheck` passes cleanly.
- [ ] `npm run validate:fixtures` passes cleanly (verifying promotional heuristics).
- [ ] `npm run test:smoke` passes cleanly (verifying unit/discount math).

## 2. Security Checks
- [ ] `process.env.SUPABASE_SERVICE_ROLE_KEY` does NOT appear anywhere in `src/renderer`.
- [ ] `process.env.MISTRAL_API_KEY` does NOT appear anywhere in `src/renderer`.
- [ ] The app does NOT contain hardcoded API keys.
- [ ] `.env.local` is excluded from git and the packaged build.
- [ ] The `DEFAULT_OFFER_STATUS` in docs is set to `draft` (never published).

## 3. UI and Manual E2E
- [ ] Start app with `npm run dev`.
- [ ] Settings page shows all green checkmarks (using your local `.env.local`).
- [ ] Run a small PDF (1-2 pages).
- [ ] Verify PDF Preprocessing completes.
- [ ] Verify OCR Extraction parses items.
- [ ] Verify Promotional Filter skips generic banners.
- [ ] Verify Image Cropping produces small JPGs.
- [ ] Verify Final Sync pushes ONLY `draft` or `needs_review` to the database.

## 4. Packaging
- [ ] Run `npm run dist:win` (or `pack:win`).
- [ ] The build succeeds without fatal errors.
- [ ] Verify `dist/` or `release/` does not contain any of your local `imports/` workspace files or `.env.local`.
- [ ] Move the `.exe` to an isolated folder, place a test `.env.local` next to it, and launch.
- [ ] Ensure the packaged app loads configuration properly.

## 5. Final Approval Workflow
- [ ] Explain to operators that the app creates drafts. 
- [ ] The final publishing decision MUST occur inside the Wifran web admin dashboard manually.
