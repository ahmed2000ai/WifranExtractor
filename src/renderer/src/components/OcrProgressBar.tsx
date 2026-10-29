import React from 'react'

export type OcrProgressProps = {
  stage: string
  message: string
  pagesProcessed?: number
  totalPages?: number
  chunksProcessed?: number
  totalChunks?: number
  chunkId?: string
  waitMs?: number
  waitReason?: string
  estimatedRemainingMs?: number | null
}

function formatDuration(ms: number): string {
  if (ms < 1000) return 'less than a second'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes} min ${remainingSeconds} sec`
}

export const OcrProgressBar: React.FC<OcrProgressProps> = ({
  stage,
  message,
  pagesProcessed,
  totalPages,
  chunksProcessed,
  totalChunks,
  chunkId,
  waitMs,
  estimatedRemainingMs
}) => {
  const isWaiting = stage === 'waiting_for_rate_limit' || waitMs != null
  const isRetrying = stage === 'chunk_retrying'
  const isFailed = stage === 'failed' || stage === 'chunk_failed'
  
  const percentage = totalChunks && totalChunks > 0 && chunksProcessed != null
    ? Math.round((chunksProcessed / totalChunks) * 100)
    : 0

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm space-y-4">
      <div className="flex justify-between items-end">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">OCR Progress</h3>
          {totalPages != null && pagesProcessed != null && (
            <p className="text-xs text-gray-500 mt-1">
              {pagesProcessed} / {totalPages} pages processed
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-gray-900">{percentage}%</span>
          {totalChunks != null && chunksProcessed != null && (
            <p className="text-xs text-gray-500">
              {chunksProcessed} / {totalChunks} chunks
            </p>
          )}
        </div>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div 
          className={`h-2.5 rounded-full transition-all duration-500 ${isFailed ? 'bg-red-600' : isWaiting || isRetrying ? 'bg-amber-500' : 'bg-blue-600'}`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>

      <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded border">
        {chunkId && (
          <div className="mb-1">
            <span className="font-semibold">Current:</span> {chunkId}
          </div>
        )}
        
        <div className={`${isWaiting ? 'text-amber-700 font-medium' : isFailed ? 'text-red-700' : ''}`}>
          {message}
        </div>

        {estimatedRemainingMs != null && estimatedRemainingMs > 0 && !isFailed && stage !== 'completed' && (
          <div className="mt-2 text-xs text-gray-500 flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Estimated remaining time: {formatDuration(estimatedRemainingMs)}
          </div>
        )}
      </div>
    </div>
  )
}
