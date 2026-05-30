import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["?"], description: "Open / close this help overlay" },
  { keys: ["/"], description: "Focus the search bar" },
  { keys: ["1"], description: 'Set status filter to "All"' },
  { keys: ["2"], description: 'Set status filter to "Open"' },
  { keys: ["3"], description: 'Set status filter to "Reserved"' },
  { keys: ["4"], description: 'Set status filter to "Submitted"' },
  { keys: ["5"], description: 'Set status filter to "Released"' },
  { keys: ["Esc"], description: "Close this overlay / go back from bounty detail" },
];

interface ShortcutsHelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal overlay listing keyboard shortcuts for the bounty board.
 * - Closes on Escape or backdrop click.
 * - Traps focus inside while open.
 * - Opened by pressing `?` anywhere (wired up in App.tsx).
 */
export function ShortcutsHelpOverlay({ isOpen, onClose }: ShortcutsHelpOverlayProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus the close button when the overlay opens so keyboard users can act immediately
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  // Trap focus within the overlay
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const focusable = overlay.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="ghost-button p-1"
            onClick={onClose}
            aria-label="Close keyboard shortcuts overlay"
          >
            <X size={18} />
          </button>
        </div>

        <table className="mt-4 w-full text-sm border-collapse">
          <thead className="sr-only">
            <tr>
              <th>Key</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={description}>
                <td className="py-2 pr-4 align-middle whitespace-nowrap">
                  {keys.map((key) => (
                    <kbd
                      key={key}
                      className="inline-flex items-center justify-center rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-xs text-gray-200 shadow-sm"
                    >
                      {key}
                    </kbd>
                  ))}
                </td>
                <td className="py-2 text-gray-300">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-gray-500">
          Shortcuts are disabled when typing inside an input or textarea.
        </p>
      </div>
    </div>
  );
}
