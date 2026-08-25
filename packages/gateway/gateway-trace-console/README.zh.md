# @deepseek-ai/dsh-gateway-trace-console

[English](README.md) | 中文

`dsh-gateway-trace-console` 是可选的受信服务端 `ctx.gatewayTrace` Provider，适用于已受控持有 Higress Console HTTP Basic 凭据的部署。它只调用 Console `/v1/observability` 端点，并与 Gateway Trace Query 服务账户 Provider 独立；两种凭据模式绝不互相回退。

配置 `consoleBaseUrl`、`basicUsernameRef` 和 `basicPasswordRef`。Provider 支持 request id 查询、只有 trace id 的响应关联、有界后台反查、显式 reconstructed 回退和 allow-list 响应解析。Console Basic 凭据只能保留在服务端，绝不进入 session、日志、Prompt 或浏览器配置。

## Model Experience

无，因为回写的观测是 ignorable session 记录。

#### KV Cache effect

无。

## 已知限制与暂缓事项

- 此 Provider 只适用于明确保留 Console Basic 凭据的部署；生产部署应优先使用服务账户 Provider。
