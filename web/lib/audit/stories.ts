import type { AuditEntry } from '@backroom/orchestrator';

/** View-only grouping of the audit chain into demo stories. It never changes or filters the record itself. */
export type StoryKind = 'startup' | 'call' | 'payment' | 'inbox' | 'other';
export type Proof = 'passkey' | 'deny' | 'match';
export type StoryLine = {
  entry: AuditEntry; who: string; text: string;
  outcome?: 'ALLOW' | 'DENY' | 'ESCALATE'; rule?: string; amount?: string; proof?: Proof;
};
export type Story = { id: string; kind: StoryKind; title: string; lines: StoryLine[]; total: number };

// Reducer and event plumbing: real evidence, but not a decision anyone needs to read in the demo.
const PLUMBING = new Set(['record_event', 'set_llm_enabled', 'heartbeat', 'lease_expired', 'task_resumed']);
const RUN_START = new Set(['seed_company', 'operator_reset']);
const INBOX = new Set(['judge_inbox_decision', 'route_inbox_item', 'submit_inbox_item', 'document_extracted',
  'inbox_classified', 'fields_extracted', 'extraction_routed', 'unrecognized_request']);
const PAYMENT = new Set(['reconcile', 'agent_reconciliation', 'nessie_completed', 'pay', 'payment_boundary_rejected']);
const EMAIL_FOLLOWUP = new Set(['email_followup_queued', 'email_followup_duplicate', 'email_followup_blocked']);
// Gateway tools, pre-call checks and approval lifecycle rows that belong to the call in progress.
const CALL = new Set(['office_call_requested', 'office_call_accepted', 'office_call_refused', 'CALL_PERMIT', 'CALL_BLOCKED_PRECALL',
  'can_call', 'credit_check', 'health_check', 'pre_call_permit', 'pre_call_blocked', 'pre_call_escalated', 'envelope', 'call_plan',
  'demo_pre_call_evidence', 'get_invoice_context', 'verify_identity_result', 'propose_plan', 'check_approval', 'send_payment_link',
  'mark_dispute', 'record_opt_out', 'request_human', 'report_already_paid', 'create_escalation', 'decide_escalation',
  'pending_owner', 'escalation_expired', 'collections_postcall_handoff', ...EMAIL_FOLLOWUP]);
const APPROVAL = new Set(['create_escalation', 'decide_escalation', 'pending_owner', 'escalation_expired']);
const MAX_LINES = 6;

export const isPlumbing = (entry: AuditEntry) => !entry.decision && (entry.action.startsWith('state.') || PLUMBING.has(entry.action));

/** The current demo run: everything since the latest Reset/seed, or the whole chain when none is recorded. */
export function currentRun(entries: readonly AuditEntry[]) {
  const start = entries.findLastIndex(entry => RUN_START.has(entry.action) && !(entry.inputs?.phase && entry.inputs.phase !== 'completed'));
  return start < 0 ? [...entries] : entries.slice(start);
}

