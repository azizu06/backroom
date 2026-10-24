import { createGateway } from "./http";
import { MemoryGatewayStore } from "./store";

const seed = () => ({
  callId: "call-1",
  invoiceId: "inv-1",
  clientId: "client-1",
  contactName: "Jordan",
  companyName: "Northfield",
  amountCents: 10000,
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
    [{}, "ALLOW", "PLAN_ALLOWED"],
    [{ installments: 4 }, "ESCALATE", "MAX_INSTALLMENTS"],
  ])(
    "gates the negotiation through policy: %j -> %s",
    async (overrides, kind, rule) => {
      const call = seed();
      call.identityConfirmed = true;
      const store = new MemoryGatewayStore([call]);
      const decide = (call, plan) =>
        plan.waiveFee
          ? {
              kind: "DENY",
              ruleIds: ["FEES_NON_WAIVABLE"],
              reason: "ignored model-facing prose",
              policyVersion: 1,
            }
          : plan.installments > 2
            ? {
                kind: "ESCALATE",
                ruleIds: ["MAX_INSTALLMENTS"],
                reason: "untrusted prose",
                toHuman: "dana",
                policyVersion: 1,
              }
            : { kind: "ALLOW", ruleIds: ["PLAN_ALLOWED"], policyVersion: 1 };
      const gateway = createGateway({
        secret: () => "test-secret",
        store,
        decide,
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
      decide: () => ({
        kind: "ALLOW",
        ruleIds: ["PLAN_ALLOWED"],
        policyVersion: 1,
      }),
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
      decide: () => ({
        kind: "ALLOW",
        ruleIds: ["PLAN_ALLOWED"],
        policyVersion: 1,
      }),
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
      decide: () => ({
        kind: "ALLOW",
        ruleIds: ["PLAN_ALLOWED"],
        policyVersion: 1,
      }),
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
});
