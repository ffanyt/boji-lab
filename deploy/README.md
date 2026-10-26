# 部署薄肌研究所

服务端是一个只用 Python 标准库的程序（`app/server.py`），数据放在一个 SQLite 文件和一个照片目录里。下面是在一台 Linux 服务器上用 systemd + nginx 部署的步骤；想用 Docker 的看最后一节。

把下面的 `fitness.example.com` 换成你自己的域名。路径都是这套部署文件的默认值：

| 什么 | 默认位置 |
|---|---|
| 代码 | `/opt/lianshiji/`（`server.py`、`xunji_import.py`、`webpush.py` 和 `web/`） |
| 环境变量 | `/etc/lianshiji.env` |
| 数据 | `/var/lib/lianshiji/`（`data.db`、`photos/<账号 id>/`） |
| 备份 | `/var/lib/lianshiji/backups/` |
| 服务 | `lianshiji.service`，以 `lianshiji` 用户运行，监听 127.0.0.1:8780 |

需要：Linux（systemd 245 或更新）、Python 3.9+、nginx、`sqlite3` 命令行工具（备份用）、一张 HTTPS 证书。

## 1. 用户、目录和环境变量

```sh
useradd --system --home-dir /var/lib/lianshiji --shell /usr/sbin/nologin lianshiji
install -d -o lianshiji -g lianshiji -m 700 /var/lib/lianshiji
install -m 600 -o root -g root .env.example /etc/lianshiji.env
```

编辑 `/etc/lianshiji.env`（每行一个 `KEY=value`，不加引号，值后面不要写注释）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `LSJ_TOKEN` | 必填 | Claude 用的 CLI 令牌，**能读写所有账号的数据**。用 `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` 生成 |
| `LSJ_PASSWORD` | | 第一个管理员的密码，只在数据库里还没有任何账号时用 |
| `LSJ_ADMIN_USER` | `admin` | 第一个管理员的用户名 |
| `LSJ_DATA` | `/var/lib/lianshiji` | 数据目录 |
| `LSJ_HOST` / `LSJ_PORT` | `127.0.0.1` / `8780` | 监听地址，保持 127.0.0.1 |
| `LSJ_TZ` | `Asia/Shanghai` | 时区，日期、睡眠时间都按它算 |
| `LSJ_DAY_START_HOUR` | `5` | 一天从几点算起：5 表示凌晨 0:00–4:59 记的算前一天（给睡得晚的人用），0 就是午夜 |
| `LSJ_COOKIE_SECURE` | `1` | 登录 cookie 只走 HTTPS。只在自己电脑上用 http 试的时候设 0 |
| `LSJ_PUSH_CONTACT` | `mailto:noreply@lianshiji.invalid` | 推送通知请求里带给推送服务的联系方式（VAPID 的 `sub`），`mailto:` 或 `https:` 地址 |
| `LSJ_PUBLIC_URL` | 管理员请求的 Host | 邀请链接用的站点地址（`https://你的域名`） |

## 2. 代码

在你自己的电脑上，把 `deploy/deploy.env.example` 复制成 `deploy/.deploy.env`（不进仓库）并填好服务器，然后：

```sh
deploy/deploy.sh -n   # 先看看要推到哪里、执行什么
deploy/deploy.sh      # 打包 app/server.py、app/xunji_import.py、app/webpush.py 和 app/web/，推到 LSJ_DEPLOY_DIR，重启服务
```

`deploy.sh` 只推代码。下面的 systemd、nginx、cron、fail2ban 文件第一次要手动装，改了也要手动更新。

## 3. systemd

```sh
cp deploy/lianshiji.service /etc/systemd/system/
# 改 Environment=TZ=… LSJ_TZ=… 成你的时区（/etc/lianshiji.env 里的值优先）
systemctl daemon-reload
systemctl enable --now lianshiji
systemctl status lianshiji
journalctl -u lianshiji        # 服务器出错时客户端只看到「服务器出错了，稍后再试」，详细错误在这里
```

服务文件带了一组沙箱设置：只能写 `/var/lib/lianshiji`，没有任何 capability，只能连本机（`IPAddressDeny=any` + `IPAddressAllow=localhost`），系统调用限制在 `@system-service`。服务会连外网的只有可选的训记对接（用户在网页上点「从训记同步」读训记、点「写进训记」写训记的 Agent 模版，都用 HTTPS）和推送通知（有人在「我的 → 通知」里开了通知，Claude 处理完或点「发一条试试」时，服务器用 HTTPS 给浏览器的推送服务发一个不带内容的推送，签名密钥第一次用时生成在 `LSJ_DATA/vapid.json`，要一起备份）：要用就删掉 `IPAddressDeny`、`IPAddressAllow` 这两行（训记和推送服务的地址都不固定，没法只放行它们），都不用就留着。如果你的 systemd 太旧、不认识其中某一项，启动日志里会提示，删掉那一行即可。

