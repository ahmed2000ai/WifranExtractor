The backend and IPC routes for the complete WIFRAN-07J image enrichment workflow (Step 1 Export and Step 3 Import) are fully implemented. We now need to build the complete end-to-end UI in the React frontend (Renderer).

Execute the following tasks:

====================================================================
1. LOCATE OR CREATE THE ENRICHMENT UI COMPONENT
====================================================================
1. Identify the appropriate React component in `src/renderer/` (e.g., a "Catalog Settings", "Image Enrichment", or "Visuals" tab).
2. Create a clean, two-section layout: "Step 1: Export Hybrid Image Search CSV" and "Step 3: Import Approved Image Candidates".

====================================================================
2. IMPLEMENT STEP 1 (EXPORT) UI
====================================================================
1. Add an "Export Image Search CSV" button.
2. Wire this button to invoke the Step 1 IPC route (`productEnrichment:export-csv` or equivalent wrapping `exportProductsForImageSearch`).
3. Implement a file save dialog (via Electron `dialog.showSaveDialog`) so the user can choose where to save the generated `wifran_v2_hybrid_image_refs_for_search.csv` file on their local machine.
4. Show a success toast or notification when the export completes.

====================================================================
3. IMPLEMENT STEP 3 (IMPORT & VALIDATION) UI
====================================================================
1. Add a file picker input allowing the user to select the returning Step 2 CSV file from their local machine.
2. Wire the file selection to invoke the Step 3 validation IPC route (`validateProductImageCsvImport`). 
3. Render a clean UI table or summary card displaying the validation results (Total Rows, Valid Rows, Errors). Do not trigger any uploads at this stage.

====================================================================
4. IMPLEMENT STEP 3 (EXECUTION) UI
====================================================================
1. Add an "Upload Product Images to DB" button. This button MUST be disabled unless validation is successful (`ok: true`).
2. Wire this button to invoke the Step 3 execution IPC route (`uploadApprovedProductImagesToDb` with `operatorConfirmedReview: true`).
3. Add a loading state (spinner and "Processing Batch..." text) while the upload runs.
4. Render the final execution summary (`success`, `skipped`, `errors`) and clear the file picker once the IPC call returns.

Ensure all UI components use the existing design system (Tailwind/MUI/etc.) and remain strictly deterministic with zero frontend LLM logic.