import { z } from 'zod'

const typeIdSuffix = '[0-9a-hjkmnp-tv-z]{26}'

export const dataOrganizationIdSchema = z
  .string()
  .regex(new RegExp(`^org_${typeIdSuffix}$`))
  .describe('Organization ID used to scope data discovery.')

export const dataProjectIdSchema = z
  .string()
  .regex(new RegExp(`^prj_${typeIdSuffix}$`))
  .describe('Project ID whose data should be inspected.')

const tableReferenceSchema = z.string().min(1).max(2_048)
const tableIdentifierSchema = z.string().min(1).max(128)
const displayNameSchema = z.string().min(1)
const offsetSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const listDataTablesInputSchema = z.strictObject({
  organizationId: dataOrganizationIdSchema.optional(),
  projectId: dataProjectIdSchema,
  query: z.string().trim().min(1).max(500).optional().describe('Text used to filter table names.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Maximum number of tables to return.'),
  offset: offsetSchema.default(0).describe('Zero-based position at which to start the page.'),
})

export const describeDataTableInputSchema = z.strictObject({
  organizationId: dataOrganizationIdSchema.optional(),
  projectId: dataProjectIdSchema,
  ref: tableReferenceSchema.describe('Queryable table reference returned by data list.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum number of columns to return.'),
  offset: offsetSchema.default(0).describe('Zero-based position at which to start the page.'),
})

export const listProjectsInputSchema = z.strictObject({
  organizationId: dataOrganizationIdSchema.optional(),
})

export const listDataTablesInputJsonSchema = z.toJSONSchema(listDataTablesInputSchema, {
  io: 'input',
})
export const describeDataTableInputJsonSchema = z.toJSONSchema(describeDataTableInputSchema, {
  io: 'input',
})
export const listProjectsInputJsonSchema = z.toJSONSchema(listProjectsInputSchema, {
  io: 'input',
})

const paginationResponseShape = {
  truncated: z.boolean(),
  nextOffset: offsetSchema.nullable(),
}

function validatePagination(
  value: { truncated: boolean; nextOffset: number | null },
  context: z.RefinementCtx
): void {
  if (value.truncated !== (value.nextOffset !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'The pagination cursor must match the truncated state.',
      path: ['nextOffset'],
    })
  }
}

export const dataTableSchema = z
  .object({
    id: tableIdentifierSchema,
    ref: tableReferenceSchema.optional(),
    displayName: displayNameSchema,
    source: z.string().min(1),
    sourceType: z.enum(['document', 'connector']),
    scope: z.enum(['organization', 'personal']),
    queryable: z.boolean(),
    unavailableReason: z.literal('ambiguous_ref').optional(),
    ingestStatus: z.string().min(1).optional(),
    rowCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    columnCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .superRefine((table, context) => {
    if (table.queryable !== (table.ref !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Queryable tables must include a ref, and other tables must omit it.',
        path: ['ref'],
      })
    }
  })

export const dataTablesResponseSchema = z
  .object({
    tables: z.array(dataTableSchema).max(100),
    ...paginationResponseShape,
  })
  .superRefine(validatePagination)

export const describeDataTableResponseSchema = z
  .object({
    id: tableIdentifierSchema,
    ref: tableReferenceSchema,
    displayName: displayNameSchema,
    columns: z
      .array(
        z.object({
          name: z.string().min(1),
          type: z.string().min(1).optional(),
          nullable: z.boolean().optional(),
        })
      )
      .max(500),
    ...paginationResponseShape,
  })
  .superRefine(validatePagination)

export const projectListResponseSchema = z.object({
  projects: z.array(
    z.object({
      id: dataProjectIdSchema,
      slug: z.string().min(1).max(100).optional(),
      name: z.string().min(1).max(100),
      description: z.string().max(500).nullable(),
      scope: z.enum(['organization', 'personal']),
      isDefault: z.boolean(),
      isArchived: z.boolean(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
  ),
})

export type ListDataTablesInput = z.infer<typeof listDataTablesInputSchema>
export type DescribeDataTableInput = z.infer<typeof describeDataTableInputSchema>
export type ListProjectsInput = z.infer<typeof listProjectsInputSchema>
