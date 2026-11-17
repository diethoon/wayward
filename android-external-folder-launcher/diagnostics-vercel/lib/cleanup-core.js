const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function cleanupExpiredWith({
  listBlobs,
  deleteBlobs,
  now = Date.now(),
  maxPages = 20
} = {}) {
  if (typeof listBlobs !== "function" || typeof deleteBlobs !== "function") {
    throw new TypeError("listBlobs and deleteBlobs are required");
  }
  const cutoff = now - RETENTION_MS;
  let cursor;
  let pages = 0;
  let deleted = 0;
  do {
    const page = await listBlobs({
      prefix: "logs/",
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });
    const expired = (page.blobs || []).filter(blob =>
      Number.isFinite(new Date(blob.uploadedAt).getTime())
      && new Date(blob.uploadedAt).getTime() < cutoff
    );
    if (expired.length) {
      await deleteBlobs(expired.map(blob => blob.url));
      deleted += expired.length;
    }
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < maxPages);
  return { pages, deleted, hasMore: Boolean(cursor) };
}
