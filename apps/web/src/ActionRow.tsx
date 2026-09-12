import type { ActionObject } from "./api";

interface Props {
  action: ActionObject;
  busyId: string | null;
  onApprove: (id: string) => void;
  onExecute: (id: string) => void;
  onClaim: (id: string) => void;
  onComplete: (id: string) => void;
}

function domainChip(action: ActionObject): string {
  const tag = action.tags?.[0];
  if (tag) return tag;
  if (action.source.includes("revenue")) return "revenue";
  if (action.source.includes("client")) return "client";
  return action.entity_type;
}

function labelForType(action: ActionObject): string {
  return action.action_type.replaceAll("_", " ");
}

export function ActionRow({
  action,
  busyId,
  onApprove,
  onExecute,
  onClaim,
  onComplete,
}: Props) {
  const busy = busyId === action.id;
  const canApprove = action.status === "awaiting_approval";
  const canExecute =
    action.status === "approved" ||
    (!action.requires_approval &&
      (action.status === "queued" || action.status === "claimed"));
  const canComplete = action.status === "executing" || action.status === "automated";
  const canClaim = action.status === "queued";

  return (
    <article className="action-row">
      <div className="priority" aria-label={`Priority ${action.priority}`}>
        {action.priority}
      </div>
      <div>
        <div className="meta">
          <span className="chip">{labelForType(action)}</span>
          <span className={`chip ${domainChip(action)}`}>{domainChip(action)}</span>
          <span className="chip">{action.source.replaceAll("_", " ")}</span>
          <span className="chip">{action.status.replaceAll("_", " ")}</span>
          {action.context_pack_id ? (
            <span className="chip context">ctx {action.context_pack_id.slice(-6)}</span>
          ) : null}
        </div>
        <h2 className="title">{action.title}</h2>
        <p className="reason">{action.reason}</p>
        {action.suggested_action.message ? (
          <p className="suggested">{action.suggested_action.message}</p>
        ) : action.suggested_action.tool ? (
          <p className="suggested">
            Suggested tool: {action.suggested_action.tool} via {action.suggested_action.channel}
          </p>
        ) : null}
      </div>
      <div className="actions">
        {canClaim ? (
          <button type="button" disabled={busy} onClick={() => onClaim(action.id)}>
            Open
          </button>
        ) : null}
        {canApprove ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onApprove(action.id)}
          >
            Approve
          </button>
        ) : null}
        {canExecute ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onExecute(action.id)}
          >
            Execute
          </button>
        ) : null}
        {canComplete ? (
          <button type="button" disabled={busy} onClick={() => onComplete(action.id)}>
            Complete
          </button>
        ) : null}
        {!canApprove && !canExecute && !canComplete && !canClaim ? (
          <button type="button" disabled>
            Inspect
          </button>
        ) : null}
      </div>
    </article>
  );
}
