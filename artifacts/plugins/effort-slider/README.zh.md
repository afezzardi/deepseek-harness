# 本地推理强度滑块

[English](README.md) | 中文

此 Web 输入区控件用于选择当前模型提供者声明的推理强度。原生模型选择器仍然可用，两个控件共用 DSH 的常驻 `ModelDirectory`。选择推理强度时保留提供者和模型 ID，并通过现有 Host API 记录选择。

这是适用于 DSH `0.1.3-alpha.1` 的私有、检出目录本地实现，检查所依据的上游提交为 `d347e703908d0406b7a7ef80e3a0e594d86b2215`。DSH API 尚未稳定：更新上游后请重新执行下列检查。此目录有意位于根工作区之外。

目录：[构建与运行](#build-and-run)、[交互](#interaction)、[源码索引](#source-map)、[验证](#verification)、[范围与来源](#scope-and-provenance)。机制和维护决策见 [DESIGN.md](DESIGN.md)。

<a id="build-and-run"></a>

## 构建与运行

在已安装检出目录依赖的仓库根目录运行下列命令。本地 TypeScript 程序引用上游项目，因此必须已有其声明输出；正常的上游构建会准备这些文件。插件构建本身只生成此目录下被忽略的 `lib/`。

```sh
node artifacts/plugins/effort-slider/setup.mjs
node artifacts/plugins/effort-slider/build.mjs
pnpm exec tsc -p artifacts/plugins/effort-slider/tsconfig.json
pnpm exec vitest run --config artifacts/plugins/effort-slider/vitest.config.ts
```

`setup.mjs` 将此检出目录中的 React 及其测试和类型依赖链接到被忽略的本地 `node_modules/`。它不下载任何内容，并拒绝覆盖不同的依赖。`build.mjs` 使用根工具链生成 Host ESM 入口、浏览器模块工厂、源码映射和 `lib/overlay.yml`。移动检出目录后需要重新构建：覆盖层包含绝对模块路径，因为 DSH 从配置档案目录解析插件入口。

使用此分叉已配置的主目录启动 Web 并加入插件：

```sh
pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --no-open
```

第一个覆盖层启用被此分叉主目录补丁禁用的 Typert 服务。第二个加载此插件。通过 `dsh` 启动；`lib/index.js` 是插件入口，不是应用程序。重新构建后，重启 Web 进程并刷新页面，以便浏览器获取新模块。后续启动时省略第二个覆盖层即可移除插件。构建不会将其安装到默认配置档案中。

进行隔离验收时，使用新的临时主目录和工作区：

```sh
effort_test_home=$(mktemp -d /tmp/dsh-effort-home.XXXXXX)
effort_test_workspace=$(mktemp -d /tmp/dsh-effort-workspace.XXXXXX)
cp artifacts/dsh-settings.yaml "$effort_test_home/settings.yaml"
cp artifacts/dsh-cordis.patch.yml "$effort_test_home/cordis.patch.yml"
DSH_HOME="$effort_test_home" pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --host 127.0.0.1 --port 0 --no-open
```

打开输出的本地 URL，并选择临时工作区。请勿公开 URL 中的身份验证令牌。这些设置仍指向已配置的推理服务；发送提示会发出真实请求。凭据保留环境变量引用，由现有启动器加载。

<a id="interaction"></a>

## 交互

打开输入区控件旁的 **Effort**。拖动时预览提供者标签，松开指针时提交一次选择。方向键、Home、End 和 Page Up/Down 使用浏览器原生范围控件行为，在释放按键时提交。Enter 提交已更改的草稿。Escape 关闭面板并将焦点返回触发按钮。取消指针操作或离开尚未提交的范围控件会丢弃草稿。

触发按钮显示共享的有效选择，而非乐观更新的草稿。选择待处理期间，范围控件被禁用。选择失败会重置草稿并显示错误。共享目录提供目录加载错误和重试状态。原生选择器中的更改会在此反映，成功的选择通过 DSH 会话投影在刷新后保留。

仅当 Host 报告选择可路由、所选模型声明至少两个推理强度且有效强度匹配列表时才显示范围控件。省略强度时使用提供者声明的默认值。未知强度、缺少默认值、只有一个等级的目录或不可用路由均不会产生臆造的滑块位置。具备子代理地址的会话不显示控件。

各位置保留提供者的顺序和 ID。它们是离散选项；等间距不代表数值化 token 预算或计算成本等距。使用此分叉的 Qwen 设置时，选项为 `off`、`low`、`medium` 和 `xhigh`。`off` 有意义是因为提供者明确声明了它。控件不会为其他提供者添加 `off` 等级。

<a id="source-map"></a>

## 源码索引

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 用于客户端发现的空 Host 插件入口 |
| [package.json](package.json) | 模块导出和 Web 客户端依赖顺序 |
| [src/client/index.ts](src/client/index.ts) | 服务要求、语言和样式清理、会话插槽注册 |
| [src/client/EffortSlider.tsx](src/client/EffortSlider.tsx) | 共享状态订阅、本地预览、提交和失败行为 |
| [src/client/locales.ts](src/client/locales.ts) | 类型化的英文和中文界面文案 |
| [src/client/style.css](src/client/style.css) | 限于插件自有元素的样式 |
| [build.mjs](build.mjs)、[setup.mjs](setup.mjs) | 检出目录本地构建和依赖设置 |
| [tests/slider.spec.tsx](tests/slider.spec.tsx) | 使用隔离目录存储的 React 交互测试 |
| [tests/bundle.spec.ts](tests/bundle.spec.ts) | 已构建工厂的加载和真实 Cordis/插槽清理 |

<a id="verification"></a>

## 验证

先构建再运行测试：构建产物冒烟测试有意读取 `lib/client.js`。TypeScript 检查覆盖源码和测试。交互测试验证预览与提交、准确的提供者 ID、失败恢复、重复提交、外部选择、取消、焦点、排除子代理以及请求期间卸载。构建产物测试只允许预期的共享 React 导入，并验证清理时移除插槽、样式元素和语言注册。

进行浏览器验收时，在原生选择器初始化模型目录前创建新会话。更改推理强度，与原生选择器对比，刷新，然后通过原生选择器更改模型并再次检查滑块。检查键盘交互、Escape 和窄窗口布局。使用 [read-session-log.mts](../../read-session-log.mts) 解码会话日志；选择必须作为现有模型选择事件出现。检查真实推理字段时，使用 [recproxy.py](../../recproxy.py) 和临时设置副本。仅有界面成功不能证明请求序列化或引擎行为。

已执行的检查及其限制见 [VALIDATION.md](VALIDATION.md)。本地插件不在上游根测试发现或覆盖率门禁范围内；请运行其明确列出的命令。

<a id="scope-and-provenance"></a>

## 范围与来源

[社区滑块](https://github.com/2768651338/dsh-effort-slider) 提供了功能思路，检查版本为 `b95d997a787ddfc2dfe05e167f59229ccd8bafb2`。该实现使用较旧的会话 API 和自动适配器配置。本实现使用当前类型化扩展点，不迁移设置、注册提供者、包装适配器或截取原生选择器 DOM。原始许可证和声明文件保留在 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。[评审](../../results/plugin-review-20260906/EFFORT-SLIDER.md) 记录了上游调查结果。

插件选择下一个模型请求的推理强度，已经构建的请求不受影响。提供者负责序列化，推理服务器决定某个等级是否改变计算。输入区左侧插槽不提供原生模型位置的 `locked` 属性；此控件使用目录可用性和待处理状态，Host 选择规则仍具权威性。它不保证在每一种禁用或断开连接的输入区状态下与原生位置的锁定行为一致。
