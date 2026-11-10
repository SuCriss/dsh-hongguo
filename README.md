# dsh-hongguo

红果短剧 DSH 插件：左侧栏一个入口，右侧栏里看热播榜、浏览片库、**播放全部集数**，不占用对话区。

数据与播放来自 [openhongguo](https://github.com/beilunyang/openhongguo)（第三方非官方 SDK，匿名设备，无需登录）。内容版权归权利人所有，仅供个人学习与研究。

## 功能

| 位置 | 内容 |
|---|---|
| 左侧栏 | `sidebar.panellist` 图标，与其它全局面板同级；点击即在右侧栏打开 |
| 右侧栏 | `红果短剧` 标签页：热播四榜、分类浏览、搜索、详情、播放器 |
| 热播 | 总榜 / 真人 / 漫剧 / AI，每榜 5 页 × 20 部 |
| 分类 | 真人剧 / 漫剧 / AI 剧 / 漫画，各约 800 部，24 部一页翻页 |
| 细分题材 | 真人剧 24 个（爱情 / 年代 / 逆袭 / 古装 / 玄幻 / 都市 / 悬疑 …）、漫剧 8 个、AI 剧 8 个；点芯片即在分类内筛选，可继续翻页；漫画无细分 |
| 搜索 | 按剧名搜索，分页加载 |
| 观看历史 | 面板顶部「发现 / 观看历史」两个等宽大切换按钮；历史页最多保留 100 部，网格展示，可单条删除 / 一键清空。记录每部剧看到第几集、第几秒，点一下从那集那秒接着播 |
| 播放器 | 内嵌 `<video>`，选集按 24 集折叠，可展开；播完自动下一集（可关）；多清晰度切换（360p/480p/540p/720p/1080p，SDK 提供的档位） |

## 全部集数是怎么来的

红果网页版只对搜索引擎公开每部剧的前几集（`/video/public/<vid>/360p.mp4`，实测第 6 集起 404），那不是播放通道。

本插件走的是 App 协议：`openhongguo` SDK 用匿名设备取 `resolvePlayback`，拿到每一集的播放地址与内容密钥。片源是 CENC（`cenc-aes-ctr`）加密的 HEVC，浏览器无法直接解码，因此 Host 侧用纯 Node 解密：

- 解析 MP4 box 树，读 `stsz` / `stsc` / `stco` 定位每个样本
- 从 `tenc` 取 IV 长度、从 `senc` 取每样本 IV
- AES-128-CTR 逐样本解密（该服务把 IV 放在 counter 高 8 字节）
- `encv` → `hvc1`、`enca` → `mp4a` 原地改写，不重封装、不重编码

**不需要 ffmpeg**，也不依赖任何原生模块。内容密钥只留在 Host 进程内，页面只看到本机同源地址。

## 安装

本副本是本地构建（`E:\test\hongguo-drama`），已通过 DSH 插件管理器以 `install_bundle` 链接进 profile：

```sh
# 在 DSH 里：plugin_manager install_bundle target=E:\test\hongguo-drama
# 或命令行：dsh plugin --profile <你的profile> add file:E:\test\hongguo-drama
```

`openhongguo` SDK 已随包 vendored（`vendor/openhongguo/`，含 `dist/openhongguo.wasm`），因此安装时不需要再拉任何 npm 依赖。安装后重启一次 DSH。左下角（Settings 上方）没有按钮，入口在**左侧栏上部**的面板图标行。

## 来源与致谢

- 上游项目：[SuCriss/dsh-hongguo](https://github.com/SuCriss/dsh-hongguo)（MIT），本副本的 `index.js` / `client.js` / `cenc.js` 与其同源，差别仅在于把 `openhongguo` 依赖改为 vendored 引入，并补充了本节说明。
- 数据与播放 SDK：[beilunyang/openhongguo](https://github.com/beilunyang/openhongguo)（Apache-2.0，`vendor/openhongguo/LICENSE` 与 `GO_LICENSE` 已随包保留）。


## 使用

1. 点左侧栏的红果图标 → 右侧栏弹出「红果短剧」，中央仍停留在你的会话
2. 顶部搜索框输入剧名，或直接浏览热播 / 分类
3. 点卡片进详情 → 选集播放

首次播放一集会花 6–8 秒（拉流 + 解密），之后同一集走磁盘缓存，秒开。

## 数据与缓存

| 路径 | 内容 |
|---|---|
| `~/.dsh/hongguo-drama/device.json` | 匿名设备档案，删除即更换设备 |
| `~/.dsh/hongguo-drama/media/*.mp4` | 解密后的片源，保留最近 40 集 |
| `~/.dsh/hongguo-drama/covers/` | 封面缓存，保留最近 800 张 |

Host 侧另有两层内存缓存：接口结果 5–10 分钟，前端 90 秒，切换标签页和返回都是瞬时的。

## 已知限制

- 播放依赖客户端的 HEVC 解码能力；若出现有声无画，说明当前客户端缺少 HEVC 解码器
- 匿名设备有播放额度，用尽时会自动更换设备重试
- 封面与片源全部走 Host 同源代理，页面不直接依赖红果 CDN

## 免责声明

本项目仅供学习与研究，不提供、不分发任何视频内容，也不绕过任何付费机制。所有请求以匿名设备身份发往官方服务，内容版权归权利人所有。请勿用于商业用途。
