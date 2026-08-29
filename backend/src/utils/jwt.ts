import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
const JWT_ISSUER = 'stellar-bounty-board';

export interface JwtPayload {
  sub: string; // Stellar public key (subject)
  iat?: number;
  exp?: number;
  iss?: string;
}

export function signJwt(publicKey: string): string {
  return jwt.sign(
    { sub: publicKey },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRY,
      issuer: JWT_ISSUER,
    }
  );
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
  }) as JwtPayload;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | null;
  } catch {
    return null;
  }
}
