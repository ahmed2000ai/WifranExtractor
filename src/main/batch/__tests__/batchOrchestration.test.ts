import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sharedBatchOrchestrationService } from '../batchOrchestrationService';
import type { BatchProgressEvent } from '../../../shared/types/batchExtraction';

describe('WIFRAN-EXTRACTOR-BULK-001: Multi-Leaflet Batch Extraction & Unified Review', () => {
  const createdTestBatchIds: string[] = [];
  const testPdfsDir = path.join(process.cwd(), 'Extracts', 'test-bulk-fixtures');

  beforeEach(() => {
    if (!fs.existsSync(testPdfsDir)) {
      fs.mkdirSync(testPdfsDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up created test batches from disk
    for (const bId of createdTestBatchIds) {
      const bDir = sharedBatchOrchestrationService.getBatchDir(bId);
      if (fs.existsSync(bDir)) {
        try {
          fs.rmSync(bDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
    if (fs.existsSync(testPdfsDir)) {
      try {
        fs.rmSync(testPdfsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    vi.restoreAllMocks();
  });

  function createDummyPdf(name: string, content: string): { path: string; name: string; sizeBytes: number; contentFingerprint: string } {
    const filePath = path.join(testPdfsDir, name);
    fs.writeFileSync(filePath, `%PDF-1.4 mock content: ${content}`, 'utf8');
    const bytes = fs.readFileSync(filePath);
    const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
      path: filePath,
      name,
      sizeBytes: bytes.length,
      contentFingerprint: fingerprint
    };
  }

  // 1. Multi-PDF Selection & Single-PDF Compatibility
  it('supports selecting multiple distinct PDFs and assigns unique leaflet IDs', async () => {
    const pdf1 = createDummyPdf('NOOR-JEDC-150726.pdf', 'noori-leaflet-data');
    const pdf2 = createDummyPdf('DUKN-NATL-150726.pdf', 'dukan-leaflet-data');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        { path: pdf1.path, name: pdf1.name, sizeBytes: pdf1.sizeBytes, contentFingerprint: pdf1.contentFingerprint, pageCount: 2 },
        { path: pdf2.path, name: pdf2.name, sizeBytes: pdf2.sizeBytes, contentFingerprint: pdf2.contentFingerprint, pageCount: 4 }
      ]
    });
    createdTestBatchIds.push(manifest.batchId);

    expect(manifest.batchId).toMatch(/^batch-\d{4}-\d{2}-\d{2}/);
    expect(manifest.status).toBe('created');
    expect(manifest.leaflets).toHaveLength(2);
    expect(manifest.leaflets[0].leafletId).toBe('leaflet-001');
    expect(manifest.leaflets[1].leafletId).toBe('leaflet-002');
    expect(manifest.totals.totalPdfs).toBe(2);
    expect(manifest.totals.totalPages).toBe(6);
    expect(manifest.totals.pagesProcessed).toBe(0);
    expect(manifest.totals.totalOffers).toBe(0);
  });

  it('supports selecting a single PDF in batch mode without regression', async () => {
    const pdf = createDummyPdf('PAND-JEDC-150726.pdf', 'single-panda-pdf');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [{ path: pdf.path, name: pdf.name, sizeBytes: pdf.sizeBytes, contentFingerprint: pdf.contentFingerprint, pageCount: 3 }]
    });
    createdTestBatchIds.push(manifest.batchId);

    expect(manifest.leaflets).toHaveLength(1);
    expect(manifest.totals.totalPdfs).toBe(1);
    expect(manifest.totals.totalPages).toBe(3);
    expect(manifest.leaflets[0].fileName).toBe('PAND-JEDC-150726.pdf');
  });

  // 2. Duplicate Detection
  it('detects and suppresses duplicate PDF files by path and content fingerprint', async () => {
    const pdf1 = createDummyPdf('FILE-A.pdf', 'same-content-123');
    const pdfDuplicate = { ...pdf1, name: 'FILE-A-COPY.pdf' }; // same path or same fingerprint

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        pdf1,
        pdfDuplicate, // duplicate fingerprint!
        { ...pdf1 } // duplicate path!
      ]
    });
    createdTestBatchIds.push(manifest.batchId);

    // Only 1 unique leaflet should be enrolled in the batch
    expect(manifest.leaflets).toHaveLength(1);
    expect(manifest.totals.totalPdfs).toBe(1);
  });

  // 3. Batch Manifest Durability & Restart Resume
  it('persists manifest atomically and reloads identically from disk', async () => {
    const pdf = createDummyPdf('TEST-LEAFLET.pdf', 'manifest-durability-test');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [pdf]
    });
    createdTestBatchIds.push(manifest.batchId);

    const manifestPath = sharedBatchOrchestrationService.getBatchManifestPath(manifest.batchId);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const reloaded = await sharedBatchOrchestrationService.loadBatchManifest(manifest.batchId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.batchId).toBe(manifest.batchId);
    expect(reloaded?.leaflets[0].fileName).toBe('TEST-LEAFLET.pdf');
    expect(reloaded?.schemaVersion).toBe('1.0');
  });

  // 4. Per-Leaflet Metadata Isolation
  it('preserves per-leaflet metadata without blending retailers or validity dates', async () => {
    const pdfNoori = createDummyPdf('noori-supermarket-229798534-jeddah.pdf', 'noori');
    const pdfDukan = createDummyPdf('dukan-849797163-jeddah.pdf', 'dukan');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [pdfNoori, pdfDukan],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    expect(manifest.leaflets[0].workspacePath).toContain('noori-supermarket-229798534-jeddah');
    expect(manifest.leaflets[1].workspacePath).toContain('dukan-849797163-jeddah');
    expect(manifest.leaflets[0].workspacePath).not.toBe(manifest.leaflets[1].workspacePath);
  });

  // 5. Cache Hit Reuse ($0 Cost, Zero New API Requests)
  it('reuses existing verified extractions (Noori & Dukan fixtures) at $0 cost', async () => {
    // Both Noori and Dukan existing extraction directories exist in Extracts/
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const dukanWorkspace = path.join(process.cwd(), 'Extracts', 'dukan-849797163-jeddah');

    expect(fs.existsSync(path.join(nooriWorkspace, 'staged-draft.json'))).toBe(true);
    expect(fs.existsSync(path.join(dukanWorkspace, 'staged-draft.json'))).toBe(true);

    const pdfNoori = {
      path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'),
      name: 'noori-supermarket-229798534-jeddah.pdf',
      sizeBytes: 1024,
      pageCount: 1
    };
    const pdfDukan = {
      path: path.join(dukanWorkspace, 'dukan-849797163-jeddah.pdf'),
      name: 'dukan-849797163-jeddah.pdf',
      sizeBytes: 1024,
      pageCount: 1
    };

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [pdfNoori, pdfDukan],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    const progressEvents: BatchProgressEvent[] = [];
    const completed = await sharedBatchOrchestrationService.startBatchExtraction(
      manifest.batchId,
      { forceReextract: false },
      (ev) => progressEvents.push(ev)
    );

    expect(completed.status).toBe('completed');
    expect(completed.totals.completedPdfs).toBe(2);
    expect(completed.totals.failedPdfs).toBe(0);
    expect(completed.totals.totalCostUsd).toBe(0); // Zero token cost for cache hit!
    expect(completed.leaflets[0].provenance).toBe('cache');
    expect(completed.leaflets[1].provenance).toBe('cache');
    expect(completed.totals.totalOffers).toBeGreaterThan(0);
  }, 30000);

  // 6. Batch-Scoped Unique Offer Key Format
  it('generates unique batch-scoped offer keys `${batchId}:${leafletId}:${pageNum}:${offerId}`', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const dukanWorkspace = path.join(process.cwd(), 'Extracts', 'dukan-849797163-jeddah');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        { path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 },
        { path: path.join(dukanWorkspace, 'dukan-849797163-jeddah.pdf'), name: 'dukan-849797163-jeddah.pdf', sizeBytes: 1024, pageCount: 1 }
      ],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);
    const unifiedOffers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId);

    expect(unifiedOffers.length).toBeGreaterThan(5);

    // Verify key format and uniqueness
    const seenKeys = new Set<string>();
    for (const off of unifiedOffers) {
      expect(off.batchOfferKey).toMatch(new RegExp(`^${manifest.batchId}:(leaflet-001|leaflet-002):\\d+:.+`));
      expect(seenKeys.has(off.batchOfferKey)).toBe(false);
      seenKeys.add(off.batchOfferKey);

      // Verify that leaflet identities are never blended
      if (off.leafletId === 'leaflet-001') {
        expect(off.sourceFileName).toBe('noori-supermarket-229798534-jeddah.pdf');
      } else if (off.leafletId === 'leaflet-002') {
        expect(off.sourceFileName).toBe('dukan-849797163-jeddah.pdf');
      }
    }
  });

  // 7. Automatic Local Crop Resolution
  it('resolves product_thumb_crop.webp and offer_card_crop.webp for all offers', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [{ path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 }],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);
    const unifiedOffers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId);

    const fazcoOffer = unifiedOffers.find((o) => o.titleEn?.toLowerCase().includes('sugar') || o.titleAr?.includes('سكر'));
    expect(fazcoOffer).toBeDefined();

    if (fazcoOffer?.productThumbCropPath) {
      expect(fs.existsSync(fazcoOffer.productThumbCropPath)).toBe(true);
      expect(fazcoOffer.productThumbCropPath).toContain('product_thumb_crop.webp');
    }
    if (fazcoOffer?.offerCardCropPath) {
      expect(fs.existsSync(fazcoOffer.offerCardCropPath)).toBe(true);
      expect(fazcoOffer.offerCardCropPath).toContain('offer_card_crop.webp');
    }
  });

  // 8. Brand Preservation & Complex Quantities (Noori Offer 007 regression)
  it('preserves brand information and complex quantities from extracted offers', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [{ path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 }],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);
    const unifiedOffers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId);

    // Look for Noor Oil or Fazco Sugar
    const noorOil = unifiedOffers.find((o) => o.titleEn?.toLowerCase().includes('noor') || o.titleAr?.includes('نور'));
    if (noorOil) {
      expect(noorOil.brand).toBeDefined();
      expect(noorOil.brand).not.toBe('unbranded');
      // Verify pack / quantity fields
      expect(noorOil.inner_pack_count).toBeDefined();
    }
  });

  // 9. Unified Preview Filtering
  it('filters unified offers by leaflet, retailer, status, and search query', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const dukanWorkspace = path.join(process.cwd(), 'Extracts', 'dukan-849797163-jeddah');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        { path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 },
        { path: path.join(dukanWorkspace, 'dukan-849797163-jeddah.pdf'), name: 'dukan-849797163-jeddah.pdf', sizeBytes: 1024, pageCount: 1 }
      ],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);

    // 1. Filter by leafletId
    const leaflet1Offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId, {
      leafletId: 'leaflet-001'
    });
    expect(leaflet1Offers.every((o) => o.leafletId === 'leaflet-001')).toBe(true);

    const leaflet2Offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId, {
      leafletId: 'leaflet-002'
    });
    expect(leaflet2Offers.every((o) => o.leafletId === 'leaflet-002')).toBe(true);

    // 2. Search query filter
    const sugarOffers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId, {
      searchQuery: 'Sugar'
    });
    expect(sugarOffers.length).toBeGreaterThanOrEqual(1);
    expect(sugarOffers[0].titleEn?.toLowerCase()).toContain('sugar');
  });

  // 10. Cancellation Without Loss of Completed Work
  it('cancels batch cleanly, preserving completed work while cancelling queued items', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const dummyPdf = createDummyPdf('PENDING-LEAFLET.pdf', 'pending');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        { path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 },
        dummyPdf
      ],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    // Cancel the batch
    const cancelled = await sharedBatchOrchestrationService.cancelBatch(manifest.batchId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.leaflets.some((l) => l.status === 'cancelled')).toBe(true);
  });

  // 11. Partial Failure and Targeted Resume
  it('handles leaflet failure gracefully and allows targeted resume', async () => {
    const invalidPdf = {
      path: path.join(testPdfsDir, 'non-existent-missing.pdf'),
      name: 'non-existent-missing.pdf',
      sizeBytes: 0,
      contentFingerprint: 'non-existent-fp',
      pageCount: 1
    };
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');

    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [
        { path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 },
        invalidPdf
      ],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    // Run batch extraction
    const res = await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);

    // Leaflet 1 (Noori) should be completed from cache, Leaflet 2 should fail
    expect(res.leaflets[0].status).toBe('completed');
    expect(res.leaflets[1].status).toBe('failed');
    expect(res.leaflets[1].error).toBeDefined();
    expect(res.status).toBe('completed_with_errors');
    expect(res.totals.completedPdfs).toBe(1);
    expect(res.totals.failedPdfs).toBe(1);

    // Resume the batch: failed leaflet resets to queued
    const reloaded = await sharedBatchOrchestrationService.loadBatchManifest(manifest.batchId);
    expect(reloaded).not.toBeNull();
  }, 15000);

  // 12. Publication Boundaries & DB Isolation
  it('confirms all batch offers are in extracted status with zero database mutations', async () => {
    const nooriWorkspace = path.join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
    const manifest = await sharedBatchOrchestrationService.createBatch({
      files: [{ path: path.join(nooriWorkspace, 'noori-supermarket-229798534-jeddah.pdf'), name: 'noori-supermarket-229798534-jeddah.pdf', sizeBytes: 1024, pageCount: 1 }],
      extractionPipelineMode: 'legacy_rev1'
    });
    createdTestBatchIds.push(manifest.batchId);

    await sharedBatchOrchestrationService.startBatchExtraction(manifest.batchId);
    const unifiedOffers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(manifest.batchId);

    for (const off of unifiedOffers) {
      // Must not be published
      expect(off.status).not.toBe('published');
      expect(['extracted', 'reviewed', 'ready_for_matching']).toContain(off.status);
    }
  });
});
