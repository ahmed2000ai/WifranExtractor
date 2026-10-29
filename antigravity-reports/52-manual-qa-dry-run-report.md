# 52 Manual QA Dry Run Report

## QA Setup Verification
- **QA Script Added**: `npm run qa:copy-extraction` has been added to safely copy original folders to `Extracts_QA`.
- **Dry-Run Publish Engine**: A local-only pipeline execution toggle `dryRun` has been integrated directly into `PrePublishPreview.tsx` and `offerSyncService.ts`.
- **UI Enhancements**: Added **DRY RUN MODE** and **QA PACKAGE** badges if the package ends in `_qa`. Button text updates to "Dry Run Publish".
- **Report Generation**: Automatically outputs `qa-dry-run-publish-report.json`.
- **Safeguards**: Hard-coded bypasses ensure zero Mistral calls, zero image uploads, and zero database writes if `dryRun` is enabled.

## Manual QA Checklist

The following items should be manually confirmed by the operator using `npm run start` and a QA extraction folder:

- [ ] App opens without errors
- [ ] QA extraction package loads (`Open Existing Extraction Folder...`)
- [ ] Original extraction package remains untouched
- [ ] Manifest loads properly
- [ ] Extraction status is completed or clearly shows incomplete
- [ ] Pre-Publish Preview button is enabled only for completed packages
- [ ] Pre-Publish Preview opens successfully
- [ ] Crop image grid displays properly
- [ ] Every visible card has FIELD_NAME / VALUE rows
- [ ] Decision badges display (Publish, Publish (No Comp), Skip, etc)
- [ ] Comparison badges display (Eligible vs Excluded)
- [ ] Warning/error counts display
- [ ] All / Will Publish / Excluded / Skipped / Warnings / Errors / Non-Grocery filters work
- [ ] Skipped/quarantined rows are visible
- [ ] Skipped/quarantined rows are not eligible for publish (grayed out or blocked)
- [ ] Opening preview does not publish anything
- [ ] Dry Run Publish requires confirmation
- [ ] Dry Run Publish does not call Supabase upload (Automated tests verify this)
- [ ] Dry Run Publish does not call Supabase DB upsert (Automated tests verify this)
- [ ] Dry-run report `qa-dry-run-publish-report.json` is generated
- [ ] Accuracy report is generated/updated
- [ ] No Mistral calls were made
- [ ] No Supabase writes were made
- [ ] No secrets were logged

## Commands Run During Setup
- `npx vitest run src/main/prepublish src/main/db src/main/reporting` (Passed successfully)

## Remaining Risks & Next Steps
- **Next Step**: Run manual QA in the app with a copied extraction package, then inspect the dry-run report before any real publish.
