import { useEffect, useState, useTransition } from "react";
import {
  approveAction,
  claimAction,
  completeAction,
  executeAction,
  fetchBuckets,
  type ActionBucket,
  type ActionObject,
  type BucketResponse,
} from "./api";
import { ActionRow } from "./ActionRow";

const TABS: { id: ActionBucket; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "today", label: "Today" },
  { id: "queued", label: "Queued" },
  { id: "automated", label: "Automated" },
  { id: "needs_you", label: "Needs You" },
  { id: "completed", label: "Completed" },
];

export function App() {
  const [data, setData] = useState<BucketResponse | null>(null);
  const [tab, setTab] = useState<ActionBucket>("now");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function reload() {
    const next = await fetchBuckets();
    startTransition(() => setData(next));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await fetchBuckets();
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load actions");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(id: string, fn: (id: string) => Promise<ActionObject>) {
    setBusyId(id);
    setError(null);
    try {
      await fn(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const actions = data?.buckets[tab] ?? [];
  const counts = data?.counts;

  return (
    <main className="app">
      <header className="brand-lockup">
        <h1 className="brand">
          AION
          <span>Actions</span>
        </h1>
      </header>
      <p className="lede">
        Signal → Recommendation → Action Queue → Approval → Execution → Outcome.
        One governed queue for every AION producer.
      </p>
      <p className="pipeline">
        <span>create</span>
        <i>→</i>
        <span>claim</span>
        <i>→</i>
        <span>approve</span>
        <i>→</i>
        <span>execute</span>
        <i>→</i>
        <span>complete</span>
        <i>→</i>
        <span>outcome</span>
      </p>

      <nav className="tabs" aria-label="Action buckets">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <strong>{counts?.[t.id] ?? 0}</strong>
          </button>
        ))}
      </nav>

      {error ? <div className="error">{error}</div> : null}

      {!data && !error ? <div className="loading">Loading action queue…</div> : null}

      {data && actions.length === 0 ? (
        <div className="empty">No actions in {tab.replaceAll("_", " ")}.</div>
      ) : null}

      <section className="queue" aria-live="polite">
        {actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            busyId={busyId}
            onApprove={(id) => run(id, (x) => approveAction(x, true))}
            onExecute={(id) => run(id, executeAction)}
            onClaim={(id) => run(id, claimAction)}
            onComplete={(id) => run(id, completeAction)}
          />
        ))}
      </section>

      <footer className="status-bar">
        <span>Prototype · Lifecycle V0</span>
        <span>First producer: Revenue Copilot · Context Pack on execute · Operator Console</span>
      </footer>
    </main>
  );
}
