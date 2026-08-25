# @deepseek-ai/dsh-higress-trace

[English](README.md) | 中文

该可选 bundle 插入 invariant registry、gateway-trace invariant 以及禁用的 `@deepseek-ai/dsh-gateway-trace-query`、`@deepseek-ai/dsh-gateway-trace-console` 和 `@deepseek-ai/dsh-telemetry-otel` 配置行。部署方可选择受限 Trace Query 服务账户，或选择 Console Observability Basic 凭据以读取完整 Tempo/Console Trace；两种 Provider 只能启用一个。Trace 导出仍需配置 OTLP 端点及非空 `agentApplicationId`；bundle 不包含端点和凭据，只有提供受信服务端配置后才将它加入 profile。

## Model Experience

无，因为该 bundle 只组合 Host 侧追踪与反查插件。

#### KV Cache effect

无。

## 已知限制与暂缓事项

- 在受信服务端 profile 启用并配置 Trace Query 和 Trace 导出条目之前，bundle 不会启用相关功能。
