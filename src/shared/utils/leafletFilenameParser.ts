export type LeafletFilenameMetadataResult = {
  ok: boolean;

  file_name: string;
  base_name: string;

  supermarket_code: string | null;
  supermarket_description: string | null;

  location_code: string | null;
  location_description: string | null;

  promotion_start_date: string | null;

  errors: Array<{
    code:
      | 'filename_pattern_invalid'
      | 'unknown_supermarket_code'
      | 'unknown_location_code'
      | 'invalid_promotion_start_date';
    message: string;
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;
};

export function parseLeafletFilename(input: {
  fileName: string;
  supermarketCodes: Record<string, string>;
  locationCodes: Record<string, string>;
}): LeafletFilenameMetadataResult {
  const { fileName, supermarketCodes, locationCodes } = input;
  
  const result: LeafletFilenameMetadataResult = {
    ok: false,
    file_name: fileName,
    base_name: fileName.replace(/\.pdf$/i, ''),
    supermarket_code: null,
    supermarket_description: null,
    location_code: null,
    location_description: null,
    promotion_start_date: null,
    errors: [],
    warnings: [],
  };

  const pattern = /^([A-Za-z0-9]{4})-([A-Za-z0-9]{4})-(\d{6})\.pdf$/i;
  const match = fileName.match(pattern);

  if (!match) {
    result.errors.push({
      code: 'filename_pattern_invalid',
      message: `Filename format invalid. Expected SSSS-LLLL-DDMMYY.pdf, got: ${fileName}`,
    });
    return result;
  }

  const rawSupermarket = match[1].toUpperCase();
  const rawLocation = match[2].toUpperCase();
  const rawDate = match[3];

  if (supermarketCodes[rawSupermarket]) {
    result.supermarket_code = rawSupermarket;
    result.supermarket_description = supermarketCodes[rawSupermarket];
  } else {
    result.errors.push({
      code: 'unknown_supermarket_code',
      message: `Unknown supermarket code: ${rawSupermarket}`,
    });
  }

  if (locationCodes[rawLocation]) {
    result.location_code = rawLocation;
    result.location_description = locationCodes[rawLocation];
  } else {
    result.errors.push({
      code: 'unknown_location_code',
      message: `Unknown location code: ${rawLocation}`,
    });
  }

  const day = parseInt(rawDate.substring(0, 2), 10);
  const month = parseInt(rawDate.substring(2, 4), 10);
  const yearOffset = parseInt(rawDate.substring(4, 6), 10);

  const fullYear = 2000 + yearOffset;

  const dateObj = new Date(fullYear, month - 1, day);
  
  // Basic validation that date is real (e.g. not Feb 31)
  if (
    dateObj.getFullYear() === fullYear &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  ) {
    const formattedMonth = month.toString().padStart(2, '0');
    const formattedDay = day.toString().padStart(2, '0');
    result.promotion_start_date = `${fullYear}-${formattedMonth}-${formattedDay}`;
  } else {
    result.errors.push({
      code: 'invalid_promotion_start_date',
      message: `Invalid date parsed from filename: ${rawDate}`,
    });
  }

  if (result.errors.length === 0) {
    result.ok = true;
  }

  return result;
}