## 4. nginx

```sh
cp deploy/nginx.conf.example /etc/nginx/sites-available/lianshiji
# 改 server_name 和证书路径
ln -s /etc/nginx/sites-available/lianshiji /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

配置里做了这些：
- 只开 TLS 1.2/1.3，TLS 1.2 只用 ECDHE + AEAD 套件；`server_tokens off`
- 请求体默认最大 1 MB（和服务端的 JSON 上限一样），只有上传照片的 `POST /api/photos` 放到 21 MB（服务端上限 20 MB）
- 登录限速：`limit_req_zone … zone=lsj_login … rate=6r/m`，`/api/login` 允许突发 5 次，超出返回 429。`limit_req_zone` 只能写在 `http {}` 里：Debian/Ubuntu 的 `sites-enabled/`、`conf.d/` 本来就被包含在 `http {}` 里，所以写在这个文件顶部就行；放在别处时把这一行挪进 `nginx.conf` 的 `http {}`
- 服务端自己也限登录：10 分钟内同一用户名 + 同一 IP 错 5 次、同一用户名错 30 次、同一 IP 错 20 次就返回 429。它只相信来自本机的 `X-Real-IP`，所以 nginx 要和服务在同一台机器上
- 不用 `upstream {}` 的 keepalive

## 5. HTTPS 证书

- 有域名：用 certbot 或 acme.sh 申请，证书路径填进 nginx 配置，续期后 `systemctl reload nginx`
- 只有 IP、没有域名：Let's Encrypt 也给 IP 签短期证书（有效期约 6 天），必须全自动续期（比如 acme.sh 加 root 的 crontab）。HTTP-01 验证要在 80 端口上能访问 `/.well-known/acme-challenge/`：80 端口被别的站点占着时，验证文件要写进那个站点的根目录，那个站点的根目录一改，续期就会失败，几天后证书过期。最好给续期失败设个提醒
- iPhone 的快捷指令和网页都要求证书有效，自签证书不行

## 6. 第一次登录和 Claude Code

1. 打开 `https://fitness.example.com`，用 `LSJ_ADMIN_USER` / `LSJ_PASSWORD` 登录，改密码。之后 `LSJ_PASSWORD` 不再起作用，可以从 env 文件里删掉
2. 在「我的 → 用户管理」给每个人建账号
3. 在运行 Claude Code 的电脑上：按 `docs/config.example.json` 写 `~/.config/lianshiji/config.json`（`url` 和 `LSJ_TOKEN`），`chmod 600`，然后 `bin/lsj users` 看能不能连上

管理员忘了密码、又没有别的管理员：

```sh
sudo -u lianshiji env $(grep -v '^#' /etc/lianshiji.env | xargs) python3 /opt/lianshiji/server.py --reset-password admin
```

会打印一个临时密码（同时解除停用、退出该账号所有设备）。

替某个人存训记的训练 key（网页上「从训记同步」用；用户也可以自己在「我的 → 训记」里存。存模版 key 加 `--kind template`）：

```sh
sudo -u lianshiji env $(grep -v '^#' /etc/lianshiji.env | xargs) python3 /opt/lianshiji/server.py --set-xunji-key <用户名>
```

在隐藏的提示后粘贴 key，或者从标准输入传进去；只打印 `ok`，不会显示 key。服务器要能连外网才能用这个功能（见第 3 节）。

## 7. 「同步健康」快捷指令

```sh
deploy/make-shortcut.py https://fitness.example.com      # 生成、用 macOS 的 shortcuts sign 签名、检查
deploy/deploy.sh                                          # 推上去，用户登录后从 /shortcut 下载
```

`shortcuts sign` 需要一台登录了 iCloud 的 Mac。没有的话用 `--unsigned` 生成未签名的文件，拿到别的 Mac 上签，再用 `--check` 检查（脚本会打印具体命令）。不管谁签的，`make-shortcut.py` 都会把签好的文件解开，和本地生成的逐项比对，地址或步骤被改了就报错、不覆盖输出。服务器地址或上传格式变了，要重新生成再部署。

