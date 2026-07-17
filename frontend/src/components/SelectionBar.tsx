interface Props {
  label: string;
  count: number;
  min: number;
  max: number;
  canConfirm: boolean;
  onConfirm: () => void;
  canFinish?: boolean;
  onFinish?: () => void;
  finishLabel?: string;
  rejected?: boolean;
}

export default function SelectionBar({ label, count, min, max, canConfirm, onConfirm, canFinish, onFinish, finishLabel, rejected }: Props) {
  return (
    <div className="selection-bar">
      <span>{label} &mdash; selected {count} (need {min}{max !== min ? `-${max}` : ""})</span>
      {rejected && (
        <span className="selection-bar-error">That selection wasn't accepted -- pick a different combination.</span>
      )}
      <div className="selection-bar-actions">
        {canFinish ? (
          <button className="btn" onClick={onFinish}>{finishLabel ?? "Finish"}</button>
        ) : null}
        <button className="btn primary" disabled={!canConfirm} onClick={onConfirm}>Confirm</button>
      </div>
    </div>
  );
}
