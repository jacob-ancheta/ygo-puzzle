import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ActionMenuItem {
  key: string | number;
  label: string;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ActionMenuItem[];
  onClose: () => void;
  disableOutsideClose?: boolean;
}

const VIEWPORT_MARGIN = 8;

export default function ActionMenu({ x, y, items, onClose, disableOutsideClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Anchored at the raw click point (x, y) until the menu's actual rendered
  // size is known, then clamped to stay fully on-screen -- e.g. tapping a
  // hand card near the bottom of a short mobile-landscape viewport used to
  // render the menu partly (or entirely) below the fold, since `left`/`top`
  // were never checked against window bounds (reproduced live). Runs before
  // paint (useLayoutEffect, not useEffect) so there's no visible jump from
  // the unclamped position to the clamped one.
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    setPos({ left: x, top: y });
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    const clampedLeft = Math.min(x, Math.max(VIEWPORT_MARGIN, maxLeft));
    const clampedTop = Math.min(y, Math.max(VIEWPORT_MARGIN, maxTop));
    if (clampedLeft !== x || clampedTop !== y) setPos({ left: clampedLeft, top: clampedTop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, items.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (disableOutsideClose) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, disableOutsideClose]);

  return (
    <div className="action-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {items.map(({ key, label, onClick }) => (
        <button key={key} className="action-menu-item" onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  );
}
