/** Reads the connection allowlist persisted for an Inbox agent facet. */
export const readMailExecutorConnectionNames = (
  storage: Pick<SqlStorage, 'exec'>,
): string[] =>
  Array.from(
    storage.exec(
      'select connection_name from mail_executor_connection order by connection_name',
    ),
    (row) => String(row.connection_name),
  )

/** Replaces the complete persisted Inbox connection allowlist. */
export const replaceMailExecutorConnectionNames = (
  storage: Pick<SqlStorage, 'exec'>,
  connectionNames: readonly string[],
) => {
  storage.exec('delete from mail_executor_connection')
  for (const connectionName of connectionNames) {
    storage.exec(
      'insert into mail_executor_connection (connection_name) values (?)',
      connectionName,
    )
  }
}

/** Compares canonical, sorted connection allowlists for scoped MCP reloads. */
export const mailExecutorScopeChanged = (
  previousConnectionNames: readonly string[],
  nextConnectionNames: readonly string[],
) => previousConnectionNames.join('\n') !== nextConnectionNames.join('\n')

/**
 * Prevents Agents SDK from restoring any Inbox MCP authority across a facet
 * wake. The runtime rebuilds the one scoped Executor registration from trusted
 * mail config and connection tables before each initial or continued turn.
 */
export const clearPersistedInboxMcpServersBeforeRestore = (
  storage: Pick<SqlStorage, 'exec'>,
) => {
  storage.exec('delete from cf_agents_mcp_servers')
}
