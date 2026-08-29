import { Router, Request, Response } from 'express';
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  ALLOWED_CONTENT_TYPES,
  isAllowedContentType,
  isValidExternalEvidenceLink,
  normalizeExternalLink,
  uploadEvidenceToObjectStorage,
} from '../services/storageService';
import { attachDisputeEvidence } from '../services/bountyStore';
import { isValidStellarAddress } from '../utils';

export const disputeEvidenceRouter = Router();

/**
 * Helper to parse multipart/form-data body manually when express.json is bypassed or for file streams.
 */
function parseMultipartForm(req: Request): {
  fields: Record<string, string>;
  file?: { fileName: string; contentType: string; buffer: Buffer };
} {
  const contentTypeHeader = req.headers['content-type'] || '';
  if (!contentTypeHeader.includes('multipart/form-data')) {
    return { fields: req.body || {} };
  }

  const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    return { fields: req.body || {} };
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const rawBody = (req as any).rawBody || (Buffer.isBuffer(req.body) ? req.body : null);

  if (!rawBody) {
    return { fields: req.body || {} };
  }

  const parts = rawBody.toString('binary').split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: { fileName: string; contentType: string; buffer: Buffer } | undefined;

  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    const headerEndIndex = part.indexOf('\r\n\r\n');
    if (headerEndIndex === -1) continue;

    const rawHeaders = part.substring(0, headerEndIndex);
    const bodyContentBinary = part.substring(headerEndIndex + 4, part.length - 2); // trim trailing \r\n

    const contentDisposition = rawHeaders.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
    if (!contentDisposition) continue;

    const fieldName = contentDisposition[1];
    const fileName = contentDisposition[2];

    if (fileName) {
      const contentTypeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i);
      const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
      file = {
        fileName,
        contentType,
        buffer: Buffer.from(bodyContentBinary, 'binary'),
      };
    } else {
      fields[fieldName] = Buffer.from(bodyContentBinary, 'binary').toString('utf8');
    }
  }

  return { fields, file };
}

const handleDisputeEvidenceUpload = async (req: Request, res: Response): Promise<void> => {
  const bountyId = req.params.id;

  if (!bountyId) {
    res.status(400).json({ error: 'Bounty ID is required.' });
    return;
  }

  const parsedMultipart = parseMultipartForm(req);
  const fields = { ...(req.body || {}), ...parsedMultipart.fields };

  // Resolve caller address
  const caller =
    fields.caller ||
    fields.address ||
    fields.contributor ||
    fields.maintainer ||
    (req as any).signerPublicKey ||
    (typeof req.headers['x-caller-address'] === 'string' ? req.headers['x-caller-address'] : undefined) ||
    (typeof req.headers['x-stellar-public-key'] === 'string' ? req.headers['x-stellar-public-key'] : undefined);

  if (!caller || typeof caller !== 'string' || !isValidStellarAddress(caller.trim())) {
    res.status(400).json({ error: 'Caller must be a valid Stellar public key.' });
    return;
  }

  const cleanCaller = caller.trim();
  const maxSizeBytes = process.env.MAX_EVIDENCE_FILE_SIZE_BYTES
    ? parseInt(process.env.MAX_EVIDENCE_FILE_SIZE_BYTES, 10)
    : DEFAULT_MAX_FILE_SIZE_BYTES;

  let evidenceUrl: string | null = null;
  let fileName: string | undefined;
  let contentType: string | undefined;
  let fileSize: number | undefined;
  let linkType: 'file' | 'url' | 'ipfs' = 'url';

  // 1. Check for multipart file upload
  if (parsedMultipart.file) {
    const file = parsedMultipart.file;
    if (file.buffer.length > maxSizeBytes) {
      res.status(400).json({
        error: `File size exceeds maximum allowed limit of ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
      });
      return;
    }

    if (!isAllowedContentType(file.contentType)) {
      res.status(400).json({
        error: `Disallowed file content-type: ${file.contentType}. Allowed types are: ${ALLOWED_CONTENT_TYPES.join(', ')}.`,
      });
      return;
    }

    const uploaded = await uploadEvidenceToObjectStorage({
      bountyId,
      fileName: file.fileName,
      contentType: file.contentType,
      buffer: file.buffer,
    });

    evidenceUrl = uploaded.url;
    fileName = uploaded.fileName;
    contentType = uploaded.contentType;
    fileSize = uploaded.fileSize;
    linkType = 'file';
  }
  // 2. Check for Base64 encoded file in JSON body
  else if (fields.fileData && typeof fields.fileData === 'string') {
    const rawData = fields.fileData.trim();
    let base64String = rawData;
    let detectedType = fields.contentType || fields.mimeType || 'application/octet-stream';

    // Handle data URI format (e.g. data:image/png;base64,...)
    const dataUriMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedType = dataUriMatch[1];
      base64String = dataUriMatch[2];
    }

    const buffer = Buffer.from(base64String, 'base64');
    if (buffer.length > maxSizeBytes) {
      res.status(400).json({
        error: `File size exceeds maximum allowed limit of ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
      });
      return;
    }

    if (!isAllowedContentType(detectedType)) {
      res.status(400).json({
        error: `Disallowed file content-type: ${detectedType}. Allowed types are: ${ALLOWED_CONTENT_TYPES.join(', ')}.`,
      });
      return;
    }

    const uploaded = await uploadEvidenceToObjectStorage({
      bountyId,
      fileName: fields.fileName || fields.name || 'evidence_attachment',
      contentType: detectedType,
      buffer,
    });

    evidenceUrl = uploaded.url;
    fileName = uploaded.fileName;
    contentType = uploaded.contentType;
    fileSize = uploaded.fileSize;
    linkType = 'file';
  }
  // 3. Check for external URL or IPFS link
  else {
    const rawLink = fields.url || fields.ipfsUrl || fields.link || fields.externalUrl;
    if (!rawLink || typeof rawLink !== 'string') {
      res.status(400).json({
        error: 'Must provide either a file upload or an external IPFS/URL link.',
      });
      return;
    }

    if (!isValidExternalEvidenceLink(rawLink)) {
      res.status(400).json({
        error: 'Invalid URL or IPFS link format.',
      });
      return;
    }

    evidenceUrl = normalizeExternalLink(rawLink);
    linkType = evidenceUrl.startsWith('ipfs://') ? 'ipfs' : 'url';
  }

  try {
    const result = await attachDisputeEvidence(bountyId, {
      caller: cleanCaller,
      url: evidenceUrl,
      fileName,
      contentType,
      fileSize,
      type: linkType,
      description: typeof fields.description === 'string' ? fields.description.trim() : undefined,
    });

    res.status(201).json({
      data: {
        evidence: result.evidence,
        bounty: result.bounty,
      },
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
    } else if (message.includes('Only the bounty contributor or maintainer')) {
      res.status(403).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
};

// Primary endpoint required by #773
disputeEvidenceRouter.post('/api/bounties/:id/disputes/evidence', handleDisputeEvidenceUpload);

// Alias endpoint for convenience
disputeEvidenceRouter.post('/api/bounties/:id/dispute/evidence', handleDisputeEvidenceUpload);