const money = (cents: unknown) => typeof cents === 'number' && Number.isFinite(cents)
  ? (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : undefined;
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && value.length <= 80 ? value : undefined;
const words = (action: string) => {
  const plain = action.replace(/^state\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};
const invoiceOf = (entry: AuditEntry) => text(entry.inputs?.invoiceId) ?? entry.refs.find(ref => /^\d{4}$/.test(ref));
/** The demo host registers each client as `northfield-<first name>` (web/lib/demo/runtime.ts). */
const contactOf = (entry: AuditEntry) => {
  const ref = entry.refs.find(value => /^northfield-[a-z]+$/.test(value));
  return ref && ref.charAt(11).toUpperCase() + ref.slice(12);
};
const shortId = (id: string) => id.replace(/^judge:/, '').slice(0, 8);

function who(entry: AuditEntry) {
  if (entry.actor === 'human') return entry.seat === 'controller' ? 'Dana' : 'Human';
  return { code: 'Code', claude: 'Claude', local_model: 'Local model', client: 'Client', system: 'System' }[entry.actor];
}

function describe(entry: AuditEntry): string {
  const inputs = entry.inputs ?? {};
  const plan = record(inputs.plan);
  const decision = record(inputs.decision);
  const invoice = invoiceOf(entry);
  const outcome = entry.decision;
  switch (entry.action) {
    case 'seed_company': return 'Loaded the synthetic Northfield Studio company';
    case 'operator_reset': return 'Operator reset the demo company';
    case 'save_policy': return `Saved policy v${entry.policyVersion}`;
    case 'office_call_requested': return 'Collections desk phone asked for a call';
    case 'office_call_accepted': return 'Call placed to the allowlisted demo phone';
    case 'office_call_refused': return `Call not placed (${text(inputs.code) ?? 'refused'})`;
    case 'email_followup_queued': return `Email preview (simulated, not sent)${text(inputs.toDomain) ? ` · ${text(inputs.toDomain)}` : ''}`;
    case 'email_followup_duplicate': return `Email preview already queued today (simulated, not sent)${text(inputs.toDomain) ? ` · ${text(inputs.toDomain)}` : ''}`;
    case 'email_followup_blocked': return 'Email preview blocked';
    case 'CALL_PERMIT': case 'can_call': case 'pre_call_permit':
      return outcome === 'DENY' ? 'Pre-call checks blocked the call' : 'Pre-call checks allowed the call';
    case 'CALL_BLOCKED_PRECALL': case 'pre_call_blocked': return 'Call blocked before dialing';
    case 'credit_check': return 'Credit check before calling';
    case 'health_check': return 'Business health check before calling';
    case 'verify_identity_result': return 'Identity check recorded before any amount';
    case 'get_invoice_context': return `Read invoice ${invoice ?? ''} after identity`.replace('  ', ' ');
    case 'propose_plan': {
      const count = typeof plan.installments === 'number' ? `${plan.installments}-payment plan` : 'Payment plan';
      return `${count} proposed${outcome === 'ESCALATE' ? ', over the badge limit' : outcome === 'DENY' ? ', refused by policy' : ''}`;
    }
    case 'create_escalation': return 'Asked Dana to approve';
    case 'decide_escalation': {
      const kind = decision.kind === 'Approve' ? 'approved' : decision.kind === 'Deny' ? 'denied' : decision.kind === 'Counter' ? 'countered' : 'decided';
      return `Dana ${kind} with a passkey`;
    }
    case 'check_approval': return 'Checked Dana’s answer';
    case 'pending_owner': return 'No approval in time; left for the owner';
    case 'escalation_expired': return 'Approval window closed';
    case 'send_payment_link': return 'Sent the payment link';
    case 'mark_dispute': return 'Client disputed; collection paused';
    case 'record_opt_out': return 'Client opted out; calls stopped';
    case 'request_human': return 'Handed the call to a human';
    case 'report_already_paid': return 'Client said it was already paid';
    case 'reconcile': return entry.ruleIds.includes('EXACT_PAYMENT_MATCH')
      ? `Deposit matched invoice ${invoice ?? ''} exactly`.trimEnd() : 'No exact deposit match; held for review';
    case 'nessie_completed': return 'Sandbox bank transfer completed';
    case 'pay': return 'Client paid through the link';
    case 'judge_inbox_decision': {
      const kind = text(inputs.kind)?.replaceAll('_', ' ') ?? 'item';
      return outcome === 'DENY' ? `Inbox ${kind} refused` : outcome === 'ESCALATE' ? `Inbox ${kind} held for Dana` : `Inbox ${kind} checked`;
    }
    case 'route_inbox_item': return `Routed to ${words(text(inputs.routedSeat) ?? 'a desk')}`;
    case 'pay_invoice': return `Vendor payment${invoice ? ` for invoice ${invoice}` : ''}`;
  }
  if (entry.action.startsWith('operator_')) return `Operator: ${words(entry.action.slice(9)).toLowerCase()}`;
  return words(entry.action);
}

function proof(entry: AuditEntry): Proof | undefined {
  if (entry.action === 'decide_escalation' && entry.actor === 'human' && entry.route === 'passkey') return 'passkey';
  if (entry.action === 'reconcile' && entry.ruleIds.includes('EXACT_PAYMENT_MATCH')) return 'match';
  if (entry.decision === 'DENY') return 'deny';
}

function line(entry: AuditEntry): StoryLine {
  const inputs = entry.inputs ?? {};
  const amount = money(inputs.amountCents) ?? money(record(inputs.decision).amountCents);
  return { entry, who: who(entry), text: describe(entry), ...(entry.decision && { outcome: entry.decision }),
    ...(entry.ruleIds[0] && { rule: entry.ruleIds.length > 1 ? `${entry.ruleIds[0]} +${entry.ruleIds.length - 1}` : entry.ruleIds[0] }),
    ...(amount && { amount }), ...(proof(entry) && { proof: proof(entry) }) };
}

/** Keep proof rows, then decisions, then the opener; show them in recorded order. */
function pick(lines: StoryLine[]) {
  if (lines.length <= MAX_LINES) return lines;
  const rank = (l: StoryLine, i: number) => l.proof ? 0 : l.outcome ? 1 : i === 0 ? 2 : 3;
  const keep = new Set(lines.map((l, i) => ({ i, r: rank(l, i) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, MAX_LINES).map(x => x.i));
  return lines.filter((_, i) => keep.has(i));
}

type Draft = { id: string; kind: StoryKind; entries: AuditEntry[] };

function title(draft: Draft) {
  const all = draft.entries;
  switch (draft.kind) {
    case 'startup': return 'Startup';
    case 'call': {
      const contact = all.map(contactOf).find(Boolean);
      const invoice = all.map(invoiceOf).find(Boolean);
      return contact ? `Call with ${contact}` : invoice ? `Call about invoice ${invoice}` : 'Collections call';
    }
    case 'payment': {
      const match = all.find(entry => entry.action === 'reconcile' && entry.ruleIds.includes('EXACT_PAYMENT_MATCH'));
      if (!match) return all.some(entry => entry.action === 'reconcile') ? 'Payment held for review' : 'Payment in progress';
      const amount = money(match.inputs?.amountCents);
      const invoice = invoiceOf(match);
      return amount ? `Payment ${amount} reconciled` : `Payment for invoice ${invoice ?? ''} reconciled`.replace('  ', ' ');
    }
    case 'inbox': return `Inbox item ${shortId(draft.id.slice(6))}`;
    case 'other': return 'Other activity';
  }
}

/** Groups the current run into stories, newest story first; lines inside a story stay in recorded order. */
export function auditStories(entries: readonly AuditEntry[]): Story[] {
  const drafts: Draft[] = [];
  const byId = new Map<string, Draft>();
  const open = (id: string, kind: StoryKind) => {
    let draft = byId.get(id);
    if (!draft) { draft = { id, kind, entries: [] }; drafts.push(draft); byId.set(id, draft); }
    return draft;
  };
  const run = currentRun(entries);
  // An escalation's rows (raised, Dana's passkey decision, expiry) join the story that raised it.
  // Inbox items cite their escalation id, sometimes after the escalation row itself.
  const escalations = new Set(run.filter(entry => entry.action === 'create_escalation').map(entry => entry.refs[0]));
  const inboxOf = new Map<string, string>();
  for (const entry of run) if (INBOX.has(entry.action))
    for (const ref of entry.refs) if (escalations.has(ref)) inboxOf.set(ref, `inbox:${entry.refs[0]}`);
  const owner = new Map<string, Draft>();
  let call: Draft | undefined, lastCall: Draft | undefined, payment: Draft | undefined, calls = 0, payments = 0;
  for (const entry of run) {
    if (isPlumbing(entry)) continue;
    const { action } = entry;
    const callLike = CALL.has(action) && entry.seat !== 'payables' && entry.seat !== 'vendor_onboarding';
    const escalation = APPROVAL.has(action) ? entry.refs[0] ?? '' : '';
    let draft: Draft;
    if (inboxOf.has(escalation)) draft = open(inboxOf.get(escalation)!, 'inbox');
    else if (owner.has(escalation)) draft = owner.get(escalation)!;
    else if (INBOX.has(action)) draft = open(`inbox:${entry.refs[0] ?? entry.id}`, 'inbox');
    else if (PAYMENT.has(action)) {
      draft = payment ??= open(`payment:${++payments}`, 'payment');
      if (action === 'reconcile') payment = undefined;
    } else if (EMAIL_FOLLOWUP.has(action) && lastCall) draft = lastCall;
    else if (action === 'office_call_requested' || (callLike && !call)) draft = lastCall = call = open(`call:${++calls}`, 'call');
    else if (callLike || (call && entry.seat === 'collections')) draft = call!;
    else draft = drafts.some(d => d.kind !== 'startup') ? open('other', 'other') : open('startup', 'startup');
    draft.entries.push(entry);
    if (action === 'create_escalation' && entry.refs[0]) owner.set(entry.refs[0], draft);
    if (action === 'office_call_refused') call = undefined;
  }
  return drafts.map(draft => ({ id: draft.id, kind: draft.kind, title: title(draft), total: draft.entries.length,
    lines: pick(draft.entries.map(line)) })).reverse();
}

/** A question the Ask-why retriever can ground: invoice numbers match exactly, otherwise words match the record. */
export function whyQuestion(entry: AuditEntry) {
  const invoice = invoiceOf(entry);
  const kind = INBOX.has(entry.action) && text(entry.inputs?.kind);
  const subject = invoice ? `invoice ${invoice}` : kind ? `the ${kind.replaceAll('_', ' ')} inbox item` : `the ${words(entry.action).toLowerCase()}`;
  const rule = entry.ruleIds[0] ? ` under ${entry.ruleIds[0]}` : '';
  const verb = { ALLOW: 'allowed', DENY: 'denied', ESCALATE: 'escalated to Dana' }[entry.decision ?? 'ALLOW'];
  return `Why was ${subject} ${entry.decision ? verb : 'recorded'}${rule}?`;
}
