/**
 * FIFO eviction helpers for insertion-ordered `Map` instances (V8 preserves
 * key insertion order). O(1) amortized per eviction.
 */

/**
 * Before inserting `key`, if the map is at capacity and `key` is new,
 * deletes the oldest key (first in iteration order).
 */
export function evictOldestIfCapacityBeforeSet<K, V>(
  map: Map<K, V>,
  maxSize: number,
  key: K,
): void {
  if (map.size >= maxSize && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * After growing the map, if size strictly exceeds `maxSize`, removes one
 * oldest entry (used for capped tracking maps).
 */
export function evictOneOldestIfExceedsMax<K, V>(
  map: Map<K, V>,
  maxSize: number,
): void {
  if (map.size > maxSize) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
}
