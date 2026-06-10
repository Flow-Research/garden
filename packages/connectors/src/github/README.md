# GitHub

Official upstream MCP server: `https://api.githubcopilot.com/mcp/`

Garden narrows the official remote server to the `repos`, `issues`, and `pull_requests` toolsets using `X-MCP-Toolsets`.

OAuth uses standard GitHub app endpoints. The manifest requests:
- `repo`
- `read:org`
