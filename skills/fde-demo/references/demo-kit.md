# Demo Kit：模板底座使用说明

底座在 `templates/base/`（Next.js 15 + Tailwind，无组件库/图表库依赖，
预算内可 build）。设计哲学：**组装快于生成**——企业 Demo 翻来覆去就是
那几个模块，拼装 + 品牌化，速度才守得住。

## 10 分钟品牌化（Phase start 的主路径）

1. 拷贝 `templates/base` → 工作区 `app/`；
2. 改 `theme.json`：
   ```json
   {
     "brand": { "name": "客户名", "logoText": "客户名", "primary": "#0f6f4f",
                "accent": "#d97706", "radius": "8px" },
     "terms": { "ticket": "派工单", "owner": "责任人" }
   }
   ```
   - `brand.primary` 从客户截图 / 官网取色（多模态读图直接取主色）；
   - `terms` 是术语表：**界面上所有文案引用术语表**，客户叫什么就显示什么；
     术语表键值必须唯一——两个键映射相同文案会造成详情页字段重名 +
     React 重复 key 告警（2026-07-25 演练实录：sla/dueAt 都写「承诺时限」）；
3. `data/seed.ts` 换成客户领域的数据形态（字段名跟客户 API / 截图走）；
4. `npm install && npm run dev`（后台），截图自检。

## 模块清单

| 模块 | 用途 | 现场话术 |
|------|------|----------|
| dashboard | 指标卡 + 轻量图表 | 「老板打开先看这一屏」 |
| list-detail | 表格 + 详情侧滑 | 企业系统的 80% |
| 角色切换（顶栏） | 假登录，管理员/一线视角 | 「切到一线人员看到的是…」 |

模块不够用时：先查画廊（oss-first.md），再考虑手写；手写的新模块若质量
可以，会后析取回 `templates/base`。

## Mock 数据契约（与 ingest-api.ts 对接）

- `scripts/ingest-api.ts <openapi.json|yaml> <app目录>` 生成：
  - `data/mock-data.json`：键 `"GET /orders"` → 按 schema 合成的逼真样例响应；
  - `lib/generated-client.ts`：每个 operation 一个 fetch 封装；
- 模板的通用路由 `app/api/mock/[...slug]/route.ts` 按 `METHOD /path` 匹配
  `mock-data.json` 返回；
- 切真实 API：设 `NEXT_PUBLIC_API_BASE=https://客户内网地址` 即可，client
  不用改（**默认 mock-first**：会议室大概率连不上客户内网）。

## 视觉纪律

近黑/米白基底 + theme.json 品牌主色做唯一 accent；扁平、无渐变；严禁
紫蓝渐变 AI 俗套。客户有品牌色就用客户的，没有就保持中性工业风。
