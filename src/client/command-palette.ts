export type PaletteCommand = { id: string; label: string; hint?: string; run: () => void };

/** Case-insensitive substring match on every word of the query; the order of the commands is kept. */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const words = query.toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const text = `${command.label} ${command.hint ?? ""}`.toLocaleLowerCase("de-DE");
    return words.every((word) => text.includes(word));
  });
}
