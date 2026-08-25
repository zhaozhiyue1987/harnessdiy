# @deepseek-ai/dsh-gateway-trace-console

English | [中文](README.zh.md)

`dsh-gateway-trace-console` is an optional trusted-server `ctx.gatewayTrace` provider for deployments that already hold Higress Console HTTP Basic credentials. It calls only Console `/v1/observability` endpoints and is separate from the Gateway Trace Query service-account provider; the two credential modes never fall back to one another.

Configure `consoleBaseUrl`, `basicUsernameRef`, and `basicPasswordRef`. The provider supports request-id lookup, trace-only response correlation, bounded background reflection, explicit reconstructed fallback, and allow-listed response parsing. Console Basic credentials remain server-side and never enter sessions, logs, prompts, or browser configuration.

## Model Experience

None, as reflected observations are ignorable session records.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- This provider is for deployments that deliberately retain Console Basic credentials; production deployments should prefer the service-account provider.
