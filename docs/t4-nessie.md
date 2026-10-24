# T4: Nessie = sandbox bank

FAIL — live API checked 2026-10-24T07:41:25.087Z.

Host: https://prod-api.nessieisreal.com. Source: [official docs](https://prod.nessieisreal.com/docs), [OpenAPI](https://prod.nessieisreal.com/nessie-openapi-spec.yaml). The legacy api.nessieisreal.com host returned 403.

Northfield Studio customer and checking account seeded twice with identical IDs. Deposit: $2.00; balance read from GET /accounts/<id>: $0 → $0. This run reused the prior proof deposit. Replay returned the same deposit ID; transaction feed contains it. All IDs below redacted.

## Initial write observations

The initial setup created a Northfield Studio customer with POST /customers and a
zero-balance Checking account with POST /customers/<id>/accounts. Repeating the
seed returned the same customer/account IDs. These first-write timings were not
retained; the rerun below captures GET response shapes and timings, not invented
POST timing evidence.

POST /accounts/<id>/deposits initially submitted amount 1.25 with medium `balance`,
status `completed`, transaction_date `2026-10-24` and an invoice/installment memo.
GET returned amount **1** (fraction truncated), and balance remained **0**. A second,
distinct whole-dollar proof reference submitted amount **2**, persisted as **2**,
and balance again remained **0**. The fractional attempt is now forbidden by the
client. Both are sandbox artifacts; no cleanup/delete was performed.

GET /accounts/<id>/transfers returned 404; the exported feed uses supported deposits
and withdrawals. IDs are UUID strings despite the published 24-character schema.
T4's balance-increase bar is **not met**. M7 must treat this as an exception, not
mark a payment reconciled. No fallback bank has been added in this issue.

## Requests and response shapes

Timings are client-observed milliseconds including JSON parsing. Query authentication omitted.

```json
[
  {
    "method": "GET",
    "path": "/customers",
    "status": 200,
    "elapsedMs": 305,
    "shape": [
      {
        "last_name": "Studio",
        "first_name": "Northfield",
        "_id": "<redacted>",
        "address": {
          "city": "Berkeley",
          "state": "CA",
          "street_name": "Sandbox Way",
          "street_number": "1",
          "zip": "94704"
        }
      }
    ]
  },
  {
    "method": "GET",
    "path": "/customers/<id>/accounts",
    "status": 200,
    "elapsedMs": 322,
    "shape": [
      {
        "_id": "<redacted>",
        "type": "Checking",
        "nickname": "Northfield Studio Checking (Nessie = sandbox bank)",
        "rewards": 0,
        "balance": 0,
        "account_number": "<redacted>",
        "customer_id": "<redacted>"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/customers",
    "status": 200,
    "elapsedMs": 186,
    "shape": [
      {
        "last_name": "Studio",
        "first_name": "Northfield",
        "_id": "<redacted>",
        "address": {
          "city": "Berkeley",
          "state": "CA",
          "street_name": "Sandbox Way",
          "street_number": "1",
          "zip": "94704"
        }
      }
    ]
  },
  {
    "method": "GET",
    "path": "/customers/<id>/accounts",
    "status": 200,
    "elapsedMs": 120,
    "shape": [
      {
        "_id": "<redacted>",
        "type": "Checking",
        "nickname": "Northfield Studio Checking (Nessie = sandbox bank)",
        "rewards": 0,
        "balance": 0,
        "account_number": "<redacted>",
        "customer_id": "<redacted>"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/customers/<id>",
    "status": 200,
    "elapsedMs": 131,
    "shape": {
      "last_name": "Studio",
      "first_name": "Northfield",
      "_id": "<redacted>",
      "address": {
        "city": "Berkeley",
        "state": "CA",
        "street_name": "Sandbox Way",
        "street_number": "1",
        "zip": "94704"
      }
    }
  },
  {
    "method": "GET",
    "path": "/accounts/<id>",
    "status": 200,
    "elapsedMs": 111,
    "shape": {
      "_id": "<redacted>",
      "type": "Checking",
      "nickname": "Northfield Studio Checking (Nessie = sandbox bank)",
      "rewards": 0,
      "balance": 0,
      "account_number": "<redacted>",
      "customer_id": "<redacted>"
    }
  },
  {
    "method": "GET",
    "path": "/accounts/<id>/deposits",
    "status": 200,
    "elapsedMs": 172,
    "shape": [
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 2,
        "description": "backroom:invoice=T4-whole-dollar-2026-10-24:installment=1"
      },
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 1,
        "description": "backroom:invoice=T4-proof-2026-10-24:installment=1"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/<id>/deposits",
    "status": 200,
    "elapsedMs": 106,
    "shape": [
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 2,
        "description": "backroom:invoice=T4-whole-dollar-2026-10-24:installment=1"
      },
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 1,
        "description": "backroom:invoice=T4-proof-2026-10-24:installment=1"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/<id>/deposits",
    "status": 200,
    "elapsedMs": 106,
    "shape": [
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 2,
        "description": "backroom:invoice=T4-whole-dollar-2026-10-24:installment=1"
      },
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 1,
        "description": "backroom:invoice=T4-proof-2026-10-24:installment=1"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/<id>",
    "status": 200,
    "elapsedMs": 127,
    "shape": {
      "_id": "<redacted>",
      "type": "Checking",
      "nickname": "Northfield Studio Checking (Nessie = sandbox bank)",
      "rewards": 0,
      "balance": 0,
      "account_number": "<redacted>",
      "customer_id": "<redacted>"
    }
  },
  {
    "method": "GET",
    "path": "/accounts/<id>/deposits",
    "status": 200,
    "elapsedMs": 204,
    "shape": [
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 2,
        "description": "backroom:invoice=T4-whole-dollar-2026-10-24:installment=1"
      },
      {
        "_id": "<redacted>",
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "completed",
        "amount": 1,
        "description": "backroom:invoice=T4-proof-2026-10-24:installment=1"
      }
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/<id>/withdrawals",
    "status": 200,
    "elapsedMs": 337,
    "shape": []
  }
]
```


