import { createGateway } from "./http";
import { MemoryGatewayStore } from "./store";
import { DEFAULT_POLICY, savePolicy } from "../../../policy/src/index";
import { MemoryStateStore } from "@backroom/orchestrator";

const seed = () => ({
  callId: "call-1",
  invoiceId: "inv-1",
  clientId: "client-1",
  contactName: "Jordan",
  companyName: "Northfield",
  amountCents: 10000,
  receivable: { principalCents: 9500, lateFeeCents: 500 },
  currency: "USD",
  policyVersion: 1,
  identityConfirmed: false,
  status: "active",
  audits: [],
  plans: [],
  escalations: [],
  links: [],
  outbox: [],
  deliveries: {},
});
const request = (body, token = "test-secret") =>
  new Request("https://example.test/api/tools/get_invoice_context", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("Cartesia tool gateway", () => {
  it("commits gateway evidence to the shared chain with the same citation id, once per delivery", async () => {
    const audit = new MemoryStateStore();
    await audit.setLlmEnabled(false);
    const store = new MemoryGatewayStore([seed()], audit);
    const gateway = createGateway({ secret: () => "test-secret", store });
    const body = { call_id: "call-1", webhook_request_id: "chained", result: "confirmed" };
    await gateway("verify_identity_result", request(body));
    await gateway("verify_identity_result", request(body));
    const [local] = await store.transact("call-1", call => call.audits);
    expect(await audit.getAudit(local.id)).toMatchObject({
      actor: "code", seat: "collections", action: "verify_identity_result", seq: 2,
      refs: ["call-1", "inv-1", "client-1"], inputs: { webhookRequestId: "chained", kind: "RECORDED" },
    });
    expect(await audit.listAudit()).toHaveLength(2);
    expect(await audit.verifyAuditChain()).toMatchObject({ valid: true, length: 2 });
  });

  it("withholds confirmation and rolls back the call if shared audit persistence fails", async () => {
    const call = { ...seed(), identityConfirmed: true };
    const store = new MemoryGatewayStore([call], { appendAudits: async () => { throw new Error("STORE_UNAVAILABLE"); } });
    const gateway = createGateway({ secret: () => "test-secret", store });
    const response = await gateway("propose_plan", request({ call_id: "call-1", webhook_request_id: "failed-audit",
      installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ can_confirm: false });
    expect(await store.transact("call-1", saved => ({ audits: saved.audits, plans: saved.plans, deliveries: saved.deliveries })))
      .toEqual({ audits: [], plans: [], deliveries: {} });
  });

  it("records deterministic gateway decisions as code", async () => {
    const store = new MemoryGatewayStore([seed()]);
    const gateway = createGateway({ secret: () => "test-secret", store });
    await gateway("verify_identity_result", request({ call_id: "call-1", webhook_request_id: "code-audit", result: "confirmed" }));
    const entries = await store.transact("call-1", call => call.audits);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.actor === "code")).toBe(true);
  });

  it("rejects a bad bearer before looking up invoice context", async () => {
    const gateway = createGateway({
      secret: () => "test-secret",
      store: new MemoryGatewayStore([seed()]),
    });
    expect(
      (
        await gateway(
          "get_invoice_context",
          request({ call_id: "call-1", webhook_request_id: "w1" }, "bad"),
        )
      ).status,
    ).toBe(401);
  });
  it("withholds invoice amounts until identity has been confirmed for this call", async () => {
    const gateway = createGateway({
      secret: () => "test-secret",
      store: new MemoryGatewayStore([seed()]),
    });
    const invoke = async (tool, args = {}, id = tool) => {
      const response = await gateway(
        tool,
        request({ call_id: "call-1", webhook_request_id: id, ...args }),
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const hidden = await invoke("get_invoice_context");
    expect(hidden).not.toHaveProperty("amount_cents");
    expect(hidden.can_confirm).toBe(false);
    expect(
      (
        await invoke("propose_plan", {
          installments: 2,
          first_payment_pct: 50,
          duration_days: 30,
          waive_fee: false,
          discount_pct: 0,
        })
      ).kind,
    ).toBe("DENY");
    await invoke("verify_identity_result", { result: "confirmed" });
    expect(
      await invoke("get_invoice_context", {}, "context-after-identity"),
    ).toMatchObject({ amount_cents: 10000 });
  });

  it.each([
    [{ waive_fee: true }, "DENY", "FEES_NON_WAIVABLE"],
    [{}, "ALLOW", "IN_BADGE"],
    [{ installments: 4 }, "ESCALATE", "MAX_INSTALLMENTS"],
  ])(
    "gates the negotiation through policy: %j -> %s",
    async (overrides, kind, rule) => {
      const call = seed();
      call.identityConfirmed = true;
      const store = new MemoryGatewayStore([call]);
      const gateway = createGateway({
        secret: () => "test-secret",
        store,
      });
      const response = await gateway(
        "propose_plan",
        request({
          call_id: "call-1",
          webhook_request_id: "proposal",
          installments: 2,
          first_payment_pct: 50,
          duration_days: 30,
          waive_fee: false,
          discount_pct: 0,
          ...overrides,
        }),
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({
        kind,
        can_confirm: kind === "ALLOW",
        rule_ids: [rule],
      });
      expect(result.speak).not.toMatch(/untrusted|ignored/);
      const saved = await store.transact("call-1", (call) => call);
      expect(saved.audits).toHaveLength(1);
      expect(saved.audits[0]).toMatchObject({ kind, ruleIds: [rule] });
      expect(saved.audits[0].decision).toMatchObject({
        kind,
        policyVersion: 1,
      });
      if (kind !== "ALLOW")
        expect(saved.audits[0].decision.quote.text).toEqual(expect.any(String));
      if (kind === "ALLOW") expect(result.audit_id).toBe(saved.audits[0].id);
      if (kind === "ESCALATE") expect(saved.escalations).toHaveLength(1);
      if (rule === "FEES_NON_WAIVABLE")
        expect(result.speak).toContain("cannot waive");
    },
  );

  it("ignores concurrent duplicate webhooks and rejects a reused ID with changed terms", async () => {
    const call = seed();
    call.identityConfirmed = true;
    const store = new MemoryGatewayStore([call]);
    const gateway = createGateway({
      secret: () => "test-secret",
      store,
    });
    const body = {
      call_id: "call-1",
      webhook_request_id: "retry",
      installments: 2,
      first_payment_pct: 50,
      duration_days: 30,
      waive_fee: false,
      discount_pct: 0,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        gateway("propose_plan", request(body)).then((r) => r.json()),
      ),
    );
    expect(results.filter((r) => r.can_confirm)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(7);
    expect((await store.transact("call-1", (c) => c.audits)).length).toBe(1);
    expect(
      (await gateway("propose_plan", request({ ...body, installments: 4 })))
        .status,
    ).toBe(409);
  });

  it("creates a payment-link outbox item only from a matching ALLOW plan and audit", async () => {
    const call = seed();
    call.identityConfirmed = true;
    const store = new MemoryGatewayStore([call]);
    const gateway = createGateway({
      secret: () => "test-secret",
      store,
    });
    const invoke = async (tool, args, id = tool) =>
      (
        await gateway(
          tool,
          request({ call_id: "call-1", webhook_request_id: id, ...args }),
        )
      ).json();
    expect(
      (await invoke("send_payment_link", { plan_id: "invented" })).can_confirm,
    ).toBe(false);
    const plan = await invoke("propose_plan", {
      installments: 2,
      first_payment_pct: 50,
      duration_days: 30,
      waive_fee: false,
      discount_pct: 0,
    });
    const sent = await invoke(
      "send_payment_link",
      { plan_id: plan.plan_id },
      "link",
    );
    expect(sent).toMatchObject({
      amount_cents: 5000,
      can_confirm: false,
      kind: "RECORDED",
    });
    const saved = await store.transact("call-1", (c) => c);
    expect(saved.links).toHaveLength(1);
    expect(saved.outbox).toMatchObject([
      { type: "send_payment_link", linkId: saved.links[0].id },
    ]);
    await store.transact("call-1", (c) => {
      c.audits = [];
    });
    expect(
      (
        await invoke(
          "send_payment_link",
          { plan_id: plan.plan_id },
          "missing-audit",
        )
      ).kind,
    ).toBe("DENY");
  });

  it.each([
    "mark_dispute",
    "record_opt_out",
    "request_human",
    "report_already_paid",
  ])(
    "honors %s even before identity and prevents further confirmations",
    async (tool) => {
      const store = new MemoryGatewayStore([seed()]);
      const gateway = createGateway({ secret: () => "test-secret", store });
      const response = await gateway(
        tool,
        request({ call_id: "call-1", webhook_request_id: tool }),
      );
      expect(await response.json()).toMatchObject({
        kind: "RECORDED",
        can_confirm: false,
      });
      const saved = await store.transact("call-1", (c) => c);
      expect(saved.status).not.toBe("active");
      expect(saved.audits).toHaveLength(1);
      expect(saved.outbox).toHaveLength(1);
    },
  );

  it("cannot confirm an approval supplied by voice or lacking a verified passkey", async () => {
    const call = seed();
    call.identityConfirmed = true;
    call.escalations.push({
      id: "e1",
      status: "approved",
      ruleIds: ["MAX_INSTALLMENTS"],
      toHuman: "dana",
    });
    const store = new MemoryGatewayStore([call]);
    const gateway = createGateway({ secret: () => "test-secret", store });
    const poll = () =>
      gateway(
        "check_approval",
        request({
          call_id: "call-1",
          webhook_request_id: crypto.randomUUID(),
          escalation_id: "e1",
        }),
      ).then((r) => r.json());
    expect(await poll()).toMatchObject({ kind: "PENDING", can_confirm: false });
    await store.transact("call-1", (c) => {
      c.escalations[0].method = "passkey";
    });
    expect(await poll()).toMatchObject({
      approval_status: "approved",
      can_confirm: false,
    });
    const forged = await gateway(
      "check_approval",
      request({
        call_id: "call-1",
        webhook_request_id: "forged",
        escalation_id: "e1",
        approved: true,
      }),
    );
    expect(forged.status).toBe(400);
  });

  it("deduplicates even prototype-shaped IDs without leaking results across calls", async () => {
    const call = seed();
    const other = { ...seed(), callId: "call-2" };
    const store = new MemoryGatewayStore([call, other]);
    const gateway = createGateway({ secret: () => "test-secret", store });
    const body = {
      call_id: "call-1",
      webhook_request_id: "__proto__",
      result: "confirmed",
    };
    await gateway("verify_identity_result", request(body));
    expect(
      await (await gateway("verify_identity_result", request(body))).json(),
    ).toMatchObject({ duplicate: true });
    expect(
      (
        await gateway(
          "verify_identity_result",
          request({ ...body, call_id: "call-2" }),
        )
      ).status,
    ).toBe(409);
    expect(await store.transact("call-2", (c) => c.identityConfirmed)).toBe(
      false,
    );
  });

  it.each([
    ["unknown", {}, 404],
    ["get_invoice_context", { amount_cents: 1 }, 400],
    ["verify_identity_result", { result: "yes" }, 400],
    [
      "propose_plan",
      {
        installments: 2.5,
        first_payment_pct: 50,
        duration_days: 30,
        waive_fee: false,
        discount_pct: 0,
      },
      400,
    ],
    [
      "propose_plan",
      {
        installments: 2,
        first_payment_pct: 50,
        duration_days: 30,
        waive_fee: "false",
        discount_pct: 0,
      },
      400,
    ],
    ["send_payment_link", { plan_id: "fake", amount_cents: 1 }, 400],
  ])(
    "validates typed %s input and refuses model supplied authority: %j",
    async (tool, args, status) => {
      const gateway = createGateway({
        secret: () => "test-secret",
        store: new MemoryGatewayStore([seed()]),
      });
      expect(
        (
          await gateway(
            tool,
            request({
              call_id: "call-1",
              webhook_request_id: "validation",
              ...args,
            }),
          )
        ).status,
      ).toBe(status);
    },
  );

  it("fails closed on missing configuration, malformed JSON and unknown calls", async () => {
    const store = new MemoryGatewayStore();
    const gateway = createGateway({ secret: () => "test-secret", store });
    expect(
      (
        await createGateway({ secret: () => undefined, store })(
          "get_invoice_context",
          request({}),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await gateway(
          "get_invoice_context",
          new Request("https://example.test", {
            method: "POST",
            headers: { authorization: "Bearer test-secret" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await gateway(
          "get_invoice_context",
          request({ call_id: "missing", webhook_request_id: "w" }),
        )
      ).status,
    ).toBe(404);
  });

  it("rolls back a failed state transaction before any confirmation is returned", async () => {
    const call = seed();
    call.identityConfirmed = true;
    const memory = new MemoryGatewayStore([call]);
    const store = {
      transact: (id, work) =>
        memory.transact(id, async (c) => {
          await work(c);
          throw new Error("commit failed");
        }),
    };
    const gateway = createGateway({
      secret: () => "test-secret",
      store,
    });
    const response = await gateway(
      "propose_plan",
      request({
        call_id: "call-1",
        webhook_request_id: "failed",
        installments: 2,
        first_payment_pct: 50,
        duration_days: 30,
        waive_fee: false,
        discount_pct: 0,
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ can_confirm: false });
    expect(await memory.transact("call-1", (c) => c.audits)).toEqual([]);
  });
  it("uses saved policy settings and rejects a stale version through the real adapter", async () => {
    const draft = structuredClone(DEFAULT_POLICY);
    draft.badges.collections.limits.maxInstallments = 3;
    const policy = savePolicy(DEFAULT_POLICY, draft);
    const call = seed();
    call.identityConfirmed = true;
    call.policyVersion = 2;
    call.policyState = { policy };
    const store = new MemoryGatewayStore([call]);
    const gateway = createGateway({ secret: () => "test-secret", store });
    const body = {
      call_id: "call-1",
      webhook_request_id: "saved-policy",
      installments: 3,
      first_payment_pct: 50,
      duration_days: 30,
      waive_fee: false,
      discount_pct: 0,
    };
    expect(
      await (await gateway("propose_plan", request(body))).json(),
    ).toMatchObject({ kind: "ALLOW", can_confirm: true });
    expect(
      await store.transact("call-1", (c) => c.audits[0].policyVersion),
    ).toBe(2);
    await store.transact("call-1", (c) => {
      c.policyVersion = 1;
    });
    expect(
      await (
        await gateway(
          "propose_plan",
          request({ ...body, webhook_request_id: "stale-policy" }),
        )
      ).json(),
    ).toMatchObject({
      kind: "DENY",
      can_confirm: false,
      rule_ids: ["INVALID_INPUT"],
    });
    expect(
      await store.transact("call-1", (c) => c.audits[1].policyVersion),
    ).toBe(2);
  });

  it("retains fees, rounds cents per policy, and rechecks fresh stop signals before queuing a link", async () => {
    const call = seed();
    call.identityConfirmed = true;
    call.amountCents = 11002;
    call.receivable = { principalCents: 10000, lateFeeCents: 1002 };
    const store = new MemoryGatewayStore([call]);
    const gateway = createGateway({ secret: () => "test-secret", store });
    const invoke = async (tool, args, id = tool) =>
      (
        await gateway(
          tool,
          request({ call_id: "call-1", webhook_request_id: id, ...args }),
        )
      ).json();
    const allowed = await invoke("propose_plan", {
      installments: 2,
      first_payment_pct: 51,
      duration_days: 30,
      waive_fee: false,
      discount_pct: 0,
    });
    expect(allowed.plan).toMatchObject({
      totalCents: 11002,
      firstPaymentCents: 5611,
    });
    expect(
      await invoke("send_payment_link", { plan_id: allowed.plan_id }),
    ).toMatchObject({ kind: "RECORDED", amount_cents: 5611 });
    await store.transact("call-1", (c) => {
      c.policyState = { signals: { bankruptcy: true } };
    });
    expect(
      await invoke(
        "send_payment_link",
        { plan_id: allowed.plan_id },
        "after-bankruptcy",
      ),
    ).toMatchObject({
      kind: "ESCALATE",
      can_confirm: false,
      rule_ids: ["BANKRUPTCY_STOP"],
    });
    expect(await store.transact("call-1", (c) => c.outbox)).toHaveLength(1);
  });
});
