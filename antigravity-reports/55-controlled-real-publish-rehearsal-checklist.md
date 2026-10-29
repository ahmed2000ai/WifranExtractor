# Controlled Real-Publish Rehearsal Checklist

This checklist must be used manually when performing a controlled real-publish rehearsal to ensure safe and audited execution.

## 1. Pre-Flight Preparation
- [ ] Ensure `PUBLISH_REHEARSAL_MODE=true` is active in your configuration or environment.
- [ ] Ensure `PUBLISH_REHEARSAL_MAX_ROWS` is set correctly (default: 5).
- [ ] Confirm you are using either a sandbox Supabase instance or a highly verified tiny production package with only 1–5 valid rows.
- [ ] Supabase target classification is correctly identified and acknowledged in the Pre-Publish Preview.

## 2. Dry-Run Verification
- [ ] Extraction complete and `accuracy-run-report.json` generated.
- [ ] Representative page style-profile selection status is marked as `generated` or explicitly `skipped`.
- [ ] Perform a Dry-Run Publish from the Pre-Publish Preview.
- [ ] Review the latest `dry-run-report-xxx.json`.
- [ ] Verify `dry-run-report` states exactly `0` Supabase uploads and `0` Supabase DB writes.
- [ ] Verify no blocking errors or skipped rows are flagged as `eligible_rows`.

## 3. Rehearsal Execution
- [ ] Open the Pre-Publish Preview.
- [ ] Confirm row count is strictly under the rehearsal limit (e.g., <= 5).
- [ ] Read the Supabase target warning if visible.
- [ ] Type the explicit confirmation phrase: `PUBLISH VERIFIED REHEARSAL`.
- [ ] Click **Run Real Publish Rehearsal**.

## 4. Post-Publish Reconciliation
- [ ] Check `metadata/reports/real-publish-rehearsal-report.json`.
- [ ] Verify `image_upload_success_count` matches the expected eligible row count.
- [ ] Verify `db_upsert_success_count` matches the expected eligible row count.
- [ ] Cross-reference the Supabase Storage bucket to verify the specific image paths uploaded.
- [ ] Cross-reference the Supabase DB to verify the new rows and their `external_image_id`.

## 5. Known Risks & Rollback Notes
- **Rollback is Manual:** This tool does not automatically delete rows or images from Supabase if the rehearsal needs to be reverted.
- **Rollback Strategy:**
  1. Open `real-publish-rehearsal-report.json`.
  2. Find the uploaded images in the Supabase Storage under `offer-images` bucket. Delete them manually.
  3. Find the upserted DB rows in the `offers` table by `external_image_id` or `import_row_id`. Delete them manually.
- **Skipped/Quarantine Rows:** Ensure no rows labeled `skip_or_quarantine` were accidentally uploaded.
