# Agent Note: MCP 工具数刷新错误透传

Status: implemented

English | [中文](2026-08-25-mcp-tool-count-error-propagation.zh.md)

## Problem

MCP 管理页面刷新工具数时，宿主返回业务失败会被目录控制器当作成功处理，页面不显示错误，也不会说明远端 MCP 端点不可用。

## Decision

目录控制器区分 Typert wire 失败与 mcp-manager 业务失败。只有 `serverTools` 返回成功时才写入工具数；业务失败沿用其错误码和消息返回给页面，由操作提示展示。

## Alternatives considered

- **在页面组件中重新判断 Remote 结果。** 放弃，因为控制器拥有 Remote 双层结果解析，组件不应重复实现宿主协议判断。
- **失败时清空已有工具数。** 放弃，因为一次刷新失败不能证明此前成功读取的数量已经失效。

## Consequences

MCP 端点返回空响应、连接失败或其他业务错误时，页面会显示实际错误，不再伪装为成功；成功刷新仍只更新对应服务器的缓存数量。控制器测试覆盖失败透传和成功写入两条路径。
