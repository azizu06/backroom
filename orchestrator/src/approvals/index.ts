export { ControllerApprovals, type ApprovalConfig } from './service';
export { parseControllerDecision, type ControllerDecision, type ApprovalTerms } from './types';
// Durable StateStore adapters consume this capability inside their trusted server boundary.
export { consumeVerifiedApproval, type VerifiedApproval } from './verified';
