import { createHash, timingSafeEqual } from 'node:crypto';

export type InviteCodeFailure = 'closed' | 'invalid';

export function registrationInviteFailure(
  candidate: unknown,
  env: NodeJS.ProcessEnv = process.env,
): InviteCodeFailure | null {
  const configuredCode = env.BETA_INVITE_CODE?.trim() || '';
  const mustRequireCode = env.NODE_ENV === 'production' || configuredCode.length > 0;

  // Keep existing local/test registration open unless an invite code is explicitly configured.
  if (!mustRequireCode) return null;
  if (!configuredCode) return 'closed';
  if (typeof candidate !== 'string' || candidate.length > 256) return 'invalid';

  const providedCode = candidate.trim();
  if (!providedCode) return 'invalid';
  const expectedDigest = createHash('sha256').update(configuredCode).digest();
  const providedDigest = createHash('sha256').update(providedCode).digest();
  return timingSafeEqual(expectedDigest, providedDigest) ? null : 'invalid';
}
