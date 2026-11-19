/**
 * Matching-Stage Evidence Overlay Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-002A (§5.3)
 *
 * Manages durable, source-linked, operator-reversible evidence annotations
 * at the catalog-matching stage WITHOUT modifying frozen canonical extraction DTOs
 * and WITHOUT exposing private leaflet evidence to the consumer application.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { MatchingEvidenceAnnotation } from '../../shared/types/catalogMatching'

export interface EvidenceOverlayFile {
  version: '1.0'
  scope: string
  updatedAt: string
  annotations: Record<string, MatchingEvidenceAnnotation>
}

export class MatchingEvidenceOverlayService {
  private filePath: string
  private scope: string
  private cache: Map<string, MatchingEvidenceAnnotation> | null = null

  constructor(filePath?: string, scope: string = 'workspace') {
    this.filePath =
      filePath || join(process.cwd(), 'Extracts', 'matching-evidence', 'evidence-annotations.json')
    this.scope = scope
  }

  public static createForBatch(batchId: string): MatchingEvidenceOverlayService {
    const batchOverlayPath = join(
      process.cwd(),
      'Extracts',
      'batches',
      batchId,
      'catalog-matching',
      'evidence-annotations.json'
    )
    return new MatchingEvidenceOverlayService(batchOverlayPath, `batch:${batchId}`)
  }

  private ensureLoaded(): Map<string, MatchingEvidenceAnnotation> {
    if (this.cache) return this.cache
    const map = new Map<string, MatchingEvidenceAnnotation>()

    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw) as EvidenceOverlayFile
        if (parsed && parsed.annotations && typeof parsed.annotations === 'object') {
          for (const [key, ann] of Object.entries(parsed.annotations)) {
            if (ann && ann.source_id) {
              map.set(key, ann)
            }
          }
        }
      } catch (err) {
        console.warn(`[MatchingEvidenceOverlay] Failed to read ${this.filePath}`, err)
      }
    }

    this.cache = map
    return map
  }

  private persist(): void {
    const map = this.ensureLoaded()
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const payload: EvidenceOverlayFile = {
      version: '1.0',
      scope: this.scope,
      updatedAt: new Date().toISOString(),
      annotations: Object.fromEntries(map.entries())
    }
    const tmpPath = `${this.filePath}.tmp.${Date.now()}`
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmpPath, this.filePath)
  }

  public getAnnotationForSource(sourceIds: Array<string | null | undefined>): MatchingEvidenceAnnotation | null {
    const map = this.ensureLoaded()
    for (const id of sourceIds) {
      if (!id) continue
      const hit = map.get(id)
      if (hit) return hit
    }
    return null
  }

  public setAnnotation(annotation: Omit<MatchingEvidenceAnnotation, 'created_at' | 'updated_at'> & {
    created_at?: string
    updated_at?: string
  }): MatchingEvidenceAnnotation {
    const map = this.ensureLoaded()
    const now = new Date().toISOString()
    const existing = map.get(annotation.source_id)
    const full: MatchingEvidenceAnnotation = {
      ...annotation,
      created_at: existing?.created_at || annotation.created_at || now,
      updated_at: now
    }
    map.set(annotation.source_id, full)
    this.persist()
    return full
  }

  public removeAnnotation(sourceId: string): boolean {
    const map = this.ensureLoaded()
    const deleted = map.delete(sourceId)
    if (deleted) {
      this.persist()
    }
    return deleted
  }

  public listAnnotations(): MatchingEvidenceAnnotation[] {
    return Array.from(this.ensureLoaded().values())
  }

  public reload(): void {
    this.cache = null
  }
}

