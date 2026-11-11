export function resolveAllowedClientOrigins(
  env: NodeJS.ProcessEnv = process.env,
  localOrigins: readonly string[] = [],
): ReadonlySet<string> {
  const isProduction = env.NODE_ENV === 'production';
  const fallback = isProduction ? '' : 'http://localhost:5173';
  const configured = (env.CLIENT_ORIGIN || fallback)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set([...configured, ...(isProduction ? [] : localOrigins)]);
}

/** Browser requests must use a configured origin; non-browser clients may omit Origin. */
export function clientOriginIsAllowed(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}
