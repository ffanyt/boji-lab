# 参与开发

谢谢愿意帮忙。几条约定：

## 代码

- **只用 Python 标准库**：`app/server.py`、`bin/lsj`、`bin/xunji`、`deploy/*.py` 都不引第三方包，部署时不需要 `pip install`
- **没有构建步骤**：网页是 `app/web/` 里的原生 HTML / JS / CSS，改完刷新就能看到。不要引入打包工具或 CDN 资源（CSP 也不允许）
- 最低支持 Python 3.9（macOS 自带的 python3），CI 在 3.9 和 3.12 上跑
- 保持现有的紧凑风格；`ruff.toml` 里的规则要过
- 数据结构变了，同步改 `docs/data-model.md`；Claude 的读写规则变了，同步改 `CLAUDE.md` 和 `.claude/skills/`

## 提交前

```sh
python3 -m unittest discover -s tests -v
ruff check .
scripts/check-secrets.sh
```

`scripts/check-secrets.sh` 会找公网 IP、令牌（`lsj_…`）、训记的 key（`xjllm_…`、`xjtpl_…`）、私钥、`root@主机` 这类 SSH 目标，以及不该进仓库的文件（`CLAUDE.local.md`、`deploy/.deploy.env`、`deploy/local/`、签好的 `.shortcut`）。可以装成 pre-commit 钩子：

```sh
ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit
```

你自己的主机名之类的私有字符串，一行一个正则写进 `deploy/local/secret-patterns`（不进仓库），它也会一起查。

## 不要放进仓库的东西

- **个人数据**：真实的饮食照片、体重、睡眠、训练记录，真实的用户名、服务器地址、店名。示例里用 `alice`、`fitness.example.com`、`203.0.113.x` 这类文档专用的地址、「某食堂」
- **密钥**：`LSJ_TOKEN`、上传令牌、训记的 key、SSH 私钥
- **本机文件**：`CLAUDE.local.md`（你自己的部署和习惯）、`deploy/.deploy.env`、`deploy/local/`、`app/web/lianshiji-health.shortcut`（里面有服务器地址，部署时生成）

截图用演示账号截。

## 测试

- 测试在 `tests/`，用标准库的 `unittest`。服务端测试在临时目录里起真的服务，不碰真实服务器
- 训记相关的测试用假的接口，不会去调训记
