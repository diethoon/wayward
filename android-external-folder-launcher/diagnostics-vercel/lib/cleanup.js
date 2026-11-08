import { del, list } from "@vercel/blob";
import { cleanupExpiredWith } from "./cleanup-core.js";

export async function cleanupExpired(options = {}) {
  return cleanupExpiredWith({
    ...options,
    listBlobs: options.listBlobs || list,
    deleteBlobs: options.deleteBlobs || del
  });
}
