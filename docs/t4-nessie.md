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
