# templates/base — 自研模板底座
- repo: （本仓库）skills/fde-demo/templates/base
- license: MIT（随 OpenFDE）
- 领域: 通用企业系统（列表-详情 + 驾驶舱 + 角色切换），工单/报修/审批类首选
- 验证状态: ✅ 已跑通（2026-07-25，node 20，模拟客户会议全流程实战一次）
- 启动命令: `rsync -a --exclude node_modules --exclude .next base/ <工作区>/app/
  && cd <工作区>/app && npm install && npm run dev`
- 品牌化适配点: 仅 theme.json（brand 主色/logo 字 + terms 术语表）；
  数据域换 data/seed.ts 的 DomainConfig；mock 数据走 scripts/ingest-api.ts
- 已适配场景: 制造业售后报修派工（宏达演练：超时置顶 / 建议派工 /
  区域考核看板 / 角色视角，6 回合全部 ≤3 分钟或接近）
- 坑:
  - terms 里两个键映射相同文案会导致详情页字段重名 + React 重复 key
    告警（演练实录：sla 与 dueAt 都写「承诺时限」）——术语表键值必须唯一;
  - 演示深链很好用：`?open=<单号>` 直开详情、`?role=agent` 直切一线视角，
    投屏和截图自检都靠它
