export const OFFICE_ANCHORS = {
  collections: { name: "Collections", position: [-3, -1] as const },
  dana: { name: "Dana’s desk", position: [3, -1] as const },
} as const;

export type AnchorId = keyof typeof OFFICE_ANCHORS;
export type FloorPosition = readonly [x: number, z: number];

/** Projection of an agent row, not an authority to change it. */
export interface OfficeAgent {
  readonly id: string;
  readonly name: string;
  readonly seatId: string;
  readonly targetAnchor: AnchorId;
  /** Last server position; used when first mounting/catching up. */
  readonly pos: FloorPosition;
}

export interface OfficeSnapshot {
  readonly agent: OfficeAgent;
}

/** A T8 adapter caches immutable snapshots and notifies after row changes. */
export interface OfficeState {
  getSnapshot: () => OfficeSnapshot;
  subscribe: (listener: () => void) => () => void;
}

export const INITIAL_OFFICE: OfficeSnapshot = {
  agent: {
    id: "collections-clerk", name: "Alex", seatId: "collections",
    targetAnchor: "collections", pos: OFFICE_ANCHORS.collections.position,
  },
};

/** Demo-only producer. The renderer receives only the read-only OfficeState. */
export function createMockOfficeState() {
  let snapshot = INITIAL_OFFICE;
  const listeners = new Set<() => void>();
  const source: OfficeState = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    source,
    setTargetAnchor(targetAnchor: AnchorId) {
      if (targetAnchor === snapshot.agent.targetAnchor) return;
      snapshot = { agent: { ...snapshot.agent, targetAnchor } };
      listeners.forEach((listener) => listener());
    },
  };
}
