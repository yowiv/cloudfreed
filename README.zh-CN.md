<div style="text-align:center;">
  <img src="html/CloudFreed.png" alt="CloudFreed Logo" width="48" style="float:left; margin-right:10px;">
  <h1>CloudFreed V4</h1>
</div>

[English](README.md) | [中文](README.zh-CN.md)

CloudFreed 是一个强大的工具，旨在绕过 Cloudflare 反机器人保护，使用户能够访问网站而不受验证码或 Cloudflare 安全措施的限制。

## 安装

在使用 CloudFreed 之前，请确保您的系统上已安装 Node.js。如果没有，您可以从 [Node.js 官网](https://nodejs.org/) 下载并安装。

安装 Node.js 后，按照以下步骤设置 CloudFreed：

1. 克隆或下载 CloudFreed 仓库到您的本地计算机，您可以在[这里](https://github.com/Akmal-CloudFreed/CloudFreed-CloudFlare-bypass/archive/refs/heads/main.zip)获取最新下载。
2. 解压文件。
3. 打开终端并导航到您克隆/下载 CloudFreed 的目录。
4. 运行以下命令安装依赖：

   ```
   npm i
   ```

   或者，您也可以使用：

   ```
   npm install
   ```

### Docker 安装

如果您更喜欢使用 Docker，您可以将 CloudFreed 作为 Docker 容器运行：

```bash
docker run -itd --name cloudfreed -p 3000:3000 \
  -e CLIENT_KEY=YOUR_CLIENT_KEY \
  -e MAX_TASKS=1 \
  -e TIMEOUT=60 \
  sanling000/cloudfreed
```

配置选项：
- `CLIENT_KEY`：您的 API 客户端密钥（必填）
- `MAX_TASKS`：最大并发任务数（默认：1）
- `TIMEOUT`：每个任务的超时时间（秒）（默认：60）
- 端口 3000 用于 API 访问

## 使用方法

CloudFreed 可以通过命令行示例或通过其 API 接口使用。

### 命令行用法

安装依赖后，您可以运行示例脚本：

```bash
node example.js cf-challenge
```

可用示例：

- cf-challenge
- cf-challenge-iuam
- turnstile
- cloudflare-invisible
- recaptcha-invisible

### API 用法

您还可以将 CloudFreed 作为 API 服务器运行：

1. 启动 API 服务器：

```bash
node api.js -k YOUR_CLIENT_KEY
```

可用选项：
- `-k, --clientKey`：客户端 API 密钥（必填）
- `-m, --maxTasks`：最大并发任务数（默认：1）
- `-p, --port`：服务器监听端口（默认：3000）
- `-h, --host`：服务器监听主机（默认：localhost）
- `-t, --timeout`：每个任务的超时时间（秒）（默认：60）

2. 创建新任务：

```
POST http://localhost:3000/createTask

{
  "clientKey": "YOUR_CLIENT_KEY",
  "type": "CloudflareChallenge",
  "url": "www.example.com",
  "userAgent": "YOUR_USER_AGENT",
  "proxy": {
    "scheme": "socks5",
    "host": "127.0.0.1",
    "port": 1080
  }
}
```

Turnstile 挑战示例（此类型代理是可选的）：

```
POST http://localhost:3000/createTask

{
  "clientKey": "YOUR_CLIENT_KEY",
  "type": "Turnstile",
  "url": "www.example.com",
  "sitekey": "YOUR_SITE_KEY",
  "userAgent": "YOUR_USER_AGENT"
}
```

响应示例：

```
{
    "taskId": "m7dobozwh6gucqy29dk"
}
```

3. 获取任务结果：

```
POST http://localhost:3000/getTaskResult

{
  "clientKey": "YOUR_CLIENT_KEY",
  "taskId": "YOUR_TASK_ID"
}
```

响应示例：

```
{
  "status": "completed",
  "result": {
    "success": true,
    "code": 200,
    "response": "<cf_clearance_or_token>",
    "data": {
      "type": "CloudflareChallenge",
      "url": "www.example.com",
      "timeout": 60,
      "userAgent": "YOUR_USER_AGENT"
    }
  }
}
```

## 注意

CloudFreed 仅用于教育和研究目的。请负责任地使用它，并尊重您访问的网站的服务条款。
