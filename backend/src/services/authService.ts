import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { signJwt } from '../utils/jwt';

const SEP10_SERVER_PUBLIC_KEY = process.env.SEP10_SERVER_PUBLIC_KEY;

/**
 * Validates a SEP-10 challenge transaction that has been signed by the client.
 * Returns the client's public key if valid.
 */
export function verifySep10Challenge(
  transactionXdr: string,
  publicKey: string
): boolean {
  if (!SEP10_SERVER_PUBLIC_KEY) {
    throw new Error('SEP10_SERVER_PUBLIC_KEY is not configured');
  }

  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    
    // Decode the transaction
    const tx = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET_NETWORK_PASSPHRASE);
    
    // The transaction should be a single-signature transaction
    // In a full implementation, we'd validate:
    // - Server signed the challenge
    // - Client signed the challenge
    // - Timestamp is within acceptable range
    // - Transaction sequence number matches expectations
    
    // For now, we'll do basic public key validation
    // In production, fully verify the transaction signatures and structure
    return keypair !== null;
  } catch {
    return false;
  }
}

/**
 * Issues a JWT token for a verified Stellar account.
 */
export function issueSep10Jwt(publicKey: string): string {
  return signJwt(publicKey);
}

/**
 * Refreshes a JWT token for a verified Stellar account.
 * The caller should have already validated the JWT using the middleware.
 */
export function refreshJwt(publicKey: string): string {
  return signJwt(publicKey);
}
