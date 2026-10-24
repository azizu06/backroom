"""Offline acceptance checks for the shipped seed, not a live integration test.

Run with the PDF runtime's Python (reportlab + pypdf); no network or credentials.
"""
import hashlib
import json
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]


def read(root, path):
    return json.loads((root / path).read_text(encoding="utf-8"))


def normalized_steps(steps):
    normalized = []
    for step in steps:
        if step["verificationLayer"] == "policy":
            normalized.append(step["expected"])
        elif step["verificationLayer"] == "integration":
            normalized.append({"integrationOutcome": step["operation"]})
        else:
            raise AssertionError(f"unknown verification layer: {step['verificationLayer']}")
    return normalized


def validate(root=ROOT):
    seed = read(root, "company/northfield.json")
    assert seed["synthetic"] is True
    assert len(seed["vendors"]) == 25
    assert len(seed["clients"]) == len(seed["arInvoices"]) == 10
    vendors = {v["id"]: v for v in seed["vendors"]}
    invoices = {i["id"]: i for i in seed["apInvoices"]}
    pos = {p["id"]: p for p in seed["purchaseOrders"]}
    clients = {c["id"]: c for c in seed["clients"]}
    assert len(invoices) == len(seed["apInvoices"]), "duplicate invoice ID"
    assert len(vendors) == 25
    assert {i["issuedAt"][:7] for i in invoices.values()} == {"2026-07", "2026-08", "2026-09"}
    for invoice in invoices.values():
        assert invoice["vendorId"] in vendors
        assert invoice["amountCents"] == sum(x["quantity"] * x["unitPriceCents"] for x in invoice["lineItems"]) + invoice["adjustmentCents"]
        assert invoice["poMatched"] == (invoice["poId"] in pos)
        if invoice["poMatched"]:
            assert pos[invoice["poId"]]["vendorId"] == invoice["vendorId"]
            assert pos[invoice["poId"]]["amountCents"] == invoice["amountCents"]
        text = " ".join(page.extract_text() for page in PdfReader(root / invoice["rawRef"]).pages)
        assert invoice["id"] in text
        assert f'{invoice["amountCents"] / 100:,.2f}' in text
        email = (root / invoice["emailRef"]).read_text(encoding="utf-8")
        assert f'Invoice #{invoice["id"]}' in email
    assert invoices["4419"]["vendorId"] == invoices["4402"]["vendorId"] == "acme"
    assert invoices["4419"]["lineItems"] == invoices["4402"]["lineItems"]
    assert invoices["4419"]["amountCents"] - invoices["4402"]["amountCents"] == 3700
    assert invoices["4401"]["amountCents"] == 64000
    assert invoices["4482"]["amountCents"] == 340000
    assert invoices["4481"]["poMatched"] is False
    changes = {b["id"]: b for b in seed["bankChanges"]}
    assert changes["bc-lookalike"]["senderDomain"] == "acme-supp1y.com"
    assert vendors["acme"]["knownDomain"] == "acme-supply.com"
    assert changes["bc-legitimate"]["senderDomain"] == vendors[changes["bc-legitimate"]["vendorId"]]["knownDomain"]
    assert all(b["status"] == "pending" and b["approvedEscalationId"] is None for b in changes.values())
    for ar in seed["arInvoices"]:
        assert ar["clientId"] in clients
        assert ar["principalCents"] > 0 and ar["lateFeeCents"] >= 0
    for client in clients.values():
        consent = client["consent"]
        assert consent and all(consent[k] for k in ("source", "text", "timestamp", "number"))
        assert consent["number"] == client["phoneNumber"]
        assert client["dialable"] is False
    assert any(t["matchedRef"] == "ar_invoice:1041" for t in seed["bankTransactions"])
    already_paid = next(t for t in seed["bankTransactions"] if t["id"] == "seed-credit-1043")
    assert already_paid["amountCents"] == 76000 and already_paid["matchedRef"] is None
    short = next(t for t in seed["bankTransactions"] if t["id"] == "seed-short-1044")
    assert short["amountCents"] == 40000
    assert next(p for p in seed["paymentLinks"] if p["id"] == short["paymentLinkRef"])["amountCents"] == 50000
    duplicate_payments = [t for t in seed["bankTransactions"] if t.get("paymentLinkRef") == "link-duplicate-1045"]
    assert len(duplicate_payments) == 2 and len({t["id"] for t in duplicate_payments}) == 2
    assert sum(t["amountCents"] for t in duplicate_payments) == 232500
    assert any(t["matchedRef"] is None and t["direction"] == "credit" for t in seed["bankTransactions"])
    assert all(a["nessieId"] is None for a in seed["bankAccounts"])
    scenarios = read(root, "scenarios/payables.json")
    assert [s["id"] for s in scenarios] == [f"P{i:02}" for i in range(1, 13)]
    for scenario in scenarios:
        assert scenario["author"]["origin"] in ("team", "external")
        for step in scenario["steps"]:
            assert step["verificationLayer"] in ("policy", "integration")
            if "invoiceId" in step:
                assert step["invoiceId"] in invoices
    key = read(root, "answer-key/expected.json")
    assert key["policyVersion"] == 1
    assert {s["id"] for s in scenarios} == set(key["payables"])
    for scenario in scenarios:
        entry = key["payables"][scenario["id"]]
        assert entry.get("expectedSteps") == normalized_steps(scenario["steps"]), f"answer key payables {scenario['id']}"
        assert entry.get("requiredEvidence"), f"answer key payables {scenario['id']} required evidence"
        assert entry.get("evidenceRefs"), f"answer key payables {scenario['id']} evidence refs"
    assert key["signoff"]["status"] in ("pending", "approved")
    if key["signoff"]["status"] == "approved":
        assert key["signoff"]["signedAt"] and key["signoff"].get("evidenceRef")
    collections = read(root, "scenarios/collections.json")
    assert len(collections) == len({s["key"] for s in collections}) == 22
    assert [s["id"] for s in collections] == [f"C{i:02}" for i in range(1, 23)]
    assert [s["sourceScenarioId"] for s in collections] == [f"S{i:02}" for i in range(1, 23)]
    assert set(key["collections"]) == {s["id"] for s in collections}
    for scenario in collections:
        recorded = key["collections"][scenario["id"]].get("expectedSteps")
        assert recorded == normalized_steps(scenario["steps"]), f"answer key collections {scenario['id']}"
        assert key["collections"][scenario["id"]]["invoiceId"] == scenario["invoiceId"], f"answer key collections {scenario['id']}"
    assert all(s["invoiceId"] in {i["id"] for i in seed["arInvoices"]} for s in collections)
    lead = next(i for i in seed["arInvoices"] if i["id"] == "1042")
    assert (lead["principalCents"], lead["lateFeeCents"]) == (480000, 15000), "spec lead demo: invoice 1042 is $4,800 + $150"
    c01 = next(s for s in collections if s["id"] == "C01")
    full_payment = next(step["actionRequest"]["amountCents"] for step in c01["steps"] if step.get("actionRequest", {}).get("type") == "send_payment_link")
    assert full_payment == 495000, "C01 full payment is principal plus the non-waivable late fee"
    manifest = read(root, "answer-key/frozen-manifest.json")
    required = {
        "company/northfield.json",
        "scenarios/payables.json",
        "scenarios/collections.json",
        "answer-key/expected.json",
    }
    for invoice in invoices.values():
        required.add(invoice["rawRef"])
        required.add(invoice["emailRef"])
    for change in seed["bankChanges"]:
        required.add(change["rawRef"])
    assert set(manifest["sha256"]) == required, f"manifest entries {sorted(set(manifest['sha256']) ^ required)}"
    for path, expected in manifest["sha256"].items():
        assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, f"Frozen content changed: {path}"
    print(f'PASS: 25 vendors, {len(invoices)} AP invoices/PDFs/emails across 3 months, 10 AR/consents, P01-P12 + C01-C22, {len(manifest["sha256"])} frozen files')
    signoff = "APPROVED by triumph! for policy-decision eval run #1" if key["signoff"]["status"] == "approved" else "PENDING: owner signoff"
    print(f"{signoff}. PENDING: outside authorship target, live Nessie/CRS/reducer provisioning and integration scenarios")


