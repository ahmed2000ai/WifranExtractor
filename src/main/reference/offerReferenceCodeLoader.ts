import * as fs from 'fs/promises';
import * as path from 'path';

export async function loadCsvAsMap(filePath: string): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Failed to read CSV file ${filePath}: ${err.message}`);
  }

  // Remove UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const lines = content.split(/\r?\n/);
  const map: Record<string, string> = {};

  if (lines.length === 0) {
    throw new Error(`CSV file ${filePath} is empty`);
  }

  // Parse header
  const header = lines[0].split(',').map(s => s.trim());
  if (header.length < 2 || header[0].toLowerCase() !== 'code' || header[1].toLowerCase() !== 'description') {
    throw new Error(`CSV file ${filePath} has invalid header. Expected Code,Description`);
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Very simple CSV splitting for "Code,Description" (assuming no commas in codes, which are 4-letters)
    // If description has quotes and commas, this might break. Let's do a slightly robust split.
    // Actually, we can split by first comma safely because Code is exactly 4 chars without comma.
    const commaIndex = line.indexOf(',');
    if (commaIndex === -1) continue;

    const codeRaw = line.substring(0, commaIndex).trim();
    let descriptionRaw = line.substring(commaIndex + 1).trim();

    if (descriptionRaw.startsWith('"') && descriptionRaw.endsWith('"')) {
      descriptionRaw = descriptionRaw.substring(1, descriptionRaw.length - 1);
    }

    const code = codeRaw.toUpperCase();

    if (map[code]) {
      throw new Error(`Duplicate code found in ${filePath}: ${code}`);
    }

    map[code] = descriptionRaw;
  }

  return map;
}

export async function loadSupermarketCodeMap(projectRoot: string): Promise<Record<string, string>> {
  const filePath = path.join(projectRoot, 'docs', 'saudi_supermarket_names.csv');
  return loadCsvAsMap(filePath);
}

export async function loadOfferLocationCodeMap(projectRoot: string): Promise<Record<string, string>> {
  const filePath = path.join(projectRoot, 'docs', 'saudi_supermarket_offer_locations.csv');
  return loadCsvAsMap(filePath);
}
