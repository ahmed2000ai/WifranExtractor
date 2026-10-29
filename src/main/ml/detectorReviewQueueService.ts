import * as path from 'path'
import * as fs from 'fs'
import { CropLayoutReviewQueue, CropLayoutReviewQueueEntry } from '../../shared/types/autoAcceptance'

class DetectorReviewQueueService {
  public updateQueue(manifestDir: string, pageNumber: number, decision: 'auto_accept' | 'recommend_accept' | 'review_required' | 'blocked', qualityScore: number, minConf: number, suggestionCount: number) {
    const queueDir = path.join(manifestDir, 'metadata', 'review-queue')
    if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true })
    const queuePath = path.join(queueDir, 'crop-layout-review-queue.json')

    let queue: CropLayoutReviewQueue = {
      schema_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_pages: 0,
      auto_accepted_pages: 0,
      recommended_accept_pages: 0,
      review_required_pages: 0,
      blocked_pages: 0,
      entries: []
    }

    if (fs.existsSync(queuePath)) {
      try {
        queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'))
      } catch {}
    }

    // Remove existing entry for this page if any
    queue.entries = queue.entries.filter(e => e.page_number !== pageNumber)

    let status: CropLayoutReviewQueueEntry['status'] = 'resolved'
    if (decision === 'recommend_accept') status = 'recommend_accept'
    else if (decision === 'review_required') status = 'review_required'
    else if (decision === 'blocked') status = 'blocked'

    if (status !== 'resolved') {
      let priority: 'critical' | 'high' | 'normal' = 'normal'
      if (status === 'blocked') priority = 'critical'
      else if (qualityScore < 0.5) priority = 'high'

      queue.entries.push({
        page_number: pageNumber,
        status,
        priority,
        reason_codes: [],
        page_quality_score: qualityScore,
        minimum_box_confidence: minConf,
        suggestion_count: suggestionCount,
        resolved_at: null
      })
    }

    // Recompute totals
    queue.total_pages = Math.max(queue.total_pages, pageNumber)
    queue.auto_accepted_pages = 0
    queue.recommended_accept_pages = 0
    queue.review_required_pages = 0
    queue.blocked_pages = 0

    const resolvedPages = queue.total_pages - queue.entries.length
    queue.auto_accepted_pages = resolvedPages // Rough estimation since we don't track all accepted pages in the queue

    for (const e of queue.entries) {
      if (e.status === 'recommend_accept') queue.recommended_accept_pages++
      else if (e.status === 'review_required') queue.review_required_pages++
      else if (e.status === 'blocked') queue.blocked_pages++
    }

    // Sort queue
    queue.entries.sort((a, b) => {
      const pMap = { 'critical': 0, 'high': 1, 'normal': 2 }
      if (pMap[a.priority] !== pMap[b.priority]) return pMap[a.priority] - pMap[b.priority]
      if (a.page_quality_score !== b.page_quality_score) return (a.page_quality_score || 0) - (b.page_quality_score || 0)
      return a.page_number - b.page_number
    })

    queue.updated_at = new Date().toISOString()
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2))
  }

  public getQueue(manifestDir: string): CropLayoutReviewQueue | null {
    const queuePath = path.join(manifestDir, 'metadata', 'review-queue', 'crop-layout-review-queue.json')
    if (fs.existsSync(queuePath)) {
      try {
        return JSON.parse(fs.readFileSync(queuePath, 'utf8'))
      } catch {}
    }
    return null
  }
}

export const detectorReviewQueueService = new DetectorReviewQueueService()