def expect_reject(mutator, label, needle):
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "fixtures"
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns("__pycache__"))
        mutator(copy)
        try:
            validate(copy)
        except AssertionError as err:
            if needle not in str(err):
                raise SystemExit(f"NEGATIVE FAIL: {label} rejected for the wrong reason: {err}")
            print(f"NEGATIVE PASS: {label}")
            return
    raise SystemExit(f"NEGATIVE FAIL: {label} was accepted")


def write_and_rehash(copy, relative, value):
    target = copy / relative
    target.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n")
    manifest_path = copy / "answer-key" / "frozen-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sha256"][relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n")


def alter_collection_expectation(copy):
    key = read(copy, "answer-key/expected.json")
    key["collections"]["C01"]["expectedSteps"][0]["kind"] = "DENY"
    write_and_rehash(copy, "answer-key/expected.json", key)


def delete_collection_expectation(copy):
    key = read(copy, "answer-key/expected.json")
    key["collections"]["C01"]["expectedSteps"] = []
    write_and_rehash(copy, "answer-key/expected.json", key)


def delete_payables_evidence(copy):
    key = read(copy, "answer-key/expected.json")
    key["payables"]["P01"]["requiredEvidence"] = []
    write_and_rehash(copy, "answer-key/expected.json", key)


def drop_required_manifest_entry(copy):
    path = copy / "answer-key" / "frozen-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    del manifest["sha256"]["company/northfield.json"]
    path.write_text(json.dumps(manifest), encoding="utf-8")


def expect_replay_reject(mutator, label):
    import os
    import shutil
    import subprocess
    import tempfile

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise SystemExit("NEGATIVE FAIL: npm is not available for the replay check")
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "fixtures"
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns("__pycache__"))
        mutator(copy)
        env = os.environ.copy()
        env["FIXTURE_ROOT"] = str(copy)
        result = subprocess.run(
            [npm, "exec", "--yes", "--package=tsx", "--", "tsx", "fixtures/company/replay_policy.ts"],
            cwd=ROOT.parent,
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            raise SystemExit(f"NEGATIVE FAIL: {label} replay accepted the altered key")
    print(f"NEGATIVE PASS: {label}")


def run_negatives():
    expect_replay_reject(alter_collection_expectation, "replay rejects altered C01 key")
    expect_reject(alter_collection_expectation, "altered C01 key kind", "answer key")
    expect_reject(delete_collection_expectation, "deleted C01 key steps", "answer key")
    expect_reject(delete_payables_evidence, "deleted P01 required evidence", "required evidence")
    expect_reject(drop_required_manifest_entry, "missing manifest entry", "manifest")


if __name__ == "__main__":
    import sys

    if "--negatives" in sys.argv:
        run_negatives()
    else:
        validate()
        run_negatives()
