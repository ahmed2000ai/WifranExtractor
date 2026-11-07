import fs from 'fs'
import path from 'path'

function inspectAll() {
  console.log('Inspecting all packages in Extracts/ and Leaflets/ for promotional dates:')
  
  // 1. Inspect Extracts
  const extractsDir = path.resolve(process.cwd(), 'Extracts')
  if (fs.existsSync(extractsDir)) {
    const pkgs = fs.readdirSync(extractsDir)
    for (const p of pkgs) {
      const pPath = path.join(extractsDir, p)
      if (fs.statSync(pPath).isDirectory()) {
        const manifestPaths = [
          path.join(pPath, 'extraction_manifest.json'),
          path.join(pPath, 'manifest.json'),
          path.join(pPath, 'staged-draft.json')
        ]
        let found = false
        for (const mp of manifestPaths) {
          if (fs.existsSync(mp)) {
            try {
              const data = JSON.parse(fs.readFileSync(mp, 'utf8'))
              const vf = data.valid_from || data.header?.validFrom || data.leaflet_filename_metadata?.valid_from
              const vt = data.valid_to || data.header?.validTo || data.leaflet_filename_metadata?.valid_to
              const store = data.supermarket?.name_en || data.header?.supermarketId || data.leaflet_filename_metadata?.supermarket_slug
              console.log(`[Extracts/${p}] Store: ${store}, Valid: ${vf} to ${vt}`)
              found = true
              break
            } catch (e) {}
          }
        }
        if (!found) {
          console.log(`[Extracts/${p}] No manifest found`)
        }
      }
    }
  }

  // 2. Inspect Leaflets
  const leafletsDir = path.resolve(process.cwd(), 'Leaflets')
  if (fs.existsSync(leafletsDir)) {
    const files = fs.readdirSync(leafletsDir)
    console.log('Leaflet PDF files:', files)
  }

  // 3. Inspect Noori PDF pages
  // Did Noori have other pages?
  // Let's check how many pages Leaflets/noori-supermarket-229796668-jeddah.pdf has, or if there is another PDF.
}

inspectAll()

