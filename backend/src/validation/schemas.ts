import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { isValidStellarAddress, getTokenAddressMap } from '../utils';
import { githubPrUrlSchema } from './prUrl';

extendZodWithOpenApi(z);

const REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const TOKEN_REGEX = /^[A-Za-z0-9]{1,12}$/;

export function getAllowedTokenSymbols(): string[] {
  const configured = process.env.ALLOWED_TOKEN_SYMBOLS?.split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return Object.keys(getTokenAddressMap());
}

const STELLAR_EXAMPLE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const TX_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

export const bountyIdSchema = z
  .string()
  .trim()
  .min(1, 'Bounty ID is required.')
  .openapi({ example: 'BNT-0001' });

const stellarAccountSchema = z
  .string()
  .trim()
  .refine(isValidStellarAddress, {
    message: 'Must be a valid Stellar public key (G... format, 56 characters with valid checksum).',
  })
  .openapi({
    example: STELLAR_EXAMPLE,
    description: 'A valid Stellar public key (starts with G, 56 characters, checksum verified).',
  });

export const createBountySchema = z
  .object({
    repo: z
      .string()
      .trim()
      .regex(REPO_REGEX, 'Repo must look like owner/repository.')
      .openapi({ example: 'owner/repo', description: 'GitHub repository in owner/repo format.' }),
    issueNumber: z.coerce
      .number()
      .int()
      .positive('Issue number must be positive.')
      .openapi({ example: 42, description: 'GitHub issue number this bounty is attached to.' }),
    title: z
      .string()
      .trim()
      .min(5)
      .max(120)
      .openapi({
        example: 'Fix login redirect bug',
        description: 'Short bounty title (5–120 chars).',
      }),
    summary: z.string().trim().min(20).max(280).openapi({
      example:
        'The login page does not redirect after successful authentication. Fix the redirect logic.',
      description: 'Description of the work required (20–280 chars).',
    }),
    maintainer: stellarAccountSchema,
    tokenSymbol: z
      .string()
      .trim()
      .regex(TOKEN_REGEX, 'Token symbol must be 1-12 letters or numbers.')
      .transform((symbol) => symbol.toUpperCase())
      .superRefine((symbol, ctx) => {
        const allowed = getAllowedTokenSymbols();
        if (!allowed.includes(symbol)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unsupported token symbol. Allowed values: ${allowed.join(', ')}`,
          });
        }
      })
      .openapi({
        example: 'XLM',
        description: 'Stellar token symbol for payout (1–12 alphanumeric chars).',
      }),
    amount: z.coerce
      .number()
      .positive()
      .openapi({
        example: 42.5,
        description: 'Payout amount in the selected token.',
      }),
    deadlineDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .openapi({ example: 14, description: 'Number of days until the bounty expires (1–90).' }),
    labels: z
      .array(z.string().trim().min(1).max(30))
      .max(6)
      .default([])
      .openapi({
        example: ['bug', 'help wanted'],
        description: 'Up to 6 labels for categorisation.',
      }),
    reservationTimeoutSeconds: z.number().int().positive().optional().openapi({
      example: 604800,
      description: 'Optional reservation timeout in seconds (default: 7 days = 604800 seconds).',
    }),
  })
  .openapi('CreateBountyRequest');

export const reserveBountySchema = z
  .object({
    contributor: stellarAccountSchema.openapi({
      description: 'Stellar public key of the contributor reserving the bounty.',
    }),
    expectedVersion: z.number().int().optional().openapi({
      example: 1,
      description:
        'Optional version number for race condition prevention. If provided, must match current bounty version.',
    }),
  })
  .openapi('ReserveBountyRequest');

export const GITHUB_PR_URL_REGEX =
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

export const submitBountySchema = z
  .object({
    contributor: stellarAccountSchema.openapi({
      description: 'Must match the contributor who reserved the bounty.',
    }),

    submissionUrl: z.string().trim().url().openapi({
      example: 'https://github.com/owner/repo/pull/123',
      description: 'GitHub pull request URL for the submission.',
    }),

    notes: z
      .string()
      .trim()
      .max(240)
      .optional()
      .openapi({
        example: 'Fixed by updating the redirect handler.',
        description: 'Optional notes (max 240 chars).',
      }),
  })
  .openapi('SubmitBountyRequest');

export const disputeBountySchema = z
  .object({
    contributor: stellarAccountSchema.openapi({
      description: 'Stellar public key of the contributor disputing the bounty.',
    }),
    reason: z
      .string()
      .trim()
      .min(1, 'Reason is required.')
      .max(500, 'Reason must be at most 500 characters.')
      .openapi({
        example: 'The submitted solution was not reviewed within the agreed timeframe.',
        description: 'Reason for disputing the bounty (1–500 chars).',
      }),
  })
  .openapi('DisputeBountyRequest');

export const maintainerActionSchema = z
  .object({
    maintainer: stellarAccountSchema.openapi({
      description: 'Must match the maintainer address on the bounty.',
    }),
    transactionHash: z
      .string()
      .trim()
      .regex(TX_HASH_REGEX, 'Transaction hash must be a 64 character hex string.')
      .optional()
      .openapi({
        example: '0'.repeat(64),
        description: 'Optional transaction hash for the release/refund action (64-char hex).',
      }),
  })
  .openapi('MaintainerActionRequest');

export const updateNotesSchema = z
  .object({
    maintainer: stellarAccountSchema.openapi({
      description: 'Must match the maintainer address on the bounty.',
    }),
    notes: z
      .string()
      .trim()
      .max(2000, 'Notes must be at most 2000 characters.')
      .openapi({
        example: 'Added additional details about the bounty requirements.',
        description: 'Maintainer notes for the bounty (max 2000 characters).',
      }),
  })
  .openapi('UpdateNotesRequest');

export const extendDeadlineSchema = z
  .object({
    maintainer: stellarAccountSchema.openapi({
      description: 'Must match the maintainer address on the bounty.',
    }),
    newDeadline: z
      .number()
      .int('New deadline must be an integer Unix timestamp (seconds).')
      .positive('New deadline must be a positive Unix timestamp (seconds).')
      .openapi({
        example: 1920000000,
        description:
          'New deadline as a Unix timestamp (seconds). Must be in the future and later than the current deadline.',
      }),
  })
  .openapi('ExtendDeadlineRequest');

// ---------------------------------------------------------------------------
// Shared response schemas
// ---------------------------------------------------------------------------

export const errorResponseSchema = z
  .object({
    error: z.string().openapi({ example: 'Bounty not found.' }),
  })
  .openapi('ErrorResponse');

export const bountyEventSchema = z.object({
  type: z.enum(['created', 'reserved', 'submitted', 'released', 'refunded', 'expired', 'disputed']),
  timestamp: z.number(),
  actor: z.string().optional(),
  details: z.record(z.any()).optional(),
});

export const bountyRecordSchema = z
  .object({
    id: z.string().openapi({ example: 'BNT-0001' }),
    repo: z.string().openapi({ example: 'owner/repo' }),
    issueNumber: z.number().openapi({ example: 42 }),
    title: z.string().openapi({ example: 'Fix login redirect bug' }),
    summary: z
      .string()
      .openapi({ example: 'The login page does not redirect after successful authentication.' }),
    maintainer: z.string().openapi({ example: STELLAR_EXAMPLE }),
    contributor: z.string().optional().openapi({ example: STELLAR_EXAMPLE }),
    tokenSymbol: z.string().openapi({ example: 'XLM' }),
    tokenAddress: z.string().openapi({ example: 'CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA' }),
    amount: z.number().openapi({ example: 100 }),
    labels: z.array(z.string()).openapi({ example: ['bug', 'help wanted'] }),
    status: z
      .enum(['open', 'reserved', 'submitted', 'released', 'refunded', 'expired'])
      .openapi({ example: 'open' }),
    createdAt: z
      .number()
      .openapi({ example: 1710000000, description: 'Unix timestamp (seconds).' }),
    deadlineAt: z
      .number()
      .openapi({ example: 1911000000, description: 'Unix timestamp (seconds).' }),
    reservedAt: z.number().optional().openapi({ example: 1710003600 }),
    submittedAt: z.number().optional(),
    releasedAt: z.number().optional(),
    releasedTxHash: z
      .string()
      .optional()
      .openapi({ example: '0'.repeat(64) }),
    refundedAt: z.number().optional(),
    refundedTxHash: z
      .string()
      .optional()
      .openapi({ example: '0'.repeat(64) }),
    canceledAt: z.number().optional().openapi({
      example: 1710007200,
      description: 'Unix timestamp (seconds) when an open bounty was canceled by the maintainer.',
    }),
    canceledTxHash: z
      .string()
      .optional()
      .openapi({ example: '0'.repeat(64) }),
    submissionUrl: z
      .string()
      .optional()
      .openapi({ example: 'https://github.com/owner/repo/pull/99' }),
    notes: z.string().optional(),
    version: z.number().openapi({ example: 1 }),
    events: z.array(bountyEventSchema),
    reservationTimeoutSeconds: z.number().optional().openapi({ example: 604800 }),
  })
  .openapi('BountyRecord');

export const openIssueSchema = z
  .object({
    id: z.string().openapi({ example: 'SBB-101' }),
    title: z.string().openapi({ example: 'Add Freighter wallet signing' }),
    labels: z.array(z.string()).openapi({ example: ['enhancement', 'help wanted'] }),
    summary: z
      .string()
      .openapi({
        example: 'Replace prompt-based demo actions with wallet-authenticated transactions.',
      }),
    impact: z.enum(['starter', 'core', 'advanced']).openapi({ example: 'core' }),
  })
  .openapi('OpenIssue');

const auditLogMetadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const bountyAuditLogSchema = z
  .object({
    id: z.string().openapi({ example: 'AUD-000001' }),
    bountyId: z.string().openapi({ example: 'BNT-0001' }),
    fromStatus: z
      .enum(['open', 'reserved', 'submitted', 'released', 'refunded', 'expired'])
      .openapi({ example: 'open' }),
    toStatus: z
      .enum(['open', 'reserved', 'submitted', 'released', 'refunded', 'expired'])
      .openapi({ example: 'reserved' }),
    transition: z
      .enum(['reserve', 'submit', 'release', 'refund', 'cancel', 'expire', 'dispute', 'update_notes'])
      .openapi({ example: 'reserve' }),
    actor: z.string().openapi({ example: STELLAR_EXAMPLE }),
    timestamp: z
      .number()
      .openapi({ example: 1710003600, description: 'Unix timestamp (seconds).' }),
    metadata: z
      .record(auditLogMetadataValueSchema)
      .optional()
      .openapi({
        example: { submissionUrl: 'https://github.com/owner/repo/pull/10', hasNotes: true },
        description: 'Transition-specific metadata for tools and debugging.',
      }),
  })
  .openapi('BountyAuditLogRecord');

export const bountyAuditLogPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100).openapi({ example: 20 }),
    offset: z.number().int().min(0).openapi({ example: 0 }),
    total: z.number().int().min(0).openapi({ example: 3 }),
    hasMore: z.boolean().openapi({ example: false }),
    nextOffset: z.number().int().min(0).nullable().openapi({ example: null }),
  })
  .openapi('BountyAuditLogPagination');

export const bountyAuditLogListResponseSchema = z
  .object({
    data: z.array(bountyAuditLogSchema),
    total: z.number().int().min(0).openapi({ example: 3 }),
    page: z.number().int().min(1).openapi({ example: 1 }),
    pageSize: z.number().int().min(1).max(100).openapi({ example: 20 }),
  })
  .openapi('BountyAuditLogListResponse');

export const healthResponseSchema = z
  .object({

  })
  .openapi('HealthResponse');

export const componentStatusSchema = z.enum(['up', 'down']);

export const deepHealthResponseSchema = z
  .object({
    overall: componentStatusSchema,
    components: z.object({
      store: componentStatusSchema,
      soroban: componentStatusSchema,
      contract: componentStatusSchema,
      auth: componentStatusSchema,
    }),
    timestamp: z.string(),
  })
  .openapi('DeepHealthResponse');

export function zodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}
