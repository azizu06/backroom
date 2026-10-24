export const OFFICE_ANCHORS = {
  lobby: { name: "Lobby", position: [-5, 3] as const, center: [-5, 2.9] as const, color: "#8c9c87" },
  collections: { name: "Collections", position: [-5, -1.8] as const, center: [-5, -3] as const, color: "#a9bc8f" },
  payables: { name: "Payables", position: [0, -1.8] as const, center: [0, -3] as const, color: "#bdac89" },
  vendor_onboarding: { name: "Vendor Desk", position: [5, -1.8] as const, center: [5, -3] as const, color: "#b2a3bb" },
  dana: { name: "Dana’s desk", position: [0, 2.2] as const, center: [0, 3.4] as const, color: "#cc9c7d" },
  treasury: { name: "Treasury", position: [5, 0.6] as const, center: [5, 3.4] as const, color: "#788b85" },
} as const;
export type AnchorId = keyof typeof OFFICE_ANCHORS;
/** Live rows carry free-form anchor strings; never index OFFICE_ANCHORS without this guard. */
export function isAnchorId(id: unknown): id is AnchorId {
  return typeof id === "string" && Object.hasOwn(OFFICE_ANCHORS, id);
}
/** Display name for an anchor, falling back to the raw id for unknown anchors. */
export function anchorLabel(id: string): string {
  return isAnchorId(id) ? OFFICE_ANCHORS[id].name : String(id);
}
export type SeatId = "collections" | "payables" | "vendor_onboarding";
export type FloorPosition = readonly [x: number, z: number];
export interface OfficeAgent {
  readonly id: string;
  readonly name: string;
  readonly seatId: SeatId;
  readonly targetAnchor: AnchorId;
  readonly pos: FloorPosition;
  readonly state: string;
  readonly escalationId?: string;
  readonly rowAt?: number;
}
export interface OfficeBadge {
  readonly seatId: SeatId;
  readonly policyVersion: number;
  readonly actions: readonly string[];
  readonly rooms: readonly string[];
  readonly limits: Readonly<Record<string, unknown>>;
}
export interface OfficeAudit {
  readonly id: string;
  readonly agentId: string;
  readonly seatId: string;
  readonly action: string;
  readonly decision: "ALLOW" | "DENY" | "ESCALATE" | "RECORDED";
  readonly ruleIds: readonly string[];
  readonly room?: AnchorId;
  readonly summary: string;
}
export interface OfficeDenial {
  readonly room: AnchorId;
  readonly agentId: string;
  readonly auditId: string;
  readonly at: number;
}
export interface OfficeSnapshot {
  readonly rooms?: readonly { id: AnchorId; rowId: string }[];
  readonly inboxReceipts?: readonly OfficeAudit[];
  readonly agents: readonly OfficeAgent[];
  readonly badges: readonly OfficeBadge[];
  readonly audit: readonly OfficeAudit[];
  readonly denials: readonly OfficeDenial[];
  readonly connection: "preview" | "connecting" | "live" | "disconnected" | "replay";
  readonly llmEnabled: boolean | null;
  readonly inboxCount: number;
}
/** Immutable cached row projection. No reducers, policy evaluation or business writes. */
export interface OfficeState {
  getSnapshot: () => OfficeSnapshot;
  subscribe: (listener: () => void) => () => void;
}
/** A door may flash only for the exact server denial's matching audit receipt. */
export function matchingDenial(snapshot: OfficeSnapshot, room: AnchorId) {
  return snapshot.denials.findLast(denial => denial.room === room && snapshot.audit.some(entry =>
    entry.id === denial.auditId && entry.agentId === denial.agentId && entry.room === room &&
    entry.action === "request_room_entry" && entry.decision === "DENY"));
}
export const INITIAL_OFFICE: OfficeSnapshot = {
  rooms: [], agents: [], badges: [], audit: [], denials: [], connection: "connecting", llmEnabled: null, inboxCount: 0,
};

/** Live semantic rooms must have a subscribed row; previews retain the fixture floor. */
export function visibleRooms(snapshot: OfficeSnapshot): AnchorId[] {
  return snapshot.rooms ? snapshot.rooms.map(row => row.id) : Object.keys(OFFICE_ANCHORS) as AnchorId[];
}
