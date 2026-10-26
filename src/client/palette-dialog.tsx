import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { filterCommands } from "./command-palette.js";
import type { PaletteCommand } from "./command-palette.js";

export function CommandPalette({ commands, onClose }: { commands: readonly PaletteCommand[]; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterCommands(commands, query).slice(0, 12), [commands, query]);

  // Focus returns to whatever had it before the palette opened.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);

  function onKeyDown(event: React.KeyboardEvent): void {
    // The input is the only focusable control, so Tab stays inside the dialog.
    if (event.key === "Tab") { event.preventDefault(); return; }
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") setActive((value) => Math.min(value + 1, matches.length - 1));
    else if (event.key === "ArrowUp") setActive((value) => Math.max(value - 1, 0));
    else if (event.key === "Enter" && matches[active]) {
      const command = matches[active];
      onClose();
      command.run();
    } else return;
    event.preventDefault();
  }

  return <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="account-manager command-palette" role="dialog" aria-modal="true" aria-label="Befehlspalette" onKeyDown={onKeyDown}>
      <input ref={input} className="palette-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Konto, Ordner oder Aktion …" aria-label="Befehl suchen" />
      <ul className="palette-list" role="listbox">
        {matches.map((command, index) => <li key={command.id} role="option" aria-selected={index === active}
          className={index === active ? "active" : undefined} onMouseEnter={() => setActive(index)}
          onClick={() => { onClose(); command.run(); }}>
          <span>{command.label}</span>{command.hint && <small>{command.hint}</small>}
        </li>)}
        {matches.length === 0 && <li className="palette-empty">Nichts gefunden</li>}
      </ul>
    </section>
  </div>;
}