## Status and transaction variants (follow-up)

Checked 2026-10-24T08:18:27.170Z using the same real sandbox key. These bounded probes did not produce
a bank balance update. This is an observed limitation of the current host, not a
claim that an unobserved future batch process can never run.

| Probe | Result | Account balance read back |
| --- | --- | --- |
| Earlier completed deposits, about 38 minutes after creation | Still completed, amounts 1 and 2 | Northfield checking 0 |
| POST a new balance deposit, amount 3, status pending | 201; provider echoed pending | Northfield checking 0 |
| PUT /deposits/<id>, status completed | 202; GET confirmed completed | Northfield checking 0 |
| POST a separate Checking account with opening balance 100 | 201; GET confirmed opening balance | Source account 100 |
| POST /accounts/<source>/transfers using earlier official SDK fields | 400; medium and payee_id rejected as extra fields | Source 100, Northfield 0 |
| POST /accounts/<source>/purchases, amount 1, status pending | 201; purchase persisted | Source 100 |
| PUT /purchase/<id>, status completed | 400; status rejected as extra field | Source 100, Northfield 0 |

The current [published OpenAPI](https://prod.nessieisreal.com/nessie-openapi-spec.yaml)
documents deposit updates and the singular purchase-update route. It has no transfer
creation schema; the transfer body came from the
[official earlier SDK](https://github.com/nessieisreal/nessie-javascript-sdk/blob/master/lib/transfer.js)
and purchase fields from its
[purchase module](https://github.com/nessieisreal/nessie-javascript-sdk/blob/master/lib/purchase.js).
Their contract disagrees with the current server validators; no additional fields
were guessed. No mutation was automatically retried. Durable one-time claims keep
repeat probe invocations from issuing those writes again.

### Explicit display contract for M7

`readBalance(accountId)` still returns the actual API account balance, **0**.
`readBalanceWithPostedDeposits(accountId)` returns separate components and the label:

> Nessie account balance + Nessie-reported posted deposits

At this check: **$0 + $6 = $6**. The completed balance deposits read from Nessie are
1, 2, and 3 dollars; pending, cancelled and rewards deposits are excluded. Both
inputs come from GET responses, with no local ledger or cached amount input.
The result includes the deposit IDs for traceability; evidence here redacts them.
Duplicate posted IDs or invalid amounts are rejected.

This is an explicitly named sandbox display formula, **not the provider's account
balance, available funds, or a reconciliation/settlement signal**. It does not
subtract withdrawals. It is appropriate only for this observed sandbox behavior;
if Nessie begins applying deposits to account.balance, adding them again would
double-count. The caller must explicitly select the formula; the bank balance API
is never silently replaced.

Devpost wording: “We create real transactions in Capital One's Nessie sandbox.
The hosted sandbox returned completed deposits without updating its account balance
in our tests. Our demo separately labels ‘Nessie account balance + Nessie-reported
posted deposits,’ computed entirely from data read back from Nessie.”

**T4 remains FAIL under the original balance-increase acceptance bar.** This
follow-up enables the authorized honest display; it does not turn the gate green.
The pending→completed diagnostic deposit and source account/merchant/purchase are
sandbox test artifacts, separate from live payment-plan authorization.

### Follow-up write timings and redacted response shapes

Milliseconds are client-observed request + JSON parsing. Each mutation below was
attempted once; subsequent invocations only read existing resources.

```json
[
  {
    "method": "POST",
    "path": "/accounts/<id>/deposits",
    "body": {
      "medium": "balance",
      "status": "pending",
      "transaction_date": "2026-10-24",
      "amount": 3,
      "description": "backroom:T4-status-variant-2026-10-24"
    },
    "status": 201,
    "elapsedMs": 130,
    "response": {
      "code": 201,
      "message": "Deposit created",
      "objectCreated": {
        "medium": "balance",
        "transaction_date": "2026-10-24",
        "status": "pending",
        "amount": 3,
        "description": "backroom:T4-status-variant-2026-10-24",
        "_id": "<redacted>",
        "creation_date": "2026-10-24"
      }
    }
  },
  {
    "method": "PUT",
    "path": "/deposits/<id>",
    "body": {
      "status": "completed"
    },
    "status": 202,
    "elapsedMs": 140,
    "response": {
      "code": 202,
      "message": "Accepted deposit update",
      "objectUpdated": {
        "amount": 3,
        "medium": "balance",
        "description": "backroom:T4-status-variant-2026-10-24",
        "status": "completed",
        "creation_date": "2026-10-24",
        "_id": "<redacted>",
        "transaction_date": "2026-10-24"
      }
    }
  },
  {
    "method": "POST",
    "path": "/customers/<id>/accounts",
    "body": {
      "type": "Checking",
      "nickname": "Northfield T4 Variant Source (Nessie = sandbox bank)",
      "rewards": 0,
      "balance": 100
    },
    "status": 201,
    "elapsedMs": 145,
    "response": {
      "code": 201,
      "message": "Account created",
      "objectCreated": {
        "type": "Checking",
        "nickname": "Northfield T4 Variant Source (Nessie = sandbox bank)",
        "rewards": 0,
        "balance": 100,
        "_id": "<redacted>",
        "account_number": "<redacted>",
        "customer_id": "<redacted>"
      }
    }
  },
  {
    "method": "POST",
    "path": "/accounts/<id>/transfers",
    "body": {
      "medium": "balance",
      "payee_id": "<redacted>",
      "amount": 1,
      "transaction_date": "2026-10-24",
      "status": "completed",
      "description": "T4 transfer probe"
    },
    "status": 400,
    "elapsedMs": 106,
    "response": "2 validation errors for TransferCreate\nmedium\n  extra fields not permitted (type=value_error.extra)\npayee_id\n  extra fields not permitted (type=value_error.extra)"
  },
  {
    "method": "POST",
    "path": "/merchants",
    "body": {
      "name": "Northfield T4 Probe Merchant"
    },
    "status": 201,
    "elapsedMs": 132,
    "response": {
      "code": 201,
      "message": "Merchant created",
      "objectCreated": {
        "name": "Northfield T4 Probe Merchant",
        "_id": "<redacted>"
      }
    }
  },
  {
    "method": "POST",
    "path": "/accounts/<id>/purchases",
    "body": {
      "merchant_id": "<redacted>",
      "medium": "balance",
      "purchase_date": "2026-10-24",
      "amount": 1,
      "status": "pending",
      "description": "T4 purchase probe"
    },
    "status": 201,
    "elapsedMs": 106,
    "response": {
      "code": 201,
      "message": "Purchase created",
      "objectCreated": {
        "merchant_id": "<redacted>",
        "medium": "balance",
        "purchase_date": "2026-10-24",
        "amount": 1,
        "status": "pending",
        "description": "T4 purchase probe",
        "_id": "<redacted>",
        "type": "merchant",
        "payer_id": "<redacted>"
      }
    }
  },
  {
    "method": "PUT",
    "path": "/purchase/<id>",
    "body": {
      "status": "completed"
    },
    "status": 400,
    "elapsedMs": 104,
    "response": "1 validation error for PurchaseUpdate\nstatus\n  extra fields not permitted (type=value_error.extra)"
  }
]
```
