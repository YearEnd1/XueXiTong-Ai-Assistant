/* 学习通 AI 自动答题助手  全局常量/默认配置/提示词
 * 该文件被内容脚本(经典脚本按序注入)与后台 Service Worker(ESM 副作用导入)共同使用，
 * 统一挂在 globalThis.CQ 上，两种环境均可读取。 */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  if (CQ.__constantsLoaded) return;
  CQ.__constantsLoaded = true;

  CQ.VERSION = '1.3.5';
  CQ.NS = 'cq-ai-answer';

  CQ.MSG = {
    GET_CONFIG: 'cq:get-config',
    SAVE_CONFIG: 'cq:save-config',
    ANSWER: 'cq:answer',
    REPORT: 'cq:report',
    TAB_STATUS: 'cq:tab-status',
    TEST_CONNECTION: 'cq:test-connection',
    CACHE_GET: 'cq:cache-get',
    CACHE_SET: 'cq:cache-set',
    CACHE_CLEAR: 'cq:cache-clear',
    OPEN_OPTIONS: 'cq:open-options',
    PANEL_DECIDE: 'cq:panel-decide',
    PAGE_CMD: 'cq:page-cmd',
    TOAST: 'cq:toast'
  };

  /* 学习通答题页 URL 特征（用于识别指定答题网页） */
  CQ.URL_RULES = [
    { id: 'work',   page: '作业',     re: /\/work\/doHomeWorkNew/i },
    { id: 'work2',  page: '作业',     re: /\/mooc2\/work\/dowork/i },
    { id: 'preview',page: '作业预览', re: /\/work\/(doHomeWorkPreview|selectWorkQuestionYiPiYue|viewWork)/i },
    { id: 'exam',   page: '考试',     re: /\/exam(-ans)?\/test\/(reVersionTestStartNew|startNew|doExam|examTest)/i },
    { id: 'exam2',  page: '考试',     re: /\/(exam-ans|exam)\/exam\/test/i },
    { id: 'quiz',   page: '章节测验', re: /\/mooc-ans\/quiz\//i },
    { id: 'work3',  page: '作业',     re: /\/api\/work\//i },
    { id: 'exam3',  page: '考试',     re: /\/(exam-ans|exam)\/exam\//i },
    { id: 'quiz2',  page: '测验',     re: /\/quiz\//i },
    { id: 'work4',  page: '作业',     re: /\/mooc-ans\/work\//i },
    { id: 'param',  page: '答题',     re: /[?&](workId|examId|paperId|quizId)=/i }
  ];

  CQ.HOST_RE = /(^|\.)(chaoxing\.(com|cn)|xueyinonline\.(com|cn)|edu\.cn)$/i;

  /* 题目容器候选选择器（按优先级） */
  CQ.CONTAINER_SELECTORS = [
    '.TiMu', '.questionLi', 'div[class*="questionLi"]', 'div[class*="TiMu"]',
    '.Zy_TItle', '.queBox', '.Question', '.question-item', '.questionContent',
    '.queContent', '.examQue', '.questionDetail',
    '.ans-cc .subject', '.subject', '[data-questionid]', 'div[id^="question"]',
    'div[id^="ques"]', '.singleQuesId'
  ];
  /* 强特征容器：学习通题目专属 class/属性，题目校验时可直接采信（用于过滤视频课等页面的误报） */
  CQ.STRONG_CONTAINER_SELECTORS = [
    '.TiMu', '.questionLi', 'div[class*="questionLi"]', 'div[class*="TiMu"]',
    '.Zy_TItle', '.queBox', '.singleQuesId', '[data-questionid]'
  ];

  /* 模型预设：设置页模型选择下拉使用；vision 表示该模型支持图像输入 */
  CQ.MODEL_PRESETS = [
    { name: 'deepseek-chat',         label: 'DeepSeek V3（deepseek-chat）',         provider: 'openai',    baseUrl: 'https://api.deepseek.com/v1', vision: false },
    { name: 'deepseek-reasoner',     label: 'DeepSeek R1（deepseek-reasoner）',     provider: 'openai',    baseUrl: 'https://api.deepseek.com/v1', vision: false },
    { name: 'deepseek-flash',        label: 'DeepSeek Flash（deepseek-flash）',       provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', vision: false },
    { name: 'deepseek-v4-pro',       label: 'DeepSeek V4 Pro（deepseek-v4-pro）',       provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', vision: false },
    { name: 'gpt-4o-mini',           label: 'OpenAI GPT-4o mini（视觉）',           provider: 'openai',    baseUrl: 'https://api.openai.com/v1', vision: true },
    { name: 'gpt-4o',                label: 'OpenAI GPT-4o（视觉）',                provider: 'openai',    baseUrl: 'https://api.openai.com/v1', vision: true },
    { name: 'glm-4-flash',           label: '智谱 GLM-4-Flash',                     provider: 'openai',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', vision: false },
    { name: 'glm-4v-flash',          label: '智谱 GLM-4V-Flash（视觉）',            provider: 'openai',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', vision: true },
    { name: 'qwen-plus',             label: '通义千问 Qwen-Plus',                   provider: 'openai',    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen-vl-plus',          label: '通义千问 Qwen-VL-Plus（视觉）',        provider: 'openai',    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: true },
    { name: 'qwen-max',          label: '通义千问 Qwen-Max（旗舰）',          provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen-flash',        label: '通义千问 Qwen-Flash（高速低价）',     provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen-turbo',        label: '通义千问 Qwen-Turbo（均衡）',         provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen3.5-plus',      label: '通义千问 Qwen3.5-Plus（1M 上下文）',  provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen3.5-flash',     label: '通义千问 Qwen3.5-Flash',              provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: false },
    { name: 'qwen3-vl-plus',     label: '通义千问 Qwen3-VL-Plus（视觉）',      provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', vision: true },
    { name: 'moonshot-v1-8k',        label: 'Kimi（moonshot-v1-8k）',               provider: 'openai',    baseUrl: 'https://api.moonshot.cn/v1', vision: false },
    { name: 'claude-3-5-sonnet-latest', label: 'Anthropic Claude 3.5 Sonnet（视觉）', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', vision: true },
    { name: 'gpt-6.1-sol',        label: 'OpenAI GPT-6.1 Sol（视觉）',         provider: 'openai',    baseUrl: 'https://api.openai.com/v1', vision: true },
    { name: 'gpt-6-astra',        label: 'OpenAI GPT-6 Astra（视觉旗舰）',    provider: 'openai',    baseUrl: 'https://api.openai.com/v1', vision: true },
    { name: 'gpt-6-luna',         label: 'OpenAI GPT-6 Luna（视觉高性价比）', provider: 'openai',    baseUrl: 'https://api.openai.com/v1', vision: true },
    { name: 'gemini-3.1-pro-preview', label: 'Google Gemini 3.1 Pro Preview（视觉）', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', vision: true },
    { name: 'claude-opus-4-7',    label: 'Anthropic Claude Opus 4.7（视觉）',  provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', vision: true },
    { name: 'claude-sonnet-4-6',  label: 'Anthropic Claude Sonnet 4.6（视觉）', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', vision: true },
    { name: 'grok-4.7',           label: 'xAI Grok 4.7',                       provider: 'openai',    baseUrl: 'https://api.x.ai/v1', vision: false },
    { name: 'zen-big-pickle',                  label: '免密网关 Zen  Big Pickle',                     provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-ling-3.1-flash-free',         label: '免密网关 Zen  Ling 3.1 Flash Free',            provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-mimo-v2.6-flash-free',        label: '免密网关 Zen  MiMo V2.6 Flash Free',           provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-nemotron-3.5-lightning-free', label: '免密网关 Zen  Nemotron 3.5 Lightning Free',    provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-jev-1.13-free',               label: '免密网关 Zen  Jev 1.13 Free',                  provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-step-5-preview-free',         label: '免密网关 Zen  Step 5 Preview Free',            provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-longcat-2.5-preview-free',    label: '免密网关 Zen  LongCat 2.5 Preview Free',       provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'zen-space-bunny-free',            label: '免密网关 Zen  Space Bunny Free',               provider: 'zen', baseUrl: 'https://opencode.ai/zen/v1', vision: false },
    { name: 'kilo-auto-free',          label: '免密网关 Kilo  自动路由',           provider: 'kilo', baseUrl: 'https://api.kilo.ai/api/gateway', vision: false },
    { name: 'wb-cn-deepseek-v4.1-flash', label: 'WorkBuddy 国内版  DeepSeek V4.1 Flash（需令牌）', provider: 'workbuddy', baseUrl: 'https://copilot.tencent.com', vision: false },
    { name: 'wb-cn-deepseek-v4-pro',     label: 'WorkBuddy 国内版  DeepSeek V4 Pro（需令牌）',     provider: 'workbuddy', baseUrl: 'https://copilot.tencent.com', vision: false },
    { name: 'wb-cn-glm-5.3',             label: 'WorkBuddy 国内版  GLM 5.3（需令牌）',             provider: 'workbuddy', baseUrl: 'https://copilot.tencent.com', vision: false },
    { name: 'wb-cn-kimi-k3',             label: 'WorkBuddy 国内版  Kimi K3（需令牌）',             provider: 'workbuddy', baseUrl: 'https://copilot.tencent.com', vision: false },
    { name: 'wb-cn-minimax-m3',          label: 'WorkBuddy 国内版  MiniMax M3（需令牌）',          provider: 'workbuddy', baseUrl: 'https://copilot.tencent.com', vision: false },
    { name: 'wb-global-kimi-k3',         label: 'WorkBuddy AI 国际版  Kimi K3（需令牌实验）',     provider: 'workbuddy', baseUrl: 'https://www.workbuddy.ai', vision: false },
  ];

  CQ.TYPE_LABELS = {
    single: '单选题', multiple: '多选题', judge: '判断题',
    fill: '填空题', short: '简答题', unknown: '未知题型'
  };

  CQ.DEFAULT_CONFIG = {
    provider: 'openai',                       // openai | anthropic | zen | kilo | workbuddy
    baseUrl: 'https://api.deepseek.com/v1',   // OpenAI 兼容端点（结尾可带 /v1）
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 60000,
    extraHeaders: '',                          // 每行一个 "Header: value"
    systemPrompt: '',                          // 留空使用内置提示词
    batchSize: 5,                              // 每轮请求发送的题目数
    requestDelayMs: 800,                       // 两轮请求之间的间隔
    masterEnabled: true,                       // 总开关：关闭后 AI 答题/回填/交卷全部暂停（默认开）
    autoDetect: true,                          // 自动识别答题页
    autoAnswer: false,                         // 识别后立即开始 AI 答题
    previewFirst: true,                        // 先预览结果，手动点应用才填
    autoSubmit: false,                         // 填完后自动交卷（危险，默认关）
    autoNext: false,                            // 交卷后自动跳转下一章节答题页（默认关）
    minConfidence: 0.0,                        // 低于此置信度的题不填写
    enableCache: true,                         // 题目-答案本地缓存
    includeImages: false,                      // 将题干图片发给支持视觉的模型
    verifyAnswers: false,                       // 答案检测：首次回答后独立核验，不一致的题单独重答（API 用量增加）
    uiCollapsed: false,
    uiPos: null
  };

  CQ.PROMPT = {
    system: [
      '你是一个严谨的在线课程答题助手，需要为给定的题目给出最可能的正确答案。',
      '严格遵守以下规则：',
      '1. 只输出一个 JSON 数组，不要输出 Markdown 代码块、前后缀解释或任何多余文字。',
      '2. 数组元素格式：{"index":题号,"answer":[...],"confidence":0到1的小数,"reason":"不超过40字的简短理由"}',
      '3. 单选题：answer 为选项字母数组，如 ["B"]。',
      '4. 多选题：answer 为所有正确选项字母，如 ["A","C"]。',
      '5. 判断题：answer 为 ["对"] 或 ["错"]。',
      '6. 填空题：answer 为按空位顺序的字符串数组，数量必须与题目 blanks 字段一致（blanks 是几就输出几个答案，每个空位一个元素），如 blanks=2 时输出 ["1954","巴黎"]；答案本身不要包含题号。',
      '7. 简答题/论述题：answer 为只含一个字符串的数组，写核心要点，用分号分隔，不超过200字。',
      '8. 题目里可能出现 HTML 标签或图片链接，仅作理解参考，不要复述题干。',
      '9. 不确定时也要给出最可能的答案，但 confidence 要如实降低；完全不会时 answer 给空数组，confidence 给 0。'
    ].join('\n'),
    userPrefix: '请作答以下题目（共 {count} 题），严格按系统要求输出 JSON 数组：\n',
    retry: '你上一次的输出不是合法 JSON。请重新只输出 JSON 数组，不要包含任何其他字符。你上次的输出是：\n'
  };

  CQ.CACHE_KEY = 'cq-ai-answer:cache';
  CQ.CACHE_MAX = 2000;
})(typeof globalThis !== 'undefined' ? globalThis : self);