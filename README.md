# 学习通 AI 自动答题助手 / Chaoxing AI Auto Answer Assistant

一个 Edge（Chromium）浏览器扩展：自动识别**学习通 / 超星**（chaoxing.com / chaoxing.cn / xueyinonline.com / *.edu.cn）的作业、考试、测验答题页面，提取题目后调用你配置的大模型 API 生成答案，支持预览后回填、**答案检测**（二次核验 + 不一致单题重答），可选自动交卷。

A Chromium (Edge) browser extension that auto-detects **Chaoxing** answer pages, extracts questions, and asks your configured LLM API for answers. It supports preview-then-fill, **answer verification** (re-answer mismatched questions), and optional auto-submit.

---

## 功能特性 / Features

- **自动识别答题页 / Auto page detection**：作业、考试、测验等容器；支持单选、多选、判断、填空（含多空）、简答。
- **任意 OpenAI 兼容 API / Any OpenAI-compatible API**：DeepSeek、OpenAI GPT-6.x、通义千问 Qwen、智谱 GLM、Kimi、Gemini、Claude、Grok 等预设，也支持自定义 Base URL、模型名与附加请求头。
- **免密网关 / Key-free gateways**：OpenCode Zen 与 Kilo 公开免费车道预设（有配额与地区限制）。
- **WorkBuddy 渠道 / WorkBuddy lane**：接入腾讯 Copilot（CodeBuddy / WorkBuddy）模型，使用自己的登录令牌与积分。
- **悬浮面板 / Floating panel**：Shadow DOM 隔离样式；全页面可拖动（已钳制在视口内）；答题页自动识别，非答题页常驻不误报。
- **答案检测 / Answer verification**（v1.2.0）：首次回答后独立二次核验，不一致的题目单独重新回答（可在设置页 / 弹窗中开关）。
- **安全默认 / Safe defaults**：预览优先（不自动回填）、自动交卷关闭、自动识别开启、答案缓存开启。
- **自动跳转下一章节 / Auto next chapter**（v1.3.0）：交卷成功后自动点击「下一章节/下一节」入口进入下一章答题页（可在设置页 / 弹窗开关）。
- **视觉模型 / Vision**：图片题可在设置页开启「启用视觉模型」并选择 vision 预设。

---

## 安装 / Installation

1. 下载并解压本项目（或 git clone）。
2. Edge 打开 `edge://extensions`，右上角开启 **开发者模式**。
3. 点击 **加载解压缩的扩展**，选择本项目文件夹。
4. 固定扩展图标；打开任意学习通答题页即可看到悬浮面板。

> Chromium 系浏览器（Chrome / Edge / Brave）通用；Firefox 需自行适配 manifest。

---

## 快速开始 / Quick Start

1. 打开扩展**设置页**（扩展图标  设置，或 `edge://extensions`  详细信息  扩展选项）。
2. 在「模型预设」下拉框选择渠道（如 `通义千问 Qwen3.5-Plus`、`DeepSeek V4 Pro`、`免密网关 Zen` ）。
3. 需要 Key 的渠道：填写 API Key（阿里云百炼、DeepSeek、OpenAI 等在各自官网申请 `sk-`）。
4. 点 **测试连接**。若提示跨域失败，点设置页的 **申请 API 站点访问权限** 并允许该域名。
5. 打开学习通答题页  悬浮面板点 **识别**  **AI 答题**  检查答案  **应用**（回填）。
6. 可选：设置页开启 **答案检测**；谨慎使用 **自动交卷**。

---

## 模型预设 / Model Presets

