export type ConnectionQuality = 'good' | 'medium' | 'weak';

/** Round-trip time measured by an acknowledged Socket.IO ping. */
export function classifyConnectionLatency(latencyMs: number): ConnectionQuality {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 'weak';
  if (latencyMs <= 120) return 'good';
  if (latencyMs <= 300) return 'medium';
  return 'weak';
}

/** Uses a rolling median so one delayed browser callback cannot mark the link weak. */
export function classifyRecentConnectionLatency(samples: number[], consecutiveFailures = 0): ConnectionQuality | 'unknown' {
  if (consecutiveFailures >= 2) return 'weak';
  const recent = samples.filter(sample => Number.isFinite(sample) && sample >= 0).slice(-5).sort((a, b) => a - b);
  if (recent.length < 3) return 'unknown';
  const middle = Math.floor(recent.length / 2);
  const median = recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
  return classifyConnectionLatency(median);
}
