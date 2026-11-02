export function legacyUpdate(incoming, previousRaw, baseline, previousLive) {
  const raw = { pages: Math.max(incoming.pages, previousRaw.pages), seconds: Math.max(incoming.seconds, previousRaw.seconds) };
  return { raw, live: { pages: Math.max(previousLive.pages, raw.pages - baseline.pages, 0), seconds: Math.max(previousLive.seconds, raw.seconds - baseline.seconds, 0) } };
}
