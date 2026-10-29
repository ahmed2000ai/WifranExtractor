export function normalizeOcrKey(key: string): string {
  if (!key) return ''

  return key
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase to snake_case
    .replace(/[-\s]+/g, '_')             // kebab-case and spaces to snake_case
    .replace(/[^a-zA-Z0-9_]/g, '')       // remove special chars
    .replace(/_+/g, '_')                 // remove duplicate underscores
    .replace(/^_|_$/g, '')               // remove leading/trailing underscores
    .toLowerCase()
}

export type OcrReturnedKeysRegistry = {
  keys: Array<{
    canonical_key: string;
    aliases_seen: string[];
  }>;
};

export function canonicalizeOcrObjectKeys(input: {
  rawObject: Record<string, unknown>;
  registry: OcrReturnedKeysRegistry;
}): {
  canonicalObject: Record<string, unknown>;
  aliasesUsed: Array<{ alias: string; canonicalKey: string }>;
  newCanonicalKeys: string[];
  collisions: Array<{
    canonicalKey: string;
    keptValue: unknown;
    discardedValues: unknown[];
    sourceKeys: string[];
  }>;
} {
  const { rawObject, registry } = input
  const canonicalObject: Record<string, unknown> = {}
  const aliasesUsed: Array<{ alias: string; canonicalKey: string }> = []
  const newCanonicalKeys: string[] = []
  const collisions: Array<{
    canonicalKey: string;
    keptValue: unknown;
    discardedValues: unknown[];
    sourceKeys: string[];
  }> = []

  // Create a fast lookup map for normalized key -> canonical key
  const keyMap = new Map<string, string>()
  const knownCanonicalKeys = new Set<string>()

  for (const entry of registry.keys) {
    const canonical = normalizeOcrKey(entry.canonical_key)
    knownCanonicalKeys.add(canonical)
    keyMap.set(canonical, canonical)
    for (const alias of entry.aliases_seen) {
      keyMap.set(normalizeOcrKey(alias), canonical)
    }
  }

  // Group raw keys by their resolved canonical key
  const resolvedGroups = new Map<string, Array<{ rawKey: string, normKey: string, val: unknown }>>()

  for (const [rawKey, val] of Object.entries(rawObject)) {
    if (val === null || val === undefined || val === '') continue

    const normKey = normalizeOcrKey(rawKey)
    if (!normKey) continue

    let canonical = keyMap.get(normKey)
    if (!canonical) {
      // It's a new key
      canonical = normKey
      keyMap.set(normKey, canonical)
      knownCanonicalKeys.add(canonical)
      newCanonicalKeys.push(canonical)
    } else if (canonical !== normKey) {
      // It's an alias
      aliasesUsed.push({ alias: normKey, canonicalKey: canonical })
    }

    if (!resolvedGroups.has(canonical)) {
      resolvedGroups.set(canonical, [])
    }
    resolvedGroups.get(canonical)!.push({ rawKey, normKey, val })
  }

  // Resolve groups into canonical object
  for (const [canonicalKey, items] of resolvedGroups.entries()) {
    if (items.length === 1) {
      canonicalObject[canonicalKey] = items[0].val
    } else {
      // Collision handling
      const sourceKeys = items.map(i => i.rawKey)
      // Check if one of them is the direct canonical key
      const directMatch = items.find(i => i.normKey === canonicalKey)

      let keptItem = directMatch || items[0] // Prefer direct match, otherwise first

      const discardedValues = items.filter(i => i !== keptItem).map(i => i.val)

      canonicalObject[canonicalKey] = keptItem.val
      collisions.push({
        canonicalKey,
        keptValue: keptItem.val,
        discardedValues,
        sourceKeys
      })
    }
  }

  return { canonicalObject, aliasesUsed, newCanonicalKeys, collisions }
}
