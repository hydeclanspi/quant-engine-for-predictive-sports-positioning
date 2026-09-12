# CLAUDE.md

## 交付流程（长期约定）

**完成的改动一律直接推送并合入 `main`，不要停在功能分支上等确认。**
作者要的是立刻看到线上效果（`main` → Vercel 自动部署 → hydeclanspi.vercel.app）。

标准动作，每次做完都走完整套：

1. 在指派的功能分支上开发、提交
2. 合入 `main`（`git checkout main && git merge <branch>`）
3. `git push origin main`，同时把功能分支也推上去
4. 盯一眼 GitHub Actions（lint · test · build 三道门禁），失败就立刻修，不要留给作者

不需要为此开 PR——除非作者明确要求。合完把 commit 链接给出来。

## 语言

**一律用中文回复。**

## 常用命令

```bash
cd dugou-model-centre
npm install
npm run dev      # 开发服务器 :3000
npm run lint     # ESLint 9 flat config
npm test         # Vitest
npm run build    # 生产构建
```

三道门禁（lint → test → build）在每次 push / PR 上由 GitHub Actions 执行，
合 `main` 之前本地先跑一遍。

工作流文件必须放在**仓库根目录**的 `.github/workflows/`——Actions 只扫描这一处。
`ci.yml` 曾放在 `dugou-model-centre/.github/workflows/` 下，低了一层，从未被注册、
从未运行过（2026-09-12 修正）。前端在子目录，故 job 里统一设
`defaults.run.working-directory: dugou-model-centre`。

## 仓库形状

单体前端（React 18 + Vite 5 + Tailwind 3），代码全在 `dugou-model-centre/`：

- `src/lib/` —— 业务与模型内核，纯函数式。`analytics.js` 是量化分析引擎
  （五段管线 + revision 前缀的三段式缓存），`warReport.js` 是周期战报派生层。
- `src/pages/` —— 9 个功能页，都是同一台分析引擎的不同投影，不各自算指标。
- `api/` —— Vercel serverless：`unlock`（HS256 JWT 解锁 preview→full）、
  `commit-bundle` / `bundle`（git-as-sync，加密快照存 `data` 分支）。

数据流单向无环：`localData / gitSync`（存储）→ `analytics / warReport`（派生）
→ `pages`（投影）。写操作回到存储层并 bump 修订号，缓存随之作废。

## 改动时注意

- **指标只在一处定义。** 新指标加进 `lib/`，不要在页面里就地算一份。
- **缓存靠 revision 失效**，不要手写失效逻辑；写操作派发 `dugou:data-changed`。
- **preview 模式**（公开演示）走 `previewStore` 内存态 + 参数遮罩（α/β/γ/δ/ε）。
  遮罩只应发生在视图层；往 `lib/` 里塞 `isPreviewMode()` 分支要三思。
- **云同步是 union-merge**，按 id 并入、永不丢记录。存在 `system_config` 里的
  台账数组（`poolSettlements` / `capitalInjections` / `cycleTitles`）必须同时加进
  客户端 `localData.js` 和服务端 `api/_shared.js` 两处 `LEDGER_CONFIG_KEYS`，
  否则会被空配置冲掉。
