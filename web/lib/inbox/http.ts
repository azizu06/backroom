import { createHash, randomUUID } from 'node:crypto';
import { createNorthfieldRepository, getStateStore, PayablesSeat, processInbox, VendorSeat,
  type InboxOptions, type InvoiceFields, type StateStore, type VendorFields } from '@backroom/orchestrator';

import { narrateInbox, type InboxNarration } from '../demo/agents';
import { noteEscalation } from '../approvals/inbox';

import { createInboxVendorGate } from './checks';
import { matchPreset, presetFields } from './presets';
import { rememberInboxProposal } from './proposals';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const LIMIT = 4 * 1024 * 1024;

/** Public synthetic judge intake. No payment adapter. Vendor checks follow DEMO_LIVE; a passkey applies a bank change. */
export function createInboxHTTP(options: { store?: () => StateStore; modelRoute?: InboxOptions['modelRoute']; agents?: (input: InboxNarration) => Promise<unknown>; origin?: () => string | undefined; env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}) {
  const origin = options.origin ?? (() => process.env.DEMO_PUBLIC_URL || process.env.WEBAUTHN_ORIGIN);
  return async (request: Request) => {
    // Compare the browser Origin with the deployment origin. Next rewrites request.url
    // (127.0.0.1 becomes localhost; a tunnel can gain an explicit port) and Host is not a source of truth.
    const allowed = origin();
    if (!allowed || request.headers.get('origin') !== allowed) return json({ error: 'Origin rejected.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return json({ error: 'Use the inbox form.' }, 415);
    if (Number(request.headers.get('content-length')) > LIMIT + 64000) return json({ error: 'Attachment must be 4 MB or smaller.' }, 413);
    let form: FormData;
    try {
      // Bound the entire body even for chunked uploads without Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Empty submission.' }, 400);
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > LIMIT + 64000) { await reader.cancel(); return json({ error: 'Submission too large.' }, 413); }
        chunks.push(chunk.value);
      }
      form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
    } catch { return json({ error: 'Could not read the submission.' }, 400); }
    const text = form.get('text'), kind = form.get('kind'), sender = form.get('senderDomain');
    if (typeof text !== 'string' || text.length > 32000 || !['email', 'invoice'].includes(String(kind)) ||
        typeof sender !== 'string' || sender.length > 253) return json({ error: 'Check the document type, sender domain, and text (32,000 characters maximum).' }, 400);
    const upload = form.get('attachment');
    if (upload && !(upload instanceof File)) return json({ error: 'Invalid attachment.' }, 400);
    const file = upload instanceof File && upload.size ? upload : undefined;
    if (file && (file.size > LIMIT || !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type))) return json({ error: 'Choose a PDF, PNG, JPEG, or WebP up to 4 MB.' }, 400);
    if (!text.trim() && !file) return json({ error: 'Type a scenario or choose an attachment.' }, 400);
    try {
      const state = (options.store ?? getStateStore)();
      const fileBytes = file ? Buffer.from(await file.arrayBuffer()) : undefined;
      const id = `judge:${randomUUID()}`;
      let seat: 'payables' | 'vendor_onboarding' = 'payables';
      let fields: InvoiceFields | VendorFields | null = null;
      const controller: InboxOptions['controller'] = { async request(decision, refs) {
        const escalation = await state.createCallEscalation({ id: `review:${id}`, taskId: id,
          fromAgent: `intake:${id}`, seat, toHuman: decision.toHuman, ruleIds: decision.ruleIds,
          evidenceRefs: refs, policyVersion: decision.policyVersion, quote: decision.quote }, Date.now());
        return escalation.id;
      } };
      const repository = await createNorthfieldRepository();
      const shared = { state, controller, repository };
      const payables = new PayablesSeat(shared);
      const gate = createInboxVendorGate(options.env ?? process.env, options.fetch);
      const vendor = new VendorSeat({ ...shared, checks: gate.checks, bankChangeRisk: gate.risk });
      const preset = !file && matchPreset(form.get('presetId'), String(kind), sender, text);
      if (preset && preset.id === '4419') {
        // P02's frozen precondition isolates the duplicate from Acme's independent bank-change trap.
        const vendor = await repository.getVendor('acme');
        if (vendor) await repository.saveVendor({ ...vendor, pendingBankChange: false });
      }
      const source = { id, source: 'judge' as const, senderDomain: sender.trim().toLowerCase() };
      const seeded = preset ? presetFields(preset) : undefined;
      if (seeded) { fields = seeded; seat = seeded.kind === 'invoice' ? 'payables' : 'vendor_onboarding'; }
      const result = seeded ? seeded.kind === 'invoice' ? await payables.process(seeded, source) : await vendor.propose(seeded, source) : await processInbox({ id, source: 'judge', kind: kind as 'email' | 'invoice',
        senderDomain: sender.trim().toLowerCase(), text, ...(file && fileBytes ? { attachment: { mediaType: file.type, bytes: fileBytes } } : {}) }, {
        state, controller, modelRoute: options.modelRoute,
        payables: { process: async (value, source) => { fields = value; seat = 'payables'; return payables.process(value, source); } },
        vendor: { propose: async (value, source) => { fields = value; seat = 'vendor_onboarding'; return vendor.propose(value, source); } },
      });
      if (result.escalationId && result.status === 'awaiting_controller' && fields?.kind === 'bank_change') {
        noteEscalation(result.escalationId);
        rememberInboxProposal(result.escalationId, { seat: vendor, repository, vendorId: fields.vendorId, proposalId: id });
      }
      const attachment = file ? { name: file.name.slice(0, 200), type: file.type, size: file.size,
        sha256: createHash('sha256').update(fileBytes!).digest('hex') } : null;
      const entry = await state.appendAudit({ ts: Date.now(), actor: 'code', seat, action: 'judge_inbox_decision',
        decision: result.decision.kind, ruleIds: result.decision.ruleIds, policyVersion: result.decision.policyVersion,
        refs: [id, ...result.evidenceRefs, ...(result.escalationId ? [result.escalationId] : [])], route: 'code', latencyMs: 0, costUsd: 0,
        inputs: { scenario_source: 'judge', extractionSource: seeded ? 'seed' : fields ? 'model' : 'unrecognized', decision: result.decision, fields, attachment,
          text, senderDomain: sender, kind, attachmentParsed: !!file && !!fields } });
      // Narration is outside the decision boundary: it cannot change, delay or fail this response.
      try {
        void (options.agents ?? narrateInbox)({ item: { ...source, kind: kind as 'email' | 'invoice', text },
          fields, repository, result, auditId: entry.id }).catch(() => {});
      } catch { /* A synchronous adapter failure also leaves the recorded decision intact. */ }
      const documentRoute = 'documentRoute' in result ? result.documentRoute : null;
      const documentModelAttempted = 'documentModelAttempted' in result && result.documentModelAttempted;
      return json({ attachmentParsed: !!file && !!fields, documentRoute: documentRoute ?? null, id, scenario_source: 'judge', seat, fields, ...result, attachment,
        extractionSource: seeded ? 'seed' : fields ? 'model' : 'unrecognized',
        notice: file ? fields ? `Attachment extracted (${documentRoute ?? 'model'}). Code policy decided the receipt. No bank debit is configured. File bytes are not retained.${documentRoute === 'cloud_fallback' ? ' Cloud fallback received document images after two local schema failures.' : ''}` : `Attachment could not be safely extracted; held for human review. File bytes are not retained.${documentModelAttempted ? ' Cloud fallback may have received document images after two local schema failures.' : ''}`
          : gate.simulated
            ? 'Synthetic Northfield company. CRS, OFAC, and Apify checks are simulated fixtures. No bank debit. A bank-account change is applied only after Dana’s passkey.'
            : 'CRS, OFAC, and Apify use the configured live clients. An unknown or missing check is not verified. No bank debit. A bank-account change is applied only after Dana’s passkey.',
        auditId: entry.id, auditHref: `/audit?entry=${encodeURIComponent(entry.id)}#audit-replay`,
        ...(result.escalationId ? { approvalHref: `/approve/${encodeURIComponent(result.escalationId)}` } : {}) });
    } catch { return json({ error: 'Intake could not record a decision. Try again; no payment was submitted.' }, 503); }
  };
}
