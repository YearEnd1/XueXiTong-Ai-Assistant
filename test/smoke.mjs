/* 纯逻辑冒烟测试（不依赖浏览器/DOM）：node test/smoke.mjs
 * 覆盖：JSON 容错解析、答案载荷解析、配置归一化、字符串答案拆分 */
import '../src/common/constants.js';
import '../src/common/util.js';
import '../src/common/store.js';
import { parseAnswerPayload, compareAnswer } from '../src/background/adapters.js';

const CQ = globalThis.CQ;
let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('PASS ' + name);
  else { failed++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
};

// 1. 代码块围栏 JSON
const r1 = parseAnswerPayload('```json\n[{"index":1,"answer":["B"],"confidence":0.9,"reason":"首都"}]\n```');
ok('parse: fenced json', r1.ok && r1.map.get(1).answer[0] === 'B' && r1.map.get(1).confidence === 0.9);

// 2. 前缀废话 + 尾注
const r2 = parseAnswerPayload('好的，答案如下：\n[{"index":2,"answer":"A、C","confidence":0.8}]\n希望有帮助');
ok('parse: noisy json + string answer split', r2.ok && r2.map.get(2).answer.join(',') === 'A,C');

// 3. 非法输出
const r3 = parseAnswerPayload('这是分析，不是 JSON');
ok('parse: invalid rejected', !r3.ok && r3.error.includes('JSON'));

// 4. {answers:[...]} 包装
const r4 = parseAnswerPayload('{"answers":[{"index":1,"answer":["对"]}]}');
ok('parse: wrapped .answers', r4.ok && r4.map.get(1).answer[0] === '对');

// 5. 配置归一化边界
const cfg = CQ.store.normalize({ batchSize: 999, timeoutMs: 100, temperature: 9, maxTokens: 1, baseUrl: 'https://x.test/v1///' });
ok('normalize: clamps', cfg.batchSize === 20 && cfg.timeoutMs === 5000 && cfg.temperature === 2 && cfg.maxTokens === 128 && cfg.baseUrl === 'https://x.test/v1');

// 6. 稳定缓存键
const k1 = CQ.store.cacheKeyOf({ type: 'single', stem: '1+1=?', options: [{ key: 'A', label: '2' }] });
const k2 = CQ.store.cacheKeyOf({ type: 'single', stem: '1+1=?', options: [{ key: 'A', label: '2' }] });
ok('cacheKey: stable', k1 === k2 && /^[0-9a-z]+$/.test(k1), k1);

// 7. 判断题正反类匹配（与 filler.js 相同逻辑的独立复刻验证）
const pos = new Set(['对', '正确', '是', 'T', 'TRUE', '\u221A', 'Y', 'YES']);
const neg = new Set(['错', '错误', '否', 'F', 'FALSE', '\u00D7', 'X', 'N', 'NO']);
const isPos = l => pos.has(l.toUpperCase()) || /^(对|正确|是|\u221A)/.test(l);
const isNeg = l => neg.has(l.toUpperCase()) || /^(错|错误|否|\u00D7)/.test(l);
ok('judge: 对->pos only', isPos('对') && !isNeg('对'));
ok('judge: 错->neg only', !isPos('错') && isNeg('错'));
ok('judge: sym variants', isPos('\u221A') && isNeg('\u00D7') && !/^(错|错误|否|\u00D7)/.test('对'));

// 8. 学习通常见域名识别
ok('host: chaoxing', CQ.HOST_RE.test('mooc1.chaoxing.com'));
ok('host: xueyinonline', CQ.HOST_RE.test('www.xueyinonline.com'));
ok('host: reject others', !CQ.HOST_RE.test('example.com'));

// 9. 免密网关预设存在且 provider 正确
const freeLane = CQ.MODEL_PRESETS.filter(p => p.provider === 'zen' || p.provider === 'kilo');
ok('presets: zen/kilo free gateways', freeLane.length >= 9
  && CQ.MODEL_PRESETS.some(p => p.name === 'zen-big-pickle')
  && CQ.MODEL_PRESETS.some(p => p.name === 'zen-space-bunny-free')
  && CQ.MODEL_PRESETS.some(p => p.name === 'kilo-auto-free')
  && CQ.MODEL_PRESETS.filter(p => p.provider === 'zen').every(p => String(p.baseUrl) === 'https://opencode.ai/zen/v1'));
const wbPresets = CQ.MODEL_PRESETS.filter(p => p.provider === 'workbuddy');
ok('presets: workbuddy lane', wbPresets.length >= 6
  && CQ.MODEL_PRESETS.some(p => p.name === 'wb-cn-deepseek-v4.1-flash')
  && CQ.MODEL_PRESETS.some(p => p.name === 'wb-global-kimi-k3')
  && wbPresets.filter(p => String(p.baseUrl) === 'https://copilot.tencent.com').length >= 5
  && wbPresets.some(p => String(p.baseUrl) === 'https://www.workbuddy.ai'));

const qwenPresets = CQ.MODEL_PRESETS.filter(p => p.provider === 'openai' && /dashscope/.test(String(p.baseUrl)));
ok('presets: qwen lane', qwenPresets.length >= 7
  && CQ.MODEL_PRESETS.some(p => p.name === 'qwen3.5-plus')
  && CQ.MODEL_PRESETS.some(p => p.name === 'qwen3-vl-plus')
  && qwenPresets.every(p => String(p.baseUrl) === 'https://dashscope.aliyuncs.com/compatible-mode/v1'));

// 10. 答案检测比较器
ok('compareAnswer: choice order-insensitive', compareAnswer(['A', 'C'], ['c', 'a']) === true);
ok('compareAnswer: differ', compareAnswer(['A'], ['B']) === false);
ok('compareAnswer: fullwidth unified', compareAnswer(['Ａ'], ['A']) === true);
ok('compareAnswer: empty never equal', compareAnswer([], []) === false && compareAnswer([''], ['']) === false);
// 11. 新配置项与填空规则
ok('config: verifyAnswers default off', CQ.DEFAULT_CONFIG.verifyAnswers === false);
ok('config: autoNext default off', CQ.DEFAULT_CONFIG.autoNext === false);
ok('prompt: fill blanks count rule', CQ.PROMPT.system.includes('blanks 字段一致'));

console.log(failed ? `SMOKE FAILED: ${failed}` : 'SMOKE ALL PASS');
process.exit(failed ? 1 : 0);