/** Server-only Cartesia library catalog. Verified against GET /voices on 2026-10-24.
 * These are provider library voices (is_owner=false), never teammate clones. */
export const voices = {
  intake_sorter: { id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', name: 'Skylar', purpose: 'Approachable intake and triage' },
  extractor: { id: '47c38ca4-5f35-497b-b1a3-415245fb35e1', name: 'Daniel', purpose: 'Crisp, precise extraction' },
  vendor_verifier: { id: '62ae83ad-4f6a-430b-af41-a9bede9286ca', name: 'Gemma', purpose: 'Confident professional verification' },
  payables: { id: 'aa2cafe9-97ba-4052-ac3c-875000f95212', name: 'Zander', purpose: 'Measured financial guidance' },
  collections_caller: { id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', name: 'Jacqueline', purpose: 'Empathic customer conversations' },
  reconciler: { id: 'ef191366-f52f-447a-a398-ed8c0f2943a1', name: 'Archie', purpose: 'Warm, clear reconciliation updates' },
  auditor: { id: 'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1', name: 'Clive', purpose: 'Composed, articulate audit explanations' },
} as const;
export type HandoffRole = keyof typeof voices;
export const HANDOFF_MODEL = 'sonic-3.6-2026-08-27';
