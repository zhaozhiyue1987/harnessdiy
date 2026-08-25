/** `mcp` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': 'MCP 服务',
  'section.description': '管理可连接到会话的 MCP 服务器。绑定后，服务器暴露的工具会出现在此会话中。',
  'section.empty': '还没有配置的服务器。',
  'form.name': '名称',
  'form.name.placeholder': '例如 file-server',
  'form.transport': '传输方式',
  'form.transport.stdio': 'stdio（本地命令）',
  'form.transport.http': '流式 HTTP',
  'form.transport.sse': 'SSE（旧版事件流）',
  'form.url': '服务端 URL',
  'form.url.placeholder': 'https://example.com/mcp',
  'form.command': '命令',
  'form.command.placeholder': '例如 npx',
  'form.args': '参数（空格分隔）',
  'form.add': '添加服务器',
  'action.remove': '移除',
  'action.bind': '绑定',
  'action.bound': '已绑定',
  'action.unbind': '解除绑定',
  'action.detail': '查看详情',
  'action.refreshTools': '刷新工具数',
  'action.fetching': '获取中...',
  'detail.tools': '个工具',
  'detail.toolsEmpty': '此服务暂未暴露任何工具',
  'dock.empty': '无 MCP 工具',
  'dock.label': 'MCP 工具',
  'error.load': 'MCP 列表加载失败',
  'error.action': '操作失败',
} satisfies Record<string, string>

/** The mcp namespace key union. */
export type McpKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP settings page + input dock copy. */
    mcp: McpKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'MCP servers',
  'section.description': 'Manage MCP servers you can connect to a session. Bound servers expose their tools in that session.',
  'section.empty': 'No servers configured yet.',
  'form.name': 'Name',
  'form.name.placeholder': 'e.g. file-server',
  'form.transport': 'Transport',
  'form.transport.stdio': 'stdio (local command)',
  'form.transport.http': 'Streamable HTTP',
  'form.transport.sse': 'SSE (legacy event stream)',
  'form.url': 'Server URL',
  'form.url.placeholder': 'https://example.com/mcp',
  'form.command': 'Command',
  'form.command.placeholder': 'e.g. npx',
  'form.args': 'Args (space separated)',
  'form.add': 'Add server',
  'action.remove': 'Remove',
  'action.bind': 'Bind',
  'action.bound': 'Bound',
  'action.unbind': 'Unbind',
  'action.detail': 'Details',
  'action.refreshTools': 'Refresh',
  'action.fetching': 'Fetching...',
  'detail.tools': 'tools',
  'detail.toolsEmpty': 'This server exposes no tools',
  'dock.empty': 'No MCP tools',
  'dock.label': 'MCP tools',
  'error.load': 'Could not load MCP servers',
  'error.action': 'Action failed',
} satisfies Record<McpKey, string>
