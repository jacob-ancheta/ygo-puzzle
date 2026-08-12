interface Props {
  onClose: () => void;
}

export default function WelcomeBackModal({ onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Welcome to Duel Puzzle!</h3>
        <p>
          Sorry for the slower updates recently -- life's been busy. But I do read every bit of
          feedback that comes through, bugs and puzzle suggestions alike, and fixes are in the
          works. Thanks for sticking around and playing. More coming soon!
        </p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
