export interface IQueueEntry {
  scheduleId: string;
  tenantId: string;
  nextRunAt: number;
}

/**
 * Min-heap priority queue keyed by nextRunAt timestamp.
 * O(log n) insert, O(log n) pop, O(n) remove-by-id.
 * Uses a Map index for O(1) membership checks and O(1) entry lookup by scheduleId.
 */
export class ScheduleQueue {
  private heap: IQueueEntry[] = [];
  private readonly indexMap = new Map<string, number>();

  get size(): number {
    return this.heap.length;
  }

  has(scheduleId: string): boolean {
    return this.indexMap.has(scheduleId);
  }

  insert(entry: IQueueEntry): void {
    if (this.indexMap.has(entry.scheduleId)) {
      this.remove(entry.scheduleId);
    }
    const idx = this.heap.length;
    this.heap.push(entry);
    this.indexMap.set(entry.scheduleId, idx);
    this.bubbleUp(idx);
  }

  pop(): IQueueEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    this.indexMap.delete(top.scheduleId);
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indexMap.set(last.scheduleId, 0);
      this.sinkDown(0);
    }
    return top;
  }

  popAllDue(now: number): IQueueEntry[] {
    const results: IQueueEntry[] = [];
    while (this.heap.length > 0 && this.heap[0].nextRunAt <= now) {
      results.push(this.pop()!);
    }
    return results;
  }

  remove(scheduleId: string): boolean {
    const idx = this.indexMap.get(scheduleId);
    if (idx === undefined) return false;

    this.indexMap.delete(scheduleId);
    const lastIdx = this.heap.length - 1;

    if (idx === lastIdx) {
      this.heap.pop();
      return true;
    }

    const last = this.heap.pop()!;
    this.heap[idx] = last;
    this.indexMap.set(last.scheduleId, idx);

    const parentIdx = (idx - 1) >>> 1;
    if (idx > 0 && this.heap[idx].nextRunAt < this.heap[parentIdx].nextRunAt) {
      this.bubbleUp(idx);
    } else {
      this.sinkDown(idx);
    }
    return true;
  }

  clear(): void {
    this.heap.length = 0;
    this.indexMap.clear();
  }

  private bubbleUp(idx: number): void {
    const entry = this.heap[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >>> 1;
      const parent = this.heap[parentIdx];
      if (entry.nextRunAt >= parent.nextRunAt) break;

      this.heap[idx] = parent;
      this.indexMap.set(parent.scheduleId, idx);
      idx = parentIdx;
    }
    this.heap[idx] = entry;
    this.indexMap.set(entry.scheduleId, idx);
  }

  private sinkDown(idx: number): void {
    const length = this.heap.length;
    const entry = this.heap[idx];

    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (
        left < length &&
        this.heap[left].nextRunAt < this.heap[smallest].nextRunAt
      ) {
        smallest = left;
      }
      if (
        right < length &&
        this.heap[right].nextRunAt < this.heap[smallest].nextRunAt
      ) {
        smallest = right;
      }
      if (smallest === idx) break;

      this.heap[idx] = this.heap[smallest];
      this.indexMap.set(this.heap[idx].scheduleId, idx);
      idx = smallest;
    }
    this.heap[idx] = entry;
    this.indexMap.set(entry.scheduleId, idx);
  }
}
