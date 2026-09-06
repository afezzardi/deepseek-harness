# 分叉本地插件

[English](README.md) | 中文

这些插件位于 pnpm 工作区之外。推理强度滑块已在本地构建；只有在启动 Web 时指定其覆盖层才会启用。

## 试用推理强度滑块

检出代码或修改源码后，在仓库根目录构建：

```sh
node artifacts/plugins/effort-slider/setup.mjs
node artifacts/plugins/effort-slider/build.mjs
```

停止当前 Web 进程，然后启动：

```sh
pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --no-open
```

打开输出的 URL，选择工作区和会话，然后点击输入区控件旁的 **Effort**。拖动并松开，或使用方向键。原生模型选择器应显示相同的推理强度。现有部署设置和凭据环境变量仍然生效。

第一个覆盖层启用此分叉的 Web RPC 服务；第二个加载滑块。每次启动都需要指定这两个覆盖层。要禁用滑块，重启时省略第二个覆盖层。修改插件源码后，请重新构建、重启 Web 并刷新页面。

## 参考

| 插件 | 用途 | 开发参考 |
|---|---|---|
| [推理强度滑块](effort-slider/README.zh.md) | 在 Web 输入区选择提供者声明的推理强度 | 客户端模块、类型化插槽、共享会话状态、效果清理和浏览器验证 |

从插件的 README 开始。[社区评审](../results/plugin-review-20260906/REVIEW.md) 记录了已检查的外部实现；其中的受欢迎程度数据是注明日期的观测结果。
