import { useEffect, useRef } from "react";

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

export default function ActionMenu({ x, y, items, onClose, disableOutsideClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (disableOutsideClose) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, disableOutsideClose]);

  return (
    <div className="action-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map(({ key, label, onClick }) => (
        <button key={key} className="action-menu-item" onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  );
}
