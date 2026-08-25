# Agent Note：MCP 停靠区几何与已绑定服务器详情面板

Status: implemented

[English](2026-08-18-mcp-dock-detail-and-alignment.md) | 中文

## 问题

对话停靠区（绑定／解绑 chip）以前使用自有的 `.dock` 布局，整条在 composer 全宽上展开，内容也从栈的左边缘开始——在共享 composer 变量（`--dsh-composer-side-clearance`、`--dsh-composer-dock-inset`）下比输入卡左伸 16px。用户视角就是 chip 浮在会话框左侧很远的地方。另外，已绑定的服务器在 UI 里无处查看它实际连到什么、暴露了什么：没有端点详情，没有工具清单。settings 段里也看不到 SSE 传输选项，尽管该选项（`form.transport.sse`）一直存在于源码——运行中的 web 应用加载的是早于它的陈旧 `lib/client.js` bundle。

## 决策

`McpDock.module.css` 采用 QueueDock 已在用的共享 composer 停靠区几何：从全栈宽度中减去 `side-clearance × 2 + dock-inset × 2`，封顶于 `card-max-width − dock-inset × 2`，居中，并以水平 padding 补齐 inset——chip 内容因此精确地起始于输入卡边缘。

已绑定服务器的 chip 名称／数量摘要变成可切换按钮（`aria-expanded`、`aria-controls`），在条带下方展开一个面板：一行元信息（传输类型＋URL 或命令，取自目录 spec）和实时工具清单（`McpBoundServer.tools`，已在会话视图上投影）——每个工具显示原始名和描述，服务未暴露任何工具时有明确的空态。新增三对 zh/en 文案。

SSE 选项无需改源码：`McpSettingsSection` 本就列出全部三种传输。重建 ui-mcp client bundle 并刷新页面即可让它重新出现在浏览器端（`/plugins/*/client.js` 以 `cache-control: no-cache` 重新校验）。

## 备选方案

**把详情放在 settings 段而不是停靠区。** 否决：工具清单是按会话绑定的，且已经到达会话视图；停靠区才是用户感知到已绑定服务器的地方。settings 保持 list/upsert/delete。

**带输入 schema 的完整工具表格。** 暂缓：清单的名称与描述回答当前可见的缺口；schema 离用户指南一步之遥，也能让面板保持紧凑。

## 测试

真实 web 应用验证：停靠区容器边界（855–1619）落在输入卡边界（848–1626）之内，两侧各 8px inset，卡上方 8px 间隙；settings 传输下拉现在列出 流式 HTTP／SSE（旧版事件流）／stdio（本地命令）；绑定服务后出现 chip，展开显示 `streamable-http · <url>` 和 8 个带描述的工具，空态为独立分支。包上 `oxlint`、`tsc` 通过；`verify-translation-pairing` 记录了 940 对一致项；`doc-sync` 28/28 通过。该包没有单测。

## 影响

Chip 直接位于会话框正上方并与其余对齐；任何已绑定服务器都可以就地查看端点与工具；重建后的 bundle 让 SSE 传输选项重新可见。