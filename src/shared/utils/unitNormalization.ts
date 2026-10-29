export function normalizePackUnit(value: string | null | undefined): string | null {
  if (!value) return null

  const normalized = value.toLowerCase().trim()
  
  const unitMap: Record<string, string> = {
    'liter': 'l',
    'litre': 'l',
    'ltr': 'l',
    'لتر': 'l',
    'l': 'l',
    
    'كيلو': 'kg',
    'كجم': 'kg',
    'kg': 'kg',
    'kilo': 'kg',
    'kilogram': 'kg',
    
    'جرام': 'g',
    'جم': 'g',
    'g': 'g',
    'gram': 'g',
    'grams': 'g',
    
    'مل': 'ml',
    'ml': 'ml',
    'milliliter': 'ml',
    
    'حبة': 'piece',
    'قطعة': 'piece',
    'piece': 'piece',
    'pcs': 'piece',
    'pc': 'piece',
    
    'كيس': 'bag',
    'bag': 'bag',
    'bags': 'bag',
    
    'كرتون': 'carton',
    'carton': 'carton',
    
    'box': 'box',
    'صندوق': 'box',
    
    'ربطة': 'pack',
    'pack': 'pack',
    'packs': 'pack'
  }

  // Exact match
  if (unitMap[normalized]) {
    return unitMap[normalized]
  }

  // Try partial match if exact fails
  for (const [key, val] of Object.entries(unitMap)) {
    if (normalized.includes(key)) {
      return val
    }
  }

  return 'other'
}
