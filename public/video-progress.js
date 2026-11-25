export function mergeRanges(ranges) {
  const merged = [];
  for (const [start, end] of ranges.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a,b) => a[0]-b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 0.05) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
export function hasFullCoverage(ranges, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const merged = mergeRanges(ranges);
  const tolerance = Math.min(0.15, duration * 0.01);
  return merged.length === 1 && merged[0][0] <= tolerance && merged[0][1] >= duration - tolerance;
}
