const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  ndjson: 'application/x-ndjson',
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip',
}

export function contentTypeFor(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}