快捷指令改了（比如加了心率和活动能量明细，用来算「训练中」每次训练的心率和消耗），手机上已经装了的旧版不会自己更新：告诉用户在「快捷指令」App 里删掉旧的「同步健康」，再从网页「我的 → Apple 健康同步」重新下载，把同步令牌粘进新的第一个文本框。令牌只在生成时显示一次：删之前先从旧快捷指令的第一个文本框里复制出来，找不到就在网页上重新生成一个（再撤销旧的）。设过「自动化」的要重新选一次新的快捷指令。

## 8. 备份和恢复

```sh
cp deploy/lianshiji-backup.cron /etc/cron.d/lianshiji-backup     # 文件名不能带点，否则 cron 不读
```

- 每天 04:30：`backups/data-YYYY-MM-DD.db`（SQLite 在线快照，转成单文件），保留 14 天
- 每周日 04:45：`backups/photos-YYYY-MM-DD.tar.gz`，保留 4 份
- 备份和数据在同一块盘上，盘坏了一起没。定期拷到别处，比如在自己电脑上：`rsync -a 你的服务器:/var/lib/lianshiji/backups/ ./lianshiji-backups/`

恢复数据库：

```sh
systemctl stop lianshiji
cd /var/lib/lianshiji
mkdir -p old && mv data.db* old/                 # 连同 data.db-wal、data.db-shm 一起挪开
cp backups/data-2026-01-05.db data.db
chown lianshiji:lianshiji data.db && chmod 600 data.db
systemctl start lianshiji
```

照片要恢复时：`tar -xzf backups/photos-2026-01-04.tar.gz -C /var/lib/lianshiji && chown -R lianshiji:lianshiji /var/lib/lianshiji/photos`（只会补回那个周日之前的照片，之后新拍的不受影响）。

## 9. fail2ban（可选）

nginx 访问日志里同一个地址 10 分钟内 10 次登录失败或被限速（`POST /api/login` 返回 401 或 429），就封 1 小时：

```sh
cp deploy/fail2ban/filter.d/lianshiji-login.conf /etc/fail2ban/filter.d/
cp deploy/fail2ban/jail.d/lianshiji.conf /etc/fail2ban/jail.d/
fail2ban-regex /var/log/nginx/access.log /etc/fail2ban/filter.d/lianshiji-login.conf   # 先看看能不能匹配
systemctl reload fail2ban && fail2ban-client status lianshiji-login
```

过滤规则按 nginx 默认的 combined 日志格式写；改过 `log_format` 的要相应调整。封禁挡的是 80 和 443 端口，同一台机器上的其他站点对被封的地址也打不开；其他站点也写同一个 access.log、也有 `/api/login` 的话，会一起算。

## 10. Docker（可选）

```sh
cp .env.example .env        # 填 LSJ_TOKEN、LSJ_PASSWORD、LSJ_DOMAIN
docker compose -f deploy/compose.example.yaml --env-file .env up -d --build
```

`deploy/compose.example.yaml` 把服务和 Caddy 放在同一个网络命名空间里：Caddy 自动申请证书，从 127.0.0.1 连服务，所以服务会相信它传的 `X-Real-IP`。数据在 `lianshiji-data` 卷里。没有 sqlite3 命令行时可以这样备份：

```sh
docker compose -f deploy/compose.example.yaml exec app python3 -c "import sqlite3; sqlite3.connect('/data/data.db').backup(sqlite3.connect('/data/backup.db'))"
```

这套 Docker 文件还没有在真机上跑过。

## 11. 定时处理（可选，在运行 Claude Code 的 Mac 上）

想让 Claude 每天自己处理、不用每次叫它：

```sh
mkdir -p ~/Library/Logs/lianshiji
cp deploy/auto-review.plist.example ~/Library/LaunchAgents/com.lianshiji.auto-review.plist
# 编辑它：脚本路径、你的用户目录、时间（StartCalendarInterval 和 LSJ_AUTO_TIMES 要一致）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lianshiji.auto-review.plist
scripts/auto-review.sh            # 先手动跑一次看看（日志在 ~/Library/Logs/lianshiji/auto-<日期>.log）
```

`scripts/auto-review.sh` 对每个启用的账号先查有没有要做的，有才启动 `claude -p "/fitness-review auto <用户名>"`；无人值守运行只开 `bin/lsj`、`bin/xunji` 和读写文件的权限，计划、资料一律写不了（改动都做成提案，等用户在网页上同意）。Mac 睡着时错过的那次会在唤醒后补跑，关机时错过的就跳过。会用到这台电脑上 Claude Code 登录的账号额度。停用：`launchctl bootout gui/$(id -u)/com.lianshiji.auto-review`。
