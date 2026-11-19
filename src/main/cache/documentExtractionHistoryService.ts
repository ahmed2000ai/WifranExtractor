/**
 * Persistent Cross-Batch Document & Page Extraction History Registry
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (ID-01..03, DUP-01A..G)
 *
 * Indexes extracted leaflets by canonical document ID (`doc_<sha256_prefix>`) and PDF SHA-256
 * across workspaces, filenames, and batches. Validates artifact compatibility & integrity
 * before permitting page-level reuse, and recomputes pre-extraction API cost estimates.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  CURRENT_HYBRID_COMPATIBILITY_PROFILE,
  type PreExtractionCompatibilityProfile,
  computeDocumentIdFromFingerprint,
  isArtifactProfileCompatible,
  normalizeFileNameForDuplicateCheck
} from '../../shared/utils/sourceIdentityAndDuplicateUtils'
import {
  estimateBatchApiCost,
  type BatchApiCostEstimate
} from '../../shared/utils/geminiPricingAndCostEstimator'
import type { ExtractionPipelineMode, LeafletMetadataScope } from '../../shared/types/batchExtraction'

export interface IndexedPageArtifactRecord {
  documentId: string
  fileFingerprint: string
  fileName: string
  normalizedStem: string
  workspacePath: string
  batchId?: string | null
  leafletId?: string | null
  pageNumber: number
  pageContentSha256?: string | null
  pagePerceptualHash?: string | null
  compatibilityProfile: PreExtractionCompatibilityProfile
  resultJsonPath: string
  stagedDraftPath: string
  cropPaths: string[]
  supermarketId?: string | null
  offerStartDate?: string | null
  offerEndDate?: string | null
  locationScope?: string | null
  offersCount: number
  quarantinedCount: number
  corrupted?: boolean
  extractedAt: string
}

export interface DocumentHistoryIndexFile {
  schemaVersion: 'wifran.doc_history/1.0'
  updatedAt: string
  pages: Record<string, IndexedPageArtifactRecord>
}

export interface DuplicateCandidateFileInput {
  path: string
  name?: string
  contentFingerprint?: string
  pageCount?: number
  pagesToProcess?: number[]
  metadata?: Partial<LeafletMetadataScope>
}

export interface PerFileDuplicateInspection {
  filePath: string
  fileName: string
  fileFingerprint: string | null
  documentId: string
  targetPages: number[]
  reusablePages: number[]
  payablePages: number[]
  classification:
    | 'exact_duplicate_full_reuse'
    | 'partial_page_overlap_reuse'
    | 'within_batch_binary_duplicate'
    | 'filename_collision_different_content'
    | 'incompatible_or_corrupted_history'
    | 'new_document'
  matchedPriorFileName?: string | null
  matchedPriorWorkspace?: string | null
  incompatibilityReasons: string[]
  reusableArtifactsByPage: Record<number, IndexedPageArtifactRecord>
}

export interface PreExtractionDuplicateInspectionResult {
  forceReextract: boolean
  totalSelectedFiles: number
  totalSelectedPages: number
  totalReusablePages: number
  totalPayablePages: number
  hasDuplicatesOrOverlaps: boolean
  withinBatchBinaryDuplicates: Array<{ fileName: string; duplicateOfFileName: string; fingerprint: string }>
  withinBatchFilenameCollisions: Array<{ fileName: string; collidingWithFileName: string }>
  perFile: PerFileDuplicateInspection[]
  originalCostEstimate: BatchApiCostEstimate
  adjustedCostEstimate: BatchApiCostEstimate
  summaryMessage: string
}

export interface HistoricalBackfillPageReport {
  workspacePath: string
  batchId?: string | null
  leafletId?: string | null
  pageNumber: number | null
  status:
    | 'indexed'
    | 'already_indexed'
    | 'skipped_incompatible'
    | 'skipped_incomplete_or_corrupted'
    | 'skipped_missing_fingerprint'
  reason: string
  documentId?: string
  fileName?: string
  fileFingerprint?: string
}

export interface HistoricalBackfillSummary {
  indexFilePath: string
  scannedWorkspaces: number
  scannedBatches: number
  indexedPagesCount: number
  skippedAlreadyIndexedCount: number
  skippedIncompatibleCount: number
  skippedIncompleteOrCorruptedCount: number
  prunedStaleEntriesCount: number
  recoveredDocumentIds: string[]
  pageReports: HistoricalBackfillPageReport[]
}

export class DocumentExtractionHistoryService {
  private readonly indexFilePath: string
  private readonly autoBackfill: boolean
  private hasBackfilled = false

  constructor(options?: { baseDir?: string; indexFilePath?: string; autoBackfill?: boolean }) {
    this.autoBackfill = options?.autoBackfill ?? true
    if (options?.indexFilePath) {
      this.indexFilePath = options.indexFilePath
    } else {
      const workspaceFolder = process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat' : 'Extracts'
      const baseDir = options?.baseDir || path.join(process.cwd(), workspaceFolder)
      this.indexFilePath = path.join(baseDir, '.wifran-document-history.json')
    }
  }

  public getIndexFilePath(): string {
    return this.indexFilePath
  }

  public static computePdfSha256(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null
      const buf = fs.readFileSync(filePath)
      return crypto.createHash('sha256').update(buf).digest('hex')
    } catch {
      return null
    }
  }

  private loadIndex(): DocumentHistoryIndexFile {
    try {
      if (!fs.existsSync(this.indexFilePath)) {
        return {
          schemaVersion: 'wifran.doc_history/1.0',
          updatedAt: new Date().toISOString(),
          pages: {}
        }
      }
      const parsed = JSON.parse(fs.readFileSync(this.indexFilePath, 'utf8'))
      if (parsed && typeof parsed.pages === 'object' && parsed.pages !== null) {
        return parsed as DocumentHistoryIndexFile
      }
    } catch {
      // Return fresh empty index if damaged; never silently corrupt caller flow
    }
    return {
      schemaVersion: 'wifran.doc_history/1.0',
      updatedAt: new Date().toISOString(),
      pages: {}
    }
  }

  private saveIndexAtomic(index: DocumentHistoryIndexFile): void {
    const dir = path.dirname(this.indexFilePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    index.updatedAt = new Date().toISOString()
    const tmpPath = `${this.indexFilePath}.tmp.${process.pid}`
    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf8')
    fs.renameSync(tmpPath, this.indexFilePath)
  }

  private buildPageRecordKey(documentId: string, pageNumber: number, compatibilityProfile?: PreExtractionCompatibilityProfile): string {
    const profile = compatibilityProfile || CURRENT_HYBRID_COMPATIBILITY_PROFILE
    return `${documentId}:p${String(pageNumber).padStart(3, '0')}:${profile.pipelineMode}:${profile.modelId}`
  }

  public recordExtractedPage(record: Omit<IndexedPageArtifactRecord, 'documentId' | 'normalizedStem'> & {
    documentId?: string
  }): IndexedPageArtifactRecord {
    const documentId =
      record.documentId || computeDocumentIdFromFingerprint(record.fileFingerprint, record.fileName)
    const { normalizedStem } = normalizeFileNameForDuplicateCheck(record.fileName)
    const fullRecord: IndexedPageArtifactRecord = {
      ...record,
      documentId,
      normalizedStem
    }
    const index = this.loadIndex()
    const key = this.buildPageRecordKey(documentId, record.pageNumber, record.compatibilityProfile)
    index.pages[key] = fullRecord
    this.saveIndexAtomic(index)
    return fullRecord
  }

  public getReusablePagesForDocument(params: {
    fileFingerprint: string
    fileName?: string
    targetPages: number[]
    expectedProfile?: PreExtractionCompatibilityProfile
    expectedMetadata?: Partial<LeafletMetadataScope>
  }): {
    reusableByPage: Record<number, IndexedPageArtifactRecord>
    incompatibilityReasons: string[]
    matchedPriorFileName: string | null
    matchedPriorWorkspace: string | null
  } {
    this.ensureBackfilled()
    const index = this.loadIndex()
    const documentId = computeDocumentIdFromFingerprint(params.fileFingerprint, params.fileName)
    const expectedProfile = params.expectedProfile || CURRENT_HYBRID_COMPATIBILITY_PROFILE
    const reusableByPage: Record<number, IndexedPageArtifactRecord> = {}
    const reasonsSet = new Set<string>()
    let matchedPriorFileName: string | null = null
    let matchedPriorWorkspace: string | null = null

    const targetPageSet = new Set(params.targetPages)
    const allMatchingDocEntries = Object.values(index.pages).filter(
      (rec) =>
        (rec.documentId === documentId || rec.fileFingerprint === params.fileFingerprint) &&
        targetPageSet.has(rec.pageNumber)
    )

    for (const rec of allMatchingDocEntries) {
      matchedPriorFileName = matchedPriorFileName || rec.fileName
      matchedPriorWorkspace = matchedPriorWorkspace || rec.workspacePath

      if (rec.corrupted) {
        reasonsSet.add(`Page ${rec.pageNumber}: historical extraction flagged corrupted.`)
        continue
      }

      const compat = isArtifactProfileCompatible(rec.compatibilityProfile, expectedProfile)
      if (!compat.compatible) {
        for (const r of compat.reasons) reasonsSet.add(`Page ${rec.pageNumber}: ${r}`)
        continue
      }

      if (
        params.expectedMetadata?.supermarketId &&
        rec.supermarketId &&
        params.expectedMetadata.supermarketId !== rec.supermarketId
      ) {
        reasonsSet.add(
          `Page ${rec.pageNumber}: retailer context mismatch (${rec.supermarketId} vs ${params.expectedMetadata.supermarketId}).`
        )
        continue
      }

      // Verify actual on-disk artifacts exist and parse cleanly
      if (!rec.resultJsonPath || !fs.existsSync(rec.resultJsonPath)) {
        reasonsSet.add(`Page ${rec.pageNumber}: cached result artifact missing on disk.`)
        continue
      }
      if (!rec.stagedDraftPath || !fs.existsSync(rec.stagedDraftPath)) {
        reasonsSet.add(`Page ${rec.pageNumber}: staged draft missing on disk.`)
        continue
      }
      try {
        const parsedResult = JSON.parse(fs.readFileSync(rec.resultJsonPath, 'utf8'))
        if (!parsedResult?.pageResult?.ok) {
          reasonsSet.add(`Page ${rec.pageNumber}: historical page result did not complete cleanly.`)
          continue
        }
      } catch {
        reasonsSet.add(`Page ${rec.pageNumber}: cached result JSON is unreadable/corrupt.`)
        continue
      }

      try {
        const parsedDraft = JSON.parse(fs.readFileSync(rec.stagedDraftPath, 'utf8'))
        if (!parsedDraft || typeof parsedDraft !== 'object') {
          reasonsSet.add(`Page ${rec.pageNumber}: staged draft JSON is invalid.`)
          continue
        }
        if (Array.isArray(parsedDraft.items)) {
          const matchingItems = parsedDraft.items.filter((it: any) => (it?.pageNumber || 1) === rec.pageNumber)
          if (matchingItems.length === 0) {
            reasonsSet.add(`Page ${rec.pageNumber}: staged draft has no extracted items for this page.`)
            continue
          }
        }
      } catch {
        reasonsSet.add(`Page ${rec.pageNumber}: staged draft JSON is unreadable/corrupt.`)
        continue
      }

      if (Array.isArray(rec.cropPaths) && rec.cropPaths.length > 0) {
        const missingOrEmptyCrop = rec.cropPaths.find((cp) => {
          try {
            return !cp || !fs.existsSync(cp) || fs.statSync(cp).size <= 0
          } catch {
            return true
          }
        })
        if (missingOrEmptyCrop) {
          reasonsSet.add(`Page ${rec.pageNumber}: cached crop image is missing or empty on disk.`)
          continue
        }
      }

      reusableByPage[rec.pageNumber] = rec
    }

    return {
      reusableByPage,
      incompatibilityReasons: Array.from(reasonsSet),
      matchedPriorFileName,
      matchedPriorWorkspace
    }
  }

  public findFilenameHistoryMatches(fileName: string, excludeFingerprint?: string | null): IndexedPageArtifactRecord[] {
    const { exactBaseLower, normalizedStem } = normalizeFileNameForDuplicateCheck(fileName)
    const index = this.loadIndex()
    return Object.values(index.pages).filter((rec) => {
      if (excludeFingerprint && rec.fileFingerprint === excludeFingerprint) return false
      const recNorm = normalizeFileNameForDuplicateCheck(rec.fileName)
      return recNorm.exactBaseLower === exactBaseLower || (normalizedStem.length > 0 && recNorm.normalizedStem === normalizedStem)
    })
  }

  public inspectPreExtractionDuplicates(params: {
    files: DuplicateCandidateFileInput[]
    extractionPipelineMode?: ExtractionPipelineMode
    modelId?: string
    tier?: 'flex' | 'standard'
    forceReextract?: boolean
  }): PreExtractionDuplicateInspectionResult {
    this.ensureBackfilled()
    const pipelineMode: ExtractionPipelineMode = params.extractionPipelineMode || 'hybrid_v3'
    const modelId = params.modelId || CURRENT_HYBRID_COMPATIBILITY_PROFILE.modelId
    const tier = params.tier || 'flex'
    const forceReextract = Boolean(params.forceReextract)
    const expectedProfile: PreExtractionCompatibilityProfile = {
      ...CURRENT_HYBRID_COMPATIBILITY_PROFILE,
      pipelineMode,
      modelId
    }

    const seenFingerprints = new Map<string, string>()
    const seenFileNames = new Map<string, string>()
    const withinBatchBinaryDuplicates: PreExtractionDuplicateInspectionResult['withinBatchBinaryDuplicates'] = []
    const withinBatchFilenameCollisions: PreExtractionDuplicateInspectionResult['withinBatchFilenameCollisions'] = []
    const perFile: PerFileDuplicateInspection[] = []

    let totalSelectedPages = 0
    let totalReusablePages = 0
    let totalPayablePages = 0

    for (const f of params.files) {
      const baseName = f.name || path.basename(f.path)
      const normName = normalizeFileNameForDuplicateCheck(baseName)
      const fp = f.contentFingerprint || DocumentExtractionHistoryService.computePdfSha256(f.path)
      const documentId = computeDocumentIdFromFingerprint(fp, baseName)
      const targetPages =
        Array.isArray(f.pagesToProcess) && f.pagesToProcess.length > 0
          ? Array.from(new Set(f.pagesToProcess)).sort((a, b) => a - b)
          : Array.from({ length: Math.max(1, f.pageCount || 1) }, (_, idx) => idx + 1)

      totalSelectedPages += targetPages.length

      // Within-batch filename collision check (DUP-01A)
      if (seenFileNames.has(normName.exactBaseLower)) {
        withinBatchFilenameCollisions.push({
          fileName: baseName,
          collidingWithFileName: seenFileNames.get(normName.exactBaseLower)!
        })
      } else {
        seenFileNames.set(normName.exactBaseLower, baseName)
      }

      // Within-batch binary SHA-256 duplicate check (DUP-01B)
      if (fp && seenFingerprints.has(fp)) {
        withinBatchBinaryDuplicates.push({
          fileName: baseName,
          duplicateOfFileName: seenFingerprints.get(fp)!,
          fingerprint: fp
        })
        perFile.push({
          filePath: f.path,
          fileName: baseName,
          fileFingerprint: fp,
          documentId,
          targetPages,
          reusablePages: [],
          payablePages: [],
          classification: 'within_batch_binary_duplicate',
          matchedPriorFileName: seenFingerprints.get(fp)!,
          matchedPriorWorkspace: null,
          incompatibilityReasons: [],
          reusableArtifactsByPage: {}
        })
        continue
      }
      if (fp) {
        seenFingerprints.set(fp, baseName)
      }

      if (forceReextract || !fp) {
        const sameNameMatches = this.findFilenameHistoryMatches(baseName, fp)
        totalPayablePages += targetPages.length
        perFile.push({
          filePath: f.path,
          fileName: baseName,
          fileFingerprint: fp,
          documentId,
          targetPages,
          reusablePages: [],
          payablePages: [...targetPages],
          classification:
            sameNameMatches.length > 0 ? 'filename_collision_different_content' : 'new_document',
          matchedPriorFileName: sameNameMatches[0]?.fileName || null,
          matchedPriorWorkspace: sameNameMatches[0]?.workspacePath || null,
          incompatibilityReasons: forceReextract ? ['Operator selected Force Re-extraction.'] : [],
          reusableArtifactsByPage: {}
        })
        continue
      }

      const historyCheck = this.getReusablePagesForDocument({
        fileFingerprint: fp,
        fileName: baseName,
        targetPages,
        expectedProfile,
        expectedMetadata: f.metadata
      })
      const reusablePages = targetPages.filter((p) => Boolean(historyCheck.reusableByPage[p]))
      const payablePages = targetPages.filter((p) => !historyCheck.reusableByPage[p])

      totalReusablePages += reusablePages.length
      totalPayablePages += payablePages.length

      let classification: PerFileDuplicateInspection['classification'] = 'new_document'
      let matchedPriorFileName = historyCheck.matchedPriorFileName
      let matchedPriorWorkspace = historyCheck.matchedPriorWorkspace

      if (reusablePages.length === targetPages.length && targetPages.length > 0) {
        classification = 'exact_duplicate_full_reuse'
      } else if (reusablePages.length > 0) {
        classification = 'partial_page_overlap_reuse'
      } else if (historyCheck.incompatibilityReasons.length > 0) {
        classification = 'incompatible_or_corrupted_history'
      } else {
        const sameNameDiffContent = this.findFilenameHistoryMatches(baseName, fp)
        if (sameNameDiffContent.length > 0) {
          classification = 'filename_collision_different_content'
          matchedPriorFileName = sameNameDiffContent[0].fileName
          matchedPriorWorkspace = sameNameDiffContent[0].workspacePath
        }
      }

      perFile.push({
        filePath: f.path,
        fileName: baseName,
        fileFingerprint: fp,
        documentId,
        targetPages,
        reusablePages,
        payablePages,
        classification,
        matchedPriorFileName,
        matchedPriorWorkspace,
        incompatibilityReasons: historyCheck.incompatibilityReasons,
        reusableArtifactsByPage: historyCheck.reusableByPage
      })
    }

    const originalCostEstimate = estimateBatchApiCost({
      targetPageCount: totalSelectedPages,
      extractionPipelineMode: pipelineMode,
      modelId,
      tier
    })
    const adjustedCostEstimate = estimateBatchApiCost({
      targetPageCount: totalPayablePages,
      extractionPipelineMode: pipelineMode,
      modelId,
      tier
    })

    const hasDuplicatesOrOverlaps =
      withinBatchBinaryDuplicates.length > 0 ||
      withinBatchFilenameCollisions.length > 0 ||
      totalReusablePages > 0 ||
      perFile.some(
        (p) =>
          p.classification === 'filename_collision_different_content' ||
          p.classification === 'incompatible_or_corrupted_history'
      )

    const summaryParts: string[] = []
    if (totalReusablePages > 0) {
      summaryParts.push(
        `${totalReusablePages} of ${totalSelectedPages} selected page(s) have validated prior extractions and will be reused at $0.00; ${totalPayablePages} page(s) require extraction.`
      )
    }
    if (withinBatchBinaryDuplicates.length > 0) {
      summaryParts.push(`${withinBatchBinaryDuplicates.length} identical duplicate PDF(s) deduplicated within selection.`)
    }
    if (
      perFile.some((p) => p.classification === 'filename_collision_different_content')
    ) {
      summaryParts.push('Filename matches prior leaflet with different PDF bytes; treated as a distinct document version.')
    }

    return {
      forceReextract,
      totalSelectedFiles: params.files.length,
      totalSelectedPages,
      totalReusablePages,
      totalPayablePages,
      hasDuplicatesOrOverlaps,
      withinBatchBinaryDuplicates,
      withinBatchFilenameCollisions,
      perFile,
      originalCostEstimate,
      adjustedCostEstimate,
      summaryMessage: summaryParts.join(' ') || 'No duplicate leaflets or overlapping extracted pages found.'
    }
  }

  private ensureBackfilled(): void {
    if (this.hasBackfilled || !this.autoBackfill) return
    this.hasBackfilled = true
    const extractsDir = path.dirname(this.indexFilePath)
    if (!fs.existsSync(extractsDir)) return
    try {
      this.backfillHistoricalExtractions({ extractsDir })
    } catch {
      // Non-fatal discovery safeguard
    }
  }

  /**
   * Non-destructive discovery & backfill of previously completed extraction workspaces and batches.
   * Matches documents exclusively by verified PDF SHA-256, checks pipeline/model compatibility,
   * verifies page result JSON, staged-draft.json items, and crop image integrity on disk,
   * deduplicates repeat runs, and prunes stale nonexistent test/temp index entries.
   */
  public backfillHistoricalExtractions(options?: {
    extractsDir?: string
    pdfSearchDirs?: string[]
    pruneStaleMissingEntries?: boolean
  }): HistoricalBackfillSummary {
    const extractsDir = options?.extractsDir || path.dirname(this.indexFilePath)
    const defaultWorkspaceExtractsDir = path.resolve(process.cwd(), 'Extracts')
    const pruneStale = options?.pruneStaleMissingEntries !== false
    const pdfSearchDirs =
      options?.pdfSearchDirs ??
      (path.resolve(extractsDir) === defaultWorkspaceExtractsDir
        ? [path.join(process.cwd(), 'Leaflets')]
        : [])

    const index = this.loadIndex()
    let prunedStaleEntriesCount = 0

    if (pruneStale) {
      for (const [key, rec] of Object.entries(index.pages)) {
        const missingResult = !rec.resultJsonPath || !fs.existsSync(rec.resultJsonPath)
        const missingDraft = !rec.stagedDraftPath || !fs.existsSync(rec.stagedDraftPath)
        const missingCrop =
          Array.isArray(rec.cropPaths) &&
          rec.cropPaths.some((cp) => {
            try {
              return !cp || !fs.existsSync(cp) || fs.statSync(cp).size <= 0
            } catch {
              return true
            }
          })
        if (missingResult || missingDraft || missingCrop) {
          delete index.pages[key]
          prunedStaleEntriesCount++
        }
      }
    }

    const pdfShaByPath = new Map<string, string>()
    const getCachedPdfSha = (pdfPath?: string | null): string | null => {
      if (!pdfPath) return null
      const norm = path.resolve(pdfPath)
      if (pdfShaByPath.has(norm)) return pdfShaByPath.get(norm)!
      const sha = DocumentExtractionHistoryService.computePdfSha256(norm)
      if (sha) pdfShaByPath.set(norm, sha)
      return sha
    }

    let pdfPathBySha: Map<string, string> | null = null
    const lookupPdfPathBySha = (shaQuery: string): string | null => {
      if (pdfPathBySha === null) {
        pdfPathBySha = new Map<string, string>()
        for (const dir of pdfSearchDirs) {
          if (!dir || !fs.existsSync(dir)) continue
          try {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              if (ent.isFile() && /\.pdf$/i.test(ent.name)) {
                const fullPath = path.join(dir, ent.name)
                const sha = getCachedPdfSha(fullPath)
                if (sha && !pdfPathBySha.has(sha)) {
                  pdfPathBySha.set(sha, fullPath)
                }
              }
            }
          } catch {
            // Ignore unreadable search directory
          }
        }
      }
      return pdfPathBySha.get(shaQuery) ?? null
    }

    interface CandidateWorkspace {
      workspacePath: string
      batchId: string | null
      leafletId: string | null
      fileName: string | null
      filePath: string | null
      fileFingerprint: string | null
      pipelineMode?: ExtractionPipelineMode
      modelId?: string
      supermarketId?: string | null
      offerStartDate?: string | null
      offerEndDate?: string | null
      locationScope?: string | null
    }

    const workspaceMap = new Map<string, CandidateWorkspace>()
    let scannedBatches = 0

    // 1. Collect workspaces referenced by batch manifests (sorted newest last so newer batch metadata wins)
    const batchesDir = path.join(extractsDir, 'batches')
    if (fs.existsSync(batchesDir)) {
      const batchEntries = fs
        .readdirSync(batchesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))

      for (const batchEnt of batchEntries) {
        const manifestPath = path.join(batchesDir, batchEnt.name, 'batch-manifest.json')
        if (!fs.existsSync(manifestPath)) continue
        scannedBatches++
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          const leaflets = Array.isArray(manifest?.leaflets) ? manifest.leaflets : []
          for (const l of leaflets) {
            if (!l?.workspacePath) continue
            const wsNorm = path.resolve(l.workspacePath)
            workspaceMap.set(wsNorm, {
              workspacePath: l.workspacePath,
              batchId: manifest.batchId || batchEnt.name,
              leafletId: l.leafletId || null,
              fileName: l.fileName || (l.filePath ? path.basename(l.filePath) : null),
              filePath: l.filePath || null,
              fileFingerprint: l.fileFingerprint || null,
              pipelineMode: manifest.extractionPipelineMode,
              modelId: manifest.model,
              supermarketId: l.metadata?.supermarketId ?? null,
              offerStartDate: l.metadata?.offerStartDate ?? null,
              offerEndDate: l.metadata?.offerEndDate ?? null,
              locationScope: l.metadata?.locationScope ?? null
            })
          }
        } catch {
          // Malformed batch manifest does not halt backfill of other folders
        }
      }
    }

    // 2. Collect top-level workspaces directly under extractsDir
    if (fs.existsSync(extractsDir)) {
      for (const ent of fs.readdirSync(extractsDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        if (ent.name === 'batches' || ent.name === 'batch-logs' || ent.name.startsWith('.')) continue
        const wsPath = path.join(extractsDir, ent.name)
        const wsNorm = path.resolve(wsPath)
        if (!workspaceMap.has(wsNorm)) {
          workspaceMap.set(wsNorm, {
            workspacePath: wsPath,
            batchId: null,
            leafletId: null,
            fileName: null,
            filePath: null,
            fileFingerprint: null
          })
        }
      }
    }

    const pageReports: HistoricalBackfillPageReport[] = []
    const recoveredDocs = new Set<string>()
    let indexedPagesCount = 0
    let skippedAlreadyIndexedCount = 0
    let skippedIncompatibleCount = 0
    let skippedIncompleteOrCorruptedCount = 0
    let scannedWorkspaces = 0

    const isValidSha256 = (val?: string | null): val is string =>
      Boolean(val && /^[a-f0-9]{64}$/i.test(val.trim()))

    const hasExistingValidRecord = (key: string, sha: string, pageNum: number): boolean => {
      const existing = index.pages[key]
      if (!existing || existing.corrupted || existing.fileFingerprint !== sha) return false
      if (!existing.resultJsonPath || !fs.existsSync(existing.resultJsonPath)) return false
      if (!existing.stagedDraftPath || !fs.existsSync(existing.stagedDraftPath)) return false
      try {
        const res = JSON.parse(fs.readFileSync(existing.resultJsonPath, 'utf8'))
        if (!res?.pageResult?.ok) return false
        const dr = JSON.parse(fs.readFileSync(existing.stagedDraftPath, 'utf8'))
        if (Array.isArray(dr?.items) && !dr.items.some((it: any) => (it?.pageNumber || 1) === pageNum)) {
          return false
        }
      } catch {
        return false
      }
      if (
        Array.isArray(existing.cropPaths) &&
        existing.cropPaths.some((cp) => !cp || !fs.existsSync(cp) || fs.statSync(cp).size <= 0)
      ) {
        return false
      }
      return true
    }

    for (const candidate of workspaceMap.values()) {
      const wsPath = candidate.workspacePath
      if (!fs.existsSync(wsPath)) {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incomplete_or_corrupted',
          reason: 'Workspace directory referenced by manifest does not exist on disk.'
        })
        continue
      }

      scannedWorkspaces++
      const stagedDraftPath = path.join(wsPath, 'staged-draft.json')
      const resultsDir = path.join(wsPath, 'hybrid_v3_results')
      const wsManifestPath = path.join(wsPath, 'manifest.json')

      let parsedWsManifest: any = null
      if (fs.existsSync(wsManifestPath)) {
        try {
          parsedWsManifest = JSON.parse(fs.readFileSync(wsManifestPath, 'utf8'))
        } catch {
          parsedWsManifest = null
        }
      }

      if (!fs.existsSync(stagedDraftPath)) {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incomplete_or_corrupted',
          reason: 'staged-draft.json is missing; extraction incomplete or unrecoverable.'
        })
        continue
      }

      let parsedDraft: any
      try {
        parsedDraft = JSON.parse(fs.readFileSync(stagedDraftPath, 'utf8'))
      } catch {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incomplete_or_corrupted',
          reason: 'staged-draft.json is unreadable or corrupt JSON.'
        })
        continue
      }

      const draftItems: any[] = Array.isArray(parsedDraft?.items) ? parsedDraft.items : []
      if (draftItems.length === 0) {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incomplete_or_corrupted',
          reason: 'staged-draft.json contains 0 extracted items.'
        })
        continue
      }

      if (!fs.existsSync(resultsDir)) {
        // Legacy Rev1 or interrupted workspace without Hybrid V3 page results
        const hasLegacyArtifacts = fs.existsSync(path.join(wsPath, 'json')) || parsedWsManifest !== null
        if (hasLegacyArtifacts) {
          skippedIncompatibleCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber: null,
            status: 'skipped_incompatible',
            reason: 'Legacy extraction artifacts lack hybrid_v3_results/page_*.v3.json; requires Hybrid V3 processing.'
          })
        } else {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber: null,
            status: 'skipped_incomplete_or_corrupted',
            reason: 'Missing hybrid_v3_results directory.'
          })
        }
        continue
      }

      // Establish SHA-256 exclusively from cryptographic fingerprint or real PDF bytes (never filename)
      const recordedSha =
        [
          candidate.fileFingerprint,
          parsedDraft?.leafletHash,
          parsedWsManifest?.processing_selection?.pdfFingerprint
        ].find((v) => isValidSha256(v))?.toLowerCase() || null

      const candidatePdfPaths = [
        candidate.filePath,
        parsedDraft?.sourcePdfPath,
        path.join(wsPath, 'original.pdf')
      ].filter((p): p is string => Boolean(p))

      let verifiedDiskSha: string | null = null
      let matchedPdfPath: string | null = null
      let shaMismatchReason: string | null = null

      for (const pdfP of candidatePdfPaths) {
        const diskSha = getCachedPdfSha(pdfP)
        if (!diskSha) continue
        if (recordedSha && diskSha.toLowerCase() !== recordedSha) {
          shaMismatchReason = `PDF SHA-256 mismatch: disk PDF (${diskSha.slice(0, 12)}) does not match recorded leafletHash (${recordedSha.slice(0, 12)}).`
          break
        }
        verifiedDiskSha = diskSha.toLowerCase()
        matchedPdfPath = pdfP
        break
      }

      if (shaMismatchReason) {
        skippedIncompatibleCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incompatible',
          reason: shaMismatchReason
        })
        continue
      }

      const resolvedSha = (verifiedDiskSha || recordedSha || '').toLowerCase()
      if (!isValidSha256(resolvedSha)) {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_missing_fingerprint',
          reason: 'Cannot verify PDF SHA-256 fingerprint (no valid leafletHash and no accessible source PDF).'
        })
        continue
      }

      // Check pdfSearchDirs lazily in case PDF was moved/renamed
      if (!matchedPdfPath) {
        matchedPdfPath = lookupPdfPathBySha(resolvedSha)
      }

      const resolvedFileName =
        candidate.fileName ||
        parsedWsManifest?.pdf_file_name ||
        (matchedPdfPath ? path.basename(matchedPdfPath) : path.basename(wsPath) + '.pdf')

      const v3Files = fs
        .readdirSync(resultsDir)
        .filter((f) => /^page_(\d+)\.v3\.json$/i.test(f))
        .sort((a, b) => a.localeCompare(b))

      if (v3Files.length === 0) {
        skippedIncompleteOrCorruptedCount++
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber: null,
          status: 'skipped_incomplete_or_corrupted',
          reason: 'hybrid_v3_results/ contains no page_*.v3.json files.'
        })
        continue
      }

      for (const file of v3Files) {
        const match = /^page_(\d+)\.v3\.json$/i.exec(file)
        if (!match) continue
        const pageNumber = Number(match[1])
        const resultJsonPath = path.join(resultsDir, file)

        let parsedResult: any
        try {
          parsedResult = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'))
        } catch {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incomplete_or_corrupted',
            reason: `Page ${pageNumber} result JSON is corrupt or unreadable.`
          })
          continue
        }

        if (!parsedResult?.pageResult?.ok) {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incomplete_or_corrupted',
            reason: `Page ${pageNumber} Hybrid V3 result is incomplete (ok !== true).`
          })
          continue
        }

        const pageItems = draftItems.filter((it) => (it?.pageNumber || 1) === pageNumber)
        if (pageItems.length === 0) {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incomplete_or_corrupted',
            reason: `staged-draft.json has no extracted items mapped to page ${pageNumber}.`
          })
          continue
        }

        // Verify crop artifact integrity on disk
        const cropPaths = Array.from(
          new Set(
            pageItems
              .flatMap((it) => [
                it.croppedEvidenceLocalPath || it.offerCardCropPath,
                it.productThumbLocalPath || it.productThumbCropPath
              ])
              .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          )
        )

        if (cropPaths.length === 0) {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incomplete_or_corrupted',
            reason: `Page ${pageNumber} has no crop artifact paths recorded in staged-draft.json.`
          })
          continue
        }

        const brokenCrop = cropPaths.find((cp) => {
          try {
            return !fs.existsSync(cp) || fs.statSync(cp).size <= 0
          } catch {
            return true
          }
        })
        if (brokenCrop) {
          skippedIncompleteOrCorruptedCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incomplete_or_corrupted',
            reason: `Missing or empty crop artifact on disk (${path.basename(brokenCrop)}).`
          })
          continue
        }

        const profile: PreExtractionCompatibilityProfile = {
          ...CURRENT_HYBRID_COMPATIBILITY_PROFILE,
          pipelineMode: candidate.pipelineMode || 'hybrid_v3',
          modelId:
            parsedResult?.pageResult?.modelId ||
            candidate.modelId ||
            CURRENT_HYBRID_COMPATIBILITY_PROFILE.modelId
        }
        const compat = isArtifactProfileCompatible(profile, CURRENT_HYBRID_COMPATIBILITY_PROFILE)
        if (!compat.compatible) {
          skippedIncompatibleCount++
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'skipped_incompatible',
            reason: compat.reasons.join(' '),
            fileName: resolvedFileName,
            fileFingerprint: resolvedSha
          })
          continue
        }

        const documentId = computeDocumentIdFromFingerprint(resolvedSha, resolvedFileName)
        const key = this.buildPageRecordKey(documentId, pageNumber, profile)

        if (hasExistingValidRecord(key, resolvedSha, pageNumber)) {
          skippedAlreadyIndexedCount++
          recoveredDocs.add(documentId)
          pageReports.push({
            workspacePath: wsPath,
            batchId: candidate.batchId,
            leafletId: candidate.leafletId,
            pageNumber,
            status: 'already_indexed',
            reason: 'Already indexed with verified intact artifacts.',
            documentId,
            fileName: resolvedFileName,
            fileFingerprint: resolvedSha
          })
          continue
        }

        const stat = fs.statSync(resultJsonPath)
        const extractedAt =
          parsedResult?.pageResult?.completedAt ||
          parsedWsManifest?.updated_at ||
          stat.mtime.toISOString()

        const { normalizedStem } = normalizeFileNameForDuplicateCheck(resolvedFileName)
        index.pages[key] = {
          documentId,
          fileFingerprint: resolvedSha,
          fileName: resolvedFileName,
          normalizedStem,
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId || parsedResult?.pageResult?.leafletId || null,
          pageNumber,
          compatibilityProfile: profile,
          resultJsonPath,
          stagedDraftPath,
          cropPaths,
          supermarketId: candidate.supermarketId ?? parsedDraft?.header?.supermarketId ?? null,
          offerStartDate: candidate.offerStartDate ?? parsedDraft?.header?.validFrom ?? null,
          offerEndDate: candidate.offerEndDate ?? parsedDraft?.header?.validTo ?? null,
          locationScope: candidate.locationScope ?? parsedDraft?.header?.locationScope ?? null,
          offersCount: pageItems.length,
          quarantinedCount: pageItems.filter(
            (it) => Array.isArray(it?.quarantineReasons) && it.quarantineReasons.length > 0
          ).length,
          corrupted: false,
          extractedAt
        }
        indexedPagesCount++
        recoveredDocs.add(documentId)
        pageReports.push({
          workspacePath: wsPath,
          batchId: candidate.batchId,
          leafletId: candidate.leafletId,
          pageNumber,
          status: 'indexed',
          reason: 'Discovered and indexed verified Hybrid V3 page extraction cleanly.',
          documentId,
          fileName: resolvedFileName,
          fileFingerprint: resolvedSha
        })
      }
    }

    if (indexedPagesCount > 0 || prunedStaleEntriesCount > 0) {
      this.saveIndexAtomic(index)
    }

    return {
      indexFilePath: this.indexFilePath,
      scannedWorkspaces,
      scannedBatches,
      indexedPagesCount,
      skippedAlreadyIndexedCount,
      skippedIncompatibleCount,
      skippedIncompleteOrCorruptedCount,
      prunedStaleEntriesCount,
      recoveredDocumentIds: Array.from(recoveredDocs),
      pageReports
    }
  }
}

export const sharedDocumentExtractionHistoryService = new DocumentExtractionHistoryService()
