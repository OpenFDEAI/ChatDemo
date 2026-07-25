# FDE 现场控制台（@openfde/fde-demo-console）

fde-demo skill 的薄交互层（DESIGN.md §9）：**skill 是大脑，控制台是脸**。
给 FDE 在客户现场用的本地工具：录音 → 本地转写 → 一键触发 Claude Code 回合 → 自动刷新 Demo。
控制台只做「耳朵和手」，不做「脑子」——大脑永远是 Claude Code。

## 快速开始

```bash
cd console
npm install
npm test                       # tsc --noEmit + node:test，必须全绿

# mock 模式（无 API key 演示 / 冒烟）
npm start -- --workspace ../../../../demos/acme-2026-07-25

# 真实模式（经 Claude Agent SDK 驱动 Claude Code）
npm start -- --workspace ../../../../demos/acme-2026-07-25 \
  --adapter claude --asr funasr --demo-url http://localhost:3000
```

打开 <http://localhost:4321>。工作区不存在会自动创建骨架
（`DEMO_SPEC.md` / `TRANSCRIPT.md` / `CANDIDATES.md` / `inputs/`）。

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--workspace <path>` | （必填） | 本次拜访的会话工作区，一次拜访一个目录 |
| `--demo-url <url>` | `http://localhost:3000` | Demo dev server 地址，回合完成后 iframe 自动刷新 |
| `--port <n>` | `4321` | 控制台端口 |
| `--adapter mock\|claude` | `mock` | 回合执行器，见下 |
| `--asr none\|funasr` | `none` | 语音转写引擎，见下 |

## 两种回合模式

**mock**（默认）：不调模型。把转写增量 + 备注的要点合并进 `DEMO_SPEC.md`
的「页面清单」，在 `app/mock-changes.md` 追加占位变更，按 status → text →
tool → summary → done 发事件。用于测试、离线演练、无 API key 的流程演示。

**claude**：动态加载 `@anthropic-ai/claude-agent-sdk`，以工作区为 cwd 起
Claude Code 回合，prompt 按 fde-demo 回合协议执行：读增量 → 先改
DEMO_SPEC.md 再改代码 → 截图自检 → 输出一行总结。要求本机已认证
Claude Code（运行过 `claude` 登录，或设置 `ANTHROPIC_API_KEY`）。SDK 缺失
或未认证时面板会收到 error 事件与降级指引，不会崩。

## 语音转写（FunASR）

`--asr funasr` 时控制台连接本地 FunASR runtime（`ws://127.0.0.1:10096`，
2pass 双通道协议：online 实时 partial + offline 二遍精修 final）。
浏览器采音 → AudioWorklet 降采样 16kHz PCM16 → WebSocket 二进制帧 →
FunASR。**全程本地推理，不上云。**

启动 FunASR 本地服务（官方 runtime 镜像，中文流式 + VAD + 标点）：

```bash
docker pull registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12
docker run -p 10096:10095 -it --privileged=true \
  -v $PWD/funasr-runtime-resources/models:/workspace/models \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12

# 容器内（--certfile 0 关闭 SSL，控制台用 ws:// 直连）
cd FunASR/runtime
bash run_server_2pass.sh --download-model-dir /workspace/models --certfile 0 \
  --model-dir damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx \
  --online-model-dir damo/speech_paraformer-large-streaming_asr_nat-zh-cn-16k-common-vocab8404-onnx \
  --vad-dir damo/speech_fsmn_vad_zh-cn-16k-common-onnx \
  --punc-dir damo/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727-onnx
```

首次启动会下载模型，请在**会前**完成（DESIGN.md §5.2 延迟预算）。

## 降级路径（现场必须记住）

| 失灵环节 | 降级动作 |
|----------|----------|
| FunASR 连不上 / `--asr none` | 录音卡片置灰并显示原因；用转写流下方的**手动输入框**敲要点，流程不变 |
| Agent SDK 缺失 / 未认证 | 面板显示 error 与指引；在**同一工作区**另开终端跑 `claude`（TUI）手敲要点，回合协议照走 |
| 控制台整个挂掉 | 同上——工作区文件就是全部状态，TUI 模式无损接管 |

## WebSocket 协议（`/ws`）

文本帧为 JSON：客户端发 `transcript`（手动要点）、`note`、`turn-start`、
`asr-start` / `asr-stop`、`refresh-state`；服务端发 `state`（spec/候选/
转写全文 + 已消费偏移）、`asr-partial`、`asr-status`、`turn-start`、
`turn-event`（status/text/tool/summary/done/error）。二进制帧为 16kHz
PCM16 音频（仅客户端 → 服务端）。

## 测试

```bash
npm test
```

`node:test` + `tsx`，禁网络、全部在临时目录：session 书签持久化、回合队列
串行不丢弃、mock 适配器端到端、手动 ASR 逃生通道。
