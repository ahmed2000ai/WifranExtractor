import sharp from 'sharp';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const images = [
  { id: 'GOLDEN-P1', path: 'test-fixtures/page1_small.png' },
  { id: 'BNDW-P2', path: 'Extracts/BNDW_Test/pages/page.2.png' },
  { id: 'ALWAFA-P1', path: 'Extracts/Alwafa_Test/pages/page.1.png' }
];

async function run() {
  for (const img of images) {
    const buf = readFileSync(img.path);
    const hash = createHash('sha256').update(buf).digest('hex');
    const meta = await sharp(buf).metadata();
    console.log(JSON.stringify({ id: img.id, path: img.path, width: meta.width, height: meta.height, bytes: buf.length, sha256: hash }));
  }
  process.exit(0);
}
run();

