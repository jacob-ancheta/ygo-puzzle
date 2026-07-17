interface Props {
  message: string;
  onRestart: () => void;
  onViewBoard: () => void;
}

// `message` is board.statusMessage -- distinguishes the three ways a puzzle
// attempt actually ends in a loss (turn ran out, LP hit 0, decked out; see
// boardState.ts's "loss" and "win" event handling) instead of always
// showing the same "turn ended" text regardless of which one happened.
export default function LossModal({ message, onRestart, onViewBoard }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>You didn't solve it</h3>
        <p>{message} Take another look at the board, or restart to try again.</p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onRestart}>Restart</button>
          <button className="btn" onClick={onViewBoard}>View Board</button>
        </div>
      </div>
    </div>
  );
}
