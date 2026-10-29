import React from 'react'
import { CropLayoutTemplate } from '../../../../../shared/types/cropLayoutTemplate'

type CropTemplateThumbnailProps = {
  template: CropLayoutTemplate
  width: number
  height: number
}

export const CropTemplateThumbnail: React.FC<CropTemplateThumbnailProps> = ({ template, width, height }) => {
  const { sourcePageWidth, sourcePageHeight, boxes } = template
  
  if (!sourcePageWidth || !sourcePageHeight) return <div style={{ width, height, backgroundColor: '#eee' }} />

  const scale = Math.min(width / sourcePageWidth, height / sourcePageHeight)
  const drawWidth = sourcePageWidth * scale
  const drawHeight = sourcePageHeight * scale

  return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
      <div style={{ width: drawWidth, height: drawHeight, position: 'relative', backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {boxes.filter(b => b.included).map(box => (
          <div
            key={box.id}
            style={{
              position: 'absolute',
              left: box.x * scale,
              top: box.y * scale,
              width: box.width * scale,
              height: box.height * scale,
              border: '1px solid #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.2)'
            }}
          />
        ))}
      </div>
    </div>
  )
}
