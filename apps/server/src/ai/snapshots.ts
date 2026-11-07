import { LIMITS, validateDesignDoc, type DesignDoc } from '@poster/core';

export type Snapshot = {
  id: string;
  projectId: string;
  doc: DesignDoc;
  createdAt: number;
};

let counter = 0;

/**
 * In-memory snapshot store keyed by project id. Snapshots are always read back
 * through `validateDesignDoc`, so a corrupted entry can never reach a client.
 */
export class SnapshotStore {
  private readonly byId = new Map<string, Snapshot>();
  private readonly byProject = new Map<string, string[]>();

  constructor(
    private readonly maxPerProject: number = LIMITS.snapshots.maxPerProject,
    private readonly now: () => number = Date.now,
  ) {}

  save(projectId: string, doc: DesignDoc): Snapshot {
    counter += 1;
    const createdAt = this.now();
    const snapshot: Snapshot = {
      id: `snap-${createdAt.toString(36)}-${counter.toString(36)}`,
      projectId,
      doc: validateDesignDoc(doc),
      createdAt,
    };
    this.byId.set(snapshot.id, snapshot);

    const ids = [...(this.byProject.get(projectId) ?? []), snapshot.id];
    while (ids.length > this.maxPerProject) {
      const oldest = ids.shift();
      if (oldest) this.byId.delete(oldest);
    }
    this.byProject.set(projectId, ids);
    return snapshot;
  }

  get(id: string): Snapshot | null {
    const snapshot = this.byId.get(id);
    if (!snapshot) return null;
    return { ...snapshot, doc: validateDesignDoc(snapshot.doc) };
  }

  list(projectId: string): Snapshot[] {
    return (this.byProject.get(projectId) ?? [])
      .map((id) => this.get(id))
      .filter((snapshot): snapshot is Snapshot => snapshot !== null);
  }
}
