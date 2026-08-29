import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "../logger";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
];

export interface UploadFileOptions {
  bountyId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

export interface UploadResult {
  url: string;
  key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

/**
 * Validates if the content type is allowed for evidence uploads.
 */
export function isAllowedContentType(contentType: string): boolean {
  if (!contentType) return false;
  const cleanType = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(cleanType);
}

/**
 * Validates if a string is a valid HTTP/HTTPS URL or IPFS link/CID.
 */
export function isValidExternalEvidenceLink(link: string): boolean {
  if (!link || typeof link !== "string") return false;
  const trimmed = link.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("ipfs://")) {
    return true;
  }
  // Check raw IPFS CID (v0 Qm... or v1 bafy...)
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55,})$/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Normalizes an external link or IPFS CID to a full URL or IPFS URI.
 */
export function normalizeExternalLink(link: string): string {
  const trimmed = link.trim();
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55,})$/i.test(trimmed)) {
    return `ipfs://${trimmed}`;
  }
  return trimmed;
}

/**
 * Uploads evidence file to object storage (S3 compatible) or local storage fallback.
 */
export async function uploadEvidenceToObjectStorage(
  options: UploadFileOptions
): Promise<UploadResult> {
  const { bountyId, fileName, contentType, buffer } = options;
  const sanitizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueId = crypto.randomBytes(8).toString("hex");
  const key = `disputes/${bountyId}/${Date.now()}-${uniqueId}-${sanitizedFileName}`;

  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const publicPrefix = process.env.S3_PUBLIC_URL_PREFIX;

  // If S3 environment variables are provided, perform S3 HTTP upload
  if (bucket && endpoint) {
    try {
      const uploadUrl = `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
      };

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: buffer,
      });

      if (!response.ok) {
        throw new Error(`S3 upload HTTP error: ${response.status} ${response.statusText}`);
      }

      const publicUrl = publicPrefix
        ? `${publicPrefix.replace(/\/$/, "")}/${key}`
        : uploadUrl;

      return {
        url: publicUrl,
        key,
        fileName: sanitizedFileName,
        contentType,
        fileSize: buffer.length,
      };
    } catch (err) {
      logger.error({ err, bountyId, key }, "S3 upload failed, falling back to local storage");
    }
  }

  // Fallback to local disk storage
  const uploadDir = path.join(process.cwd(), "data", "uploads", "disputes", bountyId);
  fs.mkdirSync(uploadDir, { recursive: true });
  const localFilePath = path.join(uploadDir, `${Date.now()}-${uniqueId}-${sanitizedFileName}`);
  fs.writeFileSync(localFilePath, buffer);

  const fallbackBaseUrl = process.env.APP_BASE_URL || publicPrefix || "http://localhost:3000";
  const relativePath = `uploads/disputes/${bountyId}/${path.basename(localFilePath)}`;
  const referenceUrl = `${fallbackBaseUrl.replace(/\/$/, "")}/${relativePath}`;

  return {
    url: referenceUrl,
    key,
    fileName: sanitizedFileName,
    contentType,
    fileSize: buffer.length,
  };
}
