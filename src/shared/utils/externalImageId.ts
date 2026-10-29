export function buildExternalImageId(input: {
  leafletId: string
  sourceItemNumber: string
}): string {
  if (!input.leafletId || !input.sourceItemNumber) return ''
  return `${input.leafletId}-${input.sourceItemNumber}`
}