| 渠道 Channel | 预设 Preset | 需要 Key | 说明 Notes |
| --- | --- | --- | --- |
| DeepSeek | deepseek-chat / deepseek-reasoner / deepseek-flash / deepseek-v4-pro |  | https://api.deepseek.com/v1 |
| OpenAI | gpt-4o-mini / gpt-4o / gpt-6.1-sol / gpt-6-astra / gpt-6-luna |  | https://api.openai.com/v1 |
| **通义千问 Qwen** | qwen-plus / qwen-max / qwen-flash / qwen-turbo / qwen3.5-plus / qwen3.5-flash / qwen-vl-plus / qwen3-vl-plus |  | 阿里云百炼 https://dashscope.aliyuncs.com/compatible-mode/v1 |
| 智谱 GLM | glm-4-flash / glm-4v-flash |  | https://open.bigmodel.cn/api/paas/v4 |
| Moonshot Kimi | moonshot-v1-8k |  | https://api.moonshot.cn/v1 |
| Google Gemini | gemini-3.1-pro-preview |  | OpenAI 兼容入口 |
| Anthropic Claude | claude-3-5-sonnet-latest / claude-opus-4-7 / claude-sonnet-4-6 |  | https://api.anthropic.com/v1 |
| xAI Grok | grok-4.7 |  | https://api.x.ai/v1 |
| 免密网关 OpenCode Zen | zen-big-pickle / zen-ling-3.1-flash-free 等 8 个 -free 预设 |  | 公开免费车道：模型池随时变化、按 session 配额（429）、部分地区 403 |
| 免密网关 Kilo | kilo-auto/free |  | 免费池自动路由；官方声明提示词可能被上游记录 |
| WorkBuddy | wb-cn-deepseek-v4.1-flash / wb-cn-deepseek-v4-pro / wb-cn-glm-5.3 / wb-cn-kimi-k3 / wb-cn-minimax-m3 / wb-global-kimi-k3 |  | 腾讯 Copilot：需自己的 WorkBuddy 登录令牌，消耗你的积分 |

自定义渠道：接口协议选 `OpenAI 兼容` 或 `Anthropic`，填写任意 Base URL、模型名与附加请求头即可接入其他服务。

---

## 答案检测 / Answer Verification

**默认关闭**。开启后每批题目的流程变为：

首次回答  独立二次核验（同一批题再问一次模型）  逐题比较（忽略大小写、全半角、选项顺序）  一致则保留；不一致则该题**单独重新回答**并采纳新结果  面板标注 `答案检测：与首次回答不一致，已单独重新回答`。

- 开关位置：设置页「行为」区  **答案检测**；扩展弹窗也有快捷开关。
- 注意：开启后 API 调用量约翻倍；免费额度 / 积分渠道请按需使用。
- 核验失败或单题重答失败时保留首次答案并在面板标注原因。

---

## 常见问题 / FAQ

| 问题 | 解决 |
| --- | --- |
| 测试连接跨域失败 | 设置页点「申请 API 站点访问权限」，允许对应域名后重试 |
| 免密网关返回 403 / 429 / 400 Model is unavailable | 免费车道的模型池与配额随时变化：换一个 `-free` 预设重试；429 = 短时间请求过多（session 配额）；403 且非地区错误 = 免费层收紧，改用正式 API |
| 图片题答不了 | 换 `vision: true` 的预设（如 qwen3-vl-plus / gpt-4o）并在设置页开启「启用视觉模型」 |
| 填空题多空只填第一空 | v1.2.0 已修复（空位数识别 + 一一对应填写 + 提示词约束）；若仍异常请提交 Issue 并附页面 URL |
| 换模型后答案没变 | 关闭「答案缓存」或清空缓存（缓存键不含模型名，旧答案会被复用） |
| API 返回 400 模型名不支持 | 确认渠道支持的模型名（如 DeepSeek 账户只认 deepseek-flash / deepseek-v4-pro），改预设或手填 |

---

## 隐私 / Privacy

- 所有配置与答案缓存仅存于浏览器本地 `chrome.storage.local`，卸载即清空。
- 无任何服务器、无遥测、无统计；API 请求只发往你在设置页填写的端点。
- 免费网关（Zen / Kilo）按各自官方条款处理你的题目内容，请勿发送敏感信息。

---

## 免责声明 / Disclaimer

本工具仅供学习与效率辅助。请遵守学校、课程的学术诚信规定与目标网站的服务条款；使用本工具产生的一切后果由使用者自行承担。

For study assistance only. Please follow your school's academic integrity rules and the target website's terms of service. Use at your own risk.

---

## 开发与测试 / Development

- 纯原生 JavaScript + Chrome MV3 API，无构建步骤、无第三方运行时依赖。
- `node test/smoke.mjs`：纯逻辑冒烟测试（解析、缓存键、判断题映射、答案比较器、预设完整性）。
- `test/cdp-*.mjs` + `test/serve.js`：基于 CDP 的浏览器回归（需本机 Edge；详见测试脚本注释）。
- 版本历史：v1.0 基础答题  v1.1 悬浮窗常驻/识别修复  v1.2 多空填空修复 + 答案检测  v1.2.1 Qwen 预设扩充  v1.3.0 交卷后自动跳转下一章节（可开关）。

---

## 许可证 / License

[MIT](./LICENSE)  2026