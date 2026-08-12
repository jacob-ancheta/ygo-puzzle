interface Props {
  onClose: () => void;
}

export default function WelcomeBackModal({ onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Welcome to Duel Puzzle!</h3>
        <p>
          Sorry for the slower updates recently - life's been busy. But I do read every bit of
          feedback that comes through, bugs and puzzle suggestions alike, and fixes are in the
          works. Thanks for sticking around and playing. More coming soon! (P.S If you have puzzles you would like to add
          please let me know! The biggest bottleneck for me is new puzzles!)
        </p>
        <p style={{ marginBottom: 6 }}>Known issues / recent updates:</p>
        <ul style={{ margin: "0 0 14px", paddingLeft: 20 }}>
          <li>The Mathmech puzzle still has known issues -- looking into it.</li>
          <li>Level modulation display should work correctly now.</li>
        </ul>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
