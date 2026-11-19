
import { join } from 'path'
import { mkdir, copyFile, rm } from 'fs/promises'

export type PdfWorkspacePaths = {
  workspaceId: string
  basePath: string
  sourcePath: string
  originalPdfPath: string
  chunksPath: string
  pagesPath: string
  metadataPath: string
  logsPath: string
  metadataJsonPath: string
  cropsPath: string
  jsonPath: string
}

export async function createPdfWorkspace(originalFilePath: string, originalFileName: string): Promise<PdfWorkspacePaths> {
  const workspaceId = `import-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  const pdfNameWithoutExt = originalFileName.replace(/\.[^/.]+$/, '')
  const workspaceFolder = process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat' : 'Extracts'
  const basePath = join(process.cwd(), workspaceFolder, pdfNameWithoutExt)
  
  try {
    if (originalFilePath !== join(basePath, originalFileName)) {
      // Instead of deleting the whole basePath (which would delete manual_crop_session.json),
      // we only clean up specific subdirectories.
      const dirsToClean = ['source', 'chunks', 'pages', 'metadata', 'logs', 'crops', 'json']
      for (const d of dirsToClean) {
        await rm(join(basePath, d), { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch (err) {
    // Ignore errors
  }

  const sourcePath = join(basePath, 'source')
  const chunksPath = join(basePath, 'chunks')
  const pagesPath = join(basePath, 'pages')
  const metadataPath = join(basePath, 'metadata')
  const logsPath = join(basePath, 'logs')
  const cropsPath = join(basePath, 'crops')
  const jsonPath = join(basePath, 'json')

  await mkdir(sourcePath, { recursive: true })
  await mkdir(chunksPath, { recursive: true })
  await mkdir(pagesPath, { recursive: true })
  await mkdir(metadataPath, { recursive: true })
  await mkdir(logsPath, { recursive: true })
  await mkdir(cropsPath, { recursive: true })
  await mkdir(jsonPath, { recursive: true })

  // The user requested to put a copy of the leaflet pdf inside the subfolder directly
  const originalPdfPath = join(basePath, originalFileName)
  if (originalFilePath !== originalPdfPath) {
    await copyFile(originalFilePath, originalPdfPath)
  }

  return {
    workspaceId,
    basePath,
    sourcePath,
    originalPdfPath,
    chunksPath,
    pagesPath,
    metadataPath,
    logsPath,
    metadataJsonPath: join(metadataPath, 'pdf-preprocess-metadata.json'),
    cropsPath,
    jsonPath
  }
}
