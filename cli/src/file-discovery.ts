import { z } from 'zod'

const scopeSchema = z.enum(['organization', 'personal'])
const fileKindSchema = z.enum([
  'text',
  'table',
  'image',
  'artifact',
  'artifact:chart',
  'artifact:model',
  'artifact:file',
])
type DiscoveryFileKind = z.infer<typeof fileKindSchema>

interface DiscoveryFileLeaf {
  name: string
  kind: DiscoveryFileKind
  fileId: string
  documentId?: string
  version: number
  type: string
  scope: 'organization' | 'personal'
  sizeBytes?: number | null
  language?: string | null
  pageCount?: number | null
  ingestStatus?: 'pending' | 'processing' | 'ready' | 'error'
  queryable?: boolean
  unavailableReason?: 'ambiguous_ref'
  ref?: string
  rowCount?: number | null
  columnCount?: number
}

interface DiscoveryFolder {
  name: string
  kind: 'folder'
  children: DiscoveryFileNode[]
  truncated?: true
}

type DiscoveryFileNode = DiscoveryFolder | DiscoveryFileLeaf

export interface FileDiscoveryTree {
  path: string
  children: DiscoveryFileNode[]
  truncated?: true
}

const fileLeafSchema = z
  .object({
    name: z.string(),
    kind: fileKindSchema,
    type: z.string(),
    fileId: z.string(),
    version: z.number().int(),
    scope: scopeSchema,
    documentId: z.string().optional(),
    language: z.string().nullable().optional(),
    sizeBytes: z.number().nullable().optional(),
    pageCount: z.number().nullable().optional(),
    ingestStatus: z.enum(['pending', 'processing', 'ready', 'error']).optional(),
    queryable: z.boolean().optional(),
    unavailableReason: z.literal('ambiguous_ref').optional(),
    ref: z.string().optional(),
    rowCount: z.number().int().nullable().optional(),
    columnCount: z.number().int().optional(),
  })
  .passthrough()

const fileNodeSchema: z.ZodType<DiscoveryFileNode> = z.lazy(
  () =>
    z.union([
      z
        .object({
          name: z.string(),
          kind: z.literal('folder'),
          children: z.array(fileNodeSchema),
          truncated: z.literal(true).optional(),
        })
        .passthrough(),
      fileLeafSchema,
    ]) as z.ZodType<DiscoveryFileNode>
)

export const fileDiscoveryTreeSchema: z.ZodType<FileDiscoveryTree> = z
  .object({
    path: z.string(),
    children: z.array(fileNodeSchema),
    truncated: z.literal(true).optional(),
  })
  .passthrough()
  .superRefine((tree, context) => {
    if (containsCursorField(tree)) {
      context.addIssue({ code: 'custom', message: 'File discovery trees do not use cursors' })
    }
  })

function containsCursorField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCursorField)
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    ['cursor', 'next_cursor', 'nextCursor', 'has_more', 'hasMore'].some((key) => key in record) ||
    Object.values(record).some(containsCursorField)
  )
}

export function formatFileDiscoveryTree(tree: FileDiscoveryTree): string[] {
  const lines: string[] = []
  const visit = (nodes: readonly DiscoveryFileNode[], parentPath: string): void => {
    for (const node of nodes) {
      const path = parentPath === '/' ? `/${node.name}` : `${parentPath}/${node.name}`
      if (node.kind === 'folder') {
        lines.push(`${path}\tfolder\t${node.truncated ? 'truncated' : '-'}`)
        visit(node.children, path)
      } else {
        lines.push(`${path}\t${node.kind}\t${node.sizeBytes ?? '-'}`)
      }
    }
  }
  visit(tree.children, tree.path.replace(/\/$/, '') || '/')
  if (tree.truncated) lines.push('[additional root entries omitted]')
  return lines
}
