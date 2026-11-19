/**
 * Sanitizes raw LLM JSON responses at the API response boundary by stripping any
 * unexpected currency-related fields before downstream canonical mapping.
 *
 * Wifran operates strictly in Saudi Arabia with fixed internal currency 'SAR'.
 * Currency is assigned only by deterministic application code, never trusted from AI output.
 */

const UNEXPECTED_CURRENCY_KEY_REGEX =
  /^(?:currency|page_currency|currency_evidence|near_currency_symbol|currency_confidence|currency_code|printed_currency)$/i;

export interface CurrencySanitizationResult<T> {
  sanitized: T;
  strippedKeys: string[];
}

function stripCurrencyRecursive(
  value: unknown,
  pathPrefix: string,
  strippedKeys: string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      stripCurrencyRecursive(item, `${pathPrefix}[${idx}]`, strippedKeys)
    );
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (UNEXPECTED_CURRENCY_KEY_REGEX.test(key)) {
      strippedKeys.push(fieldPath);
      continue;
    }
    out[key] = stripCurrencyRecursive(val, fieldPath, strippedKeys);
  }
  return out;
}

/**
 * Removes any currency properties returned by a vision/text model before
 * canonical mapping assigns internal currency ('SAR').
 */
export function stripUnexpectedCurrencyFromModelResponse<T>(
  rawPayload: T
): CurrencySanitizationResult<T> {
  const strippedKeys: string[] = [];
  const sanitized = stripCurrencyRecursive(rawPayload, '', strippedKeys) as T;
  return {
    sanitized,
    strippedKeys
  };
}
