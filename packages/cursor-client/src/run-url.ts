/**
 * Inferred deep link to a Cursor Cloud agent/run page from durable agent IDs.
 *
 * Cursor does not document this URL shape in-repo; replace this helper if Cursor
 * publishes an official run link field or documented URL pattern.
 */
export const inferCursorRunUrl = (agentId: string): string =>
  `https://cursor.com/agents/${encodeURIComponent(agentId)}`;
