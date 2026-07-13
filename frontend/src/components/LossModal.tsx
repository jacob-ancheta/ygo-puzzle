interface Props {
  onRestart: () => void;
  onViewBoard: () => void;
}

export default function LossModal({ onRestart, onViewBoard }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Turn ended without winning</h3>
        <p>You didn't reduce the opponent's LP to 0 before your turn ran out. Take another look at the board, or restart to try again.</p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onRestart}>Restart</button>
          <button className="btn" onClick={onViewBoard}>View Board</button>
        </div>
      </div>
    </div>
  );
}
