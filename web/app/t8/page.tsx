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

  return (
    <main style={{ minHeight: "100vh", padding: 32, boxSizing: "border-box", background: "#111", color: "#eee", fontFamily: "monospace" }}>
      <h1>T8 · SpacetimeDB subscription</h1>
      <p role="status" data-testid="connection-status">{status}</p>
      <p>Read-only view. Room permissions are checked by the reducer.</p>
      <table cellPadding={12} style={{ borderCollapse: "collapse", border: "1px solid #555" }}>
        <thead><tr><th>Agent</th><th>Seat</th><th>Room</th><th>Target anchor</th><th>Heartbeat (µs)</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.id} data-agent-id={row.id} data-target={row.targetAnchor}>
            <td>{row.id}</td><td>{row.seatId}</td><td>{row.room}</td><td>{row.targetAnchor}</td>
            <td>{row.heartbeatAt.microsSinceUnixEpoch.toString()}</td>
          </tr>
        ))}</tbody>
      </table>
      <h2>Row write → DOM commit (same-host clocks)</h2>
      <p>Only targets prefixed t8-sample- are measured. An initial snapshot is excluded by using fresh targets.</p>
      <pre data-testid="latency-samples">{JSON.stringify(samples, null, 2)}</pre>
    </main>
  );
}
