import path from 'node:path';

export function getBountyArchivePath(storePath: string): string {
  if (process.env.BOUNTY_ARCHIVE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_ARCHIVE_PATH.trim());
  }
  return storePath.replace(/\.json$/i, '') + '.archive.json';
}
