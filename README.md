# 论文重点 · Paper Highlights

在 arXiv HTML 原论文网页上，调用 DeepSeek 或兼容模型接口，逐句识别问题、目标、机制、证据、假设与限制。背景和宏观愿景保留原文，不自动高亮。配合沉浸式翻译阅读。

[下载扩展安装包](https://github.com/tobyberry666/paper-highlighter/releases/latest) · [查看源码](https://github.com/tobyberry666/paper-highlighter)

## 安装（Chrome / Edge）

1. Chrome 地址栏打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
2. 打开“开发者模式”，点击“加载已解压的扩展”。
3. 选择本项目的 **extension 文件夹**（里面直接有 manifest.json）。不需要安装 Node 或执行构建。
4. 如果论文页面已经打开，刷新一次。

ZIP 安装包需要先解压，再选择其中的 extension 文件夹；不能直接把 ZIP 拖进去安装。

## 配置 DeepSeek

点击扩展图标 → “DeepSeek / 接口设置”。

- 官方接口基地址：`https://api.deepseek.com`。
- 默认模型：`deepseek-flash`，依据目前官方文档示例；模型名可修改。
- API Key：在设置页填写自己的密钥，密钥不需要发给任何人。
- 第三方服务：改为服务商提供的基地址（例如 `https://服务域名/v1`）和模型名。
- 已有完整的 `/chat/completions` 地址也可直接填写。

点击“保存设置”并允许扩展访问该模型服务，再点击“测试连接”。测试连接会产生一次小型模型调用。

接口需支持 Chat Completions、JSON 输出和 Bearer 认证。支持标准 SSE 流式响应，也兼容直接返回 JSON 的服务。官方 DeepSeek 请求关闭默认思考模式，以避免分类输出预算被长推理占用；第三方服务保留其默认行为。

密钥只存储在这个浏览器的扩展本地存储，正文页面无法通过内容脚本读取。接口调用从扩展后台发起；分析的论文文字会发送给所配置的模型服务。只有点击“分析重点”或“测试连接”才调用模型，刷新页面不会自动调用。

## 阅读

1. 打开 `https://arxiv.org/html/2505.22954v3#S1` 这样的 HTML 论文页面。
2. 用沉浸式翻译生成中文。想分析全文译文，应先让需要的中文段落生成。
3. 点击扩展中的“分析重点”，或论文右下角面板里的同名按钮。
4. 等待逐批分析。黄色表示重点；紫色表示重要假设与限制。
5. 点击高亮，右下角显示角色、中文理由和对应原句。引用链接继续正常工作。
6. 可停止、隐藏、清除；面板可收起。停止会保留已完成批次。

全文和原文字号保留，使用浏览器原生 CSS 文本高亮，不包裹或改写正文节点。每次重新分析会清除上一轮结果；当前标记在刷新页面后不保留。

## 已知范围

- 第一版支持 **arXiv HTML**，Chrome / Edge 110 及以上；没有适配 PDF、其他网站、Firefox 或 Safari。
- 译文根据沉浸式翻译常见目标容器识别，与英文独立分类，无法保证每句译文与英文标签完全一致。其他翻译工具或不同 DOM 结构可能无法识别。
- 新生成的译文需要再次分析；已有文本被包裹时会重新定位既有高亮，不额外调用模型。
- 只分析正文段落和图注，跳过参考文献、代码块和错误块；图内文字、独立表格单元格、纯公式与部分算法布局没有适配。
- 模型判断具有不确定性，重点不是论文真实性认证；未高亮不代表无用。
- 每批最多20句；接口限流、超时、输出截断、无效 JSON 或遗漏句子会显示错误，异常批次不应用。
- 长论文可能需要多次调用；原文和已生成中文都会参与分析。接口按所用服务的规则计费。

## 验证与开发

运行核心与后台测试：`node --test tests/core.test.cjs tests/background.test.cjs`。

浏览器测试：`node --test tests/browser.test.cjs`。需要 Playwright 包和 Edge；可用环境变量 `PLAYWRIGHT_MODULE` 指定 Playwright 路径，用 `BROWSER_EXECUTABLE` 指定支持加载解压扩展的 Chromium 浏览器。

实际页面定位测试：`node tests/real-page-smoke.cjs`。它在独立临时浏览器配置中加载真实论文，通过本地模拟接口测试布局和定位；不使用真实密钥，不证明真实模型的语义识别质量。

本次核心/后台12项测试及浏览器集成1项通过。实际论文页面的789个句子全部完成测试定位；正文HTML、356个段落、66个MathML、629个链接和16px字号在分析前后保持一致。页面测试使用模拟分类结果，不属于识别准确率验证。

测试覆盖引用缩写、中文分句、结果 ID 校验、流式输出、上下标/分数语义、重复句定位、原文布局/公式/引用保留、译文节点插入、显示切换、准备阶段取消、立即重启与异常结果。尚未使用用户的真实 DeepSeek 密钥检验分类准确性，也未安装真实沉浸式翻译做联合实测。

官方参考：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
