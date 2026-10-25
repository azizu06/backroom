"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DbConnection } from "../../lib/spacetime";
import type { Agent } from "../../lib/spacetime/types";

// T8 diagnostic: a subscriber only. No browser token can write agent rows.
export default function T8Page() {
  const [rows, setRows] = useState<Agent[]>([]);
  const [status, setStatus] = useState("connecting");
  const [samples, setSamples] = useState<{ target: string; latencyMs: number }[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const connection = DbConnection.builder()
      .withUri(process.env.NEXT_PUBLIC_SPACETIME_URI || "ws://127.0.0.1:3108")
      .withDatabaseName(process.env.NEXT_PUBLIC_SPACETIME_DATABASE || "backroom-t8-validation")
      .withAutomaticReconnect()
      .onConnect(conn => {
        const refresh = () => setRows(Array.from(conn.db.agent.iter()));
        conn.db.agent.onInsert(refresh);
        conn.db.agent.onUpdate(refresh);
        conn.db.agent.onDelete(refresh);
        conn.subscriptionBuilder()
          .onApplied(() => {
            // Exclude historical rows replayed in an initial/reconnect snapshot.
            for (const row of conn.db.agent.iter()) {
              seen.current.add(`${row.id}:${row.heartbeatAt.microsSinceUnixEpoch}`);
            }
            refresh(); setStatus("subscribed");
          })
          .onError(ctx => setStatus(`subscription error: ${ctx.event?.message ?? "unknown"}`))
          .subscribe("SELECT * FROM agent");
      })
      .onConnectError((_ctx, error) => setStatus(`connection error: ${error.message}`))
      .onDisconnect(() => setStatus("disconnected"))
      .build();
    return () => connection.disconnect();
  }, []);

  // Runs after React commits the changed row to the DOM. Same-host server and
  // browser clocks let this include subscription transport + React commit time.
  useLayoutEffect(() => {
    for (const row of rows) {
      const key = `${row.id}:${row.heartbeatAt.microsSinceUnixEpoch}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        if (row.targetAnchor.startsWith("t8-sample-")) {
          const latencyMs = Date.now() - Number(row.heartbeatAt.microsSinceUnixEpoch / 1000n);
          setSamples(previous => [...previous, { target: row.targetAnchor, latencyMs }].slice(-100));
        }
      }
    }
  }, [rows]);

  const cell = { padding: "10px 12px", borderBottom: "1px solid var(--line)", textAlign: "left" as const };
  return (
    <main className="page-frame">
      <h1 className="page-title">T8 · SpacetimeDB subscription</h1>
      <p className="page-lede">Read-only view. Room permissions are checked by the reducer.</p>
      <p role="status" data-testid="connection-status" style={{ display: "inline-block", margin: "0 0 24px", padding: "2px 12px", borderRadius: 999, color: "var(--on-pastel)", background: "var(--pastel-yellow)", fontSize: 13, fontWeight: 800 }}>{status}</p>
      <div style={{ overflowX: "auto", background: "var(--bubble-glass)", border: "var(--bubble-border)", borderRadius: "var(--bubble-radius)", boxShadow: "var(--bubble-shadow)", padding: "8px 16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
          <thead><tr>{["Agent", "Seat", "Room", "Target anchor", "Heartbeat (µs)"].map(label => <th key={label} style={{ ...cell, fontWeight: 800 }}>{label}</th>)}</tr></thead>
          <tbody>{rows.length ? rows.map(row => (
            <tr key={row.id} data-agent-id={row.id} data-target={row.targetAnchor}>
              <td style={cell}>{row.id}</td><td style={cell}>{row.seatId}</td><td style={cell}>{row.room}</td><td style={cell}>{row.targetAnchor}</td>
              <td style={cell}>{row.heartbeatAt.microsSinceUnixEpoch.toString()}</td>
            </tr>
          )) : <tr><td colSpan={5} style={{ ...cell, color: "var(--ink-soft)", borderBottom: 0 }}>No agent rows yet.</td></tr>}</tbody>
        </table>
      </div>
      <h2 style={{ margin: "32px 0 8px", fontSize: 19, fontWeight: 800 }}>Row write → DOM commit (same-host clocks)</h2>
      <p style={{ margin: "0 0 12px", color: "var(--ink-soft)" }}>Only targets prefixed t8-sample- are measured. An initial snapshot is excluded by using fresh targets.</p>
      <pre data-testid="latency-samples" style={{ margin: 0, padding: 16, overflow: "auto", background: "var(--paper)", border: "2px solid var(--line)", borderRadius: 16, font: "12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace" }}>{JSON.stringify(samples, null, 2)}</pre>
    </main>
  );
}
