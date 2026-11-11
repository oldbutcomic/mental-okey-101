import { createHash, timingSafeEqual } from 'node:crypto';

export type InviteCodeFailure = 'closed' | 'invalid';

export function registrationInviteFailure(
  candidate: unknown,
  env: NodeJS.ProcessEnv = process.env,
): InviteCodeFailure | null {
  const configuredCodes = (env.BETA_INVITE_CODES ?? env.BETA_INVITE_CODE ?? '')
    .split(/[\r\n,]+/u)
    .map(code => code.trim())
    .filter(Boolean);
  const mustRequireCode = env.NODE_ENV === 'production' || configuredCodes.length > 0;

  // Keep existing local/test registration open unless an invite code is explicitly configured.
  if (!mustRequireCode) return null;
  if (!configuredCodes.length) return 'closed';
  if (typeof candidate !== 'string' || candidate.length > 256) return 'invalid';

  const providedCode = candidate.trim();
  if (!providedCode) return 'invalid';
  const providedDigest = createHash('sha256').update(providedCode).digest();
  let matchesConfiguredCode = false;
  for (const configuredCode of configuredCodes) {
    const expectedDigest = createHash('sha256').update(configuredCode).digest();
    matchesConfiguredCode = timingSafeEqual(expectedDigest, providedDigest) || matchesConfiguredCode;
  }
  return matchesConfiguredCode ? null : 'invalid';
}
