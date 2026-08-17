# Git 使用说明（写给完全没接触过 git 的你）

> 本说明针对你的项目文件夹 `D:\haowanyouxi\Canton\CPTOND-2025\Guangzhou`
> 所有命令在 Windows 的 PowerShell 里运行（开始菜单搜索“PowerShell”打开即可）。
> 命令前面带 `$` 的只是提示符，复制时**不要**复制 `$` 本身。

---

## 一、git 是什么？（一分钟理解）

git 是一个“存档工具”。它给你的项目文件夹做**存档点（commit，提交）**：

- 每当你把代码修改保存成一个存档点，以后任何时候都能回来看、能对比、能找回旧版本；
- 存档点之间有先后顺序，形成一条“历史线”；
- 所有存档都放在隐藏的 `.git` 文件夹里，不影响你的日常工作文件。

你现在已经有两个存档点：

| 存档编号（前 7 位） | 说明 |
|---|---|
| `17a01b9` | 修改前的原始公交 GIS 数据（基线） |
| `5b98436` | 修改后的分析脚本 + 网站原型 |

日常你只需要记住三个动作：**看状态、存版本、看历史**。下面全部展开讲。

---

## 二、常用命令速查表

| 想做什么 | 命令 |
|---|---|
| 看现在有哪些改动 | `git status` |
| 看存档历史 | `git log --oneline` |
| 保存所有改动为新版本 | `git add -A` 然后 `git commit -m "说明"` |
| 保存某一个文件 | `git add 文件名` 然后 `git commit -m "说明"` |
| 看某次存档改了什么 | `git show 存档编号 --stat` |
| 对比两个存档 | `git diff 存档A 存档B --stat` |
| 放弃某个文件的未存档改动 | `git checkout -- 文件名` |
| 撤销最后一次提交（保留改动） | `git reset --soft HEAD~1` |

---

## 三、从零开始：进入项目文件夹

1. 打开 PowerShell；
2. 输入下面命令回车，进入你的项目：

```powershell
cd D:\haowanyouxi\Canton\CPTOND-2025\Guangzhou
```

3. 以后每次打开 PowerShell 都要先执行这一步，不然 git 会提示“not a git repository”（找不到仓库）。

---

## 四、日常操作详解

### 4.1 查看当前状态：`git status`

这是你用得最多的命令，它告诉你“现在和上次存档相比，改了什么”。

```powershell
git status
```

输出里会看到：

- `On branch main` —— 当前在主分支，正常；
- `Changes not staged for commit:` 下面列出的文件 —— 有改动但还没存档；
- `Untracked files:` 下面的文件 —— 新文件，git 还不认识它；
- `nothing to commit, working tree clean` —— 一切干净，没有任何改动（这就是“存好了”的状态）。

**记住**：出现“红色/未暂存”的内容，说明有改动没存；存好之后会变干净。

### 4.2 查看存档历史：`git log`

```powershell
git log --oneline
```

输出示例：

```text
5b98436 新增：数据分析脚本、Web 数据预处理与公交+地铁线网网站原型
17a01b9 基线：原始公交 GIS 数据
```

最上面是最新的存档。`--oneline` 是简洁模式，不带它可以看到完整信息（谁、什么时候、改了什么说明）。

### 4.3 保存修改（最重要，两步）

改完代码后，想把它存成新版本，执行：

```powershell
git add -A
git commit -m "这里写一句话说明这次改了什么"
```

解释：

- `git add -A`：把**所有**改动放进“待存档区”（-A 表示全部，包括新增、修改、删除）；
- `git commit -m "..."`：正式生成一个存档点，引号里写清楚这次改了什么，方便以后回忆。比如：

```powershell
git commit -m "修复底图切换的缓存bug"
```

存完再执行 `git log --oneline`，新版本会出现在最上面。

**只想存某一个文件**时，把 `-A` 换成文件名：

```powershell
git add transit_site/app.js
git commit -m "改了 app.js"
```

### 4.4 查看某次存档改了什么：`git show`

```powershell
git show 5b98436 --stat
```

`--stat` 是“只看文件清单和行数统计”，不显示具体内容。想看具体内容就去掉 `--stat`。

### 4.5 对比两个版本：`git diff`

```powershell
git diff 17a01b9 5b98436 --stat
```

这会列出“修改前”和“修改后”相比多了哪些文件。想看某个文件的具体差异：

```powershell
git diff 17a01b9 5b98436 -- transit_site/app.js
```

`+` 开头的是新增的行，`-` 开头的是删除的行。

---

## 五、反悔与撤销（按危险程度从低到高）

### 5.1 放弃某个文件“还没存档”的改动（低风险，但会丢改动）

```powershell
git checkout -- 文件名
```

示例：

```powershell
git checkout -- transit_site/app.js
```

⚠️ 这个操作会用上一次存档的内容覆盖当前文件，**你没有存档过的修改会丢失**。执行前想清楚，或先复制一份文件备份。

### 5.2 撤销“已经 add 但还没 commit”的暂存（安全）

```powershell
git reset HEAD 文件名
```

只是把文件从“待存档区”移出来，文件内容不变。

### 5.3 撤销最后一次提交，但保留改动（较安全）

```powershell
git reset --soft HEAD~1
```

效果：删除最新一个存档点，但改动都还在，你可以重新整理后再提交。

### 5.4 撤销最后一次提交，且丢弃改动（危险！）

```powershell
git reset --hard HEAD~1
```

⚠️⚠️ 这会**彻底删除**最后一次存档及其所有改动，几乎无法找回。新手不建议用；如果要用，先确认 `git log --oneline` 里最新那条确实不想要了。

### 5.5 修改上一条提交的说明文字

```powershell
git commit --amend -m "新的说明文字"
```

### 5.6 从旧存档里“捞出”某个文件

如果你想把“修改前”的原始数据文件恢复出来：

```powershell
git checkout 17a01b9 -- guangzhou_bus_routes.dbf
```

这会把那个文件从旧存档复制到当前文件夹，不影响其他文件和历史。

---

## 六、哪些文件不会被存档？（.gitignore）

项目里有个 `.gitignore` 文件，里面列出的内容 git 会**自动跳过**，不会存档：

- 原始 GIS 数据（`*.shp`、`*.dbf` 等）——只作为基线存过一次；
- 大文件/临时文件（`_parsed_bus.json`）；
- 可重新生成的产物（`web_data/`、`brt_output/`、`transit_site/data/`）。

所以你会发现 `git status` 永远不显示这些文件，这是**正常的**，不是丢了。网站数据需要用脚本重新生成（见项目里的 `make_site_data.py`）。

想忽略新的内容，用记事本打开 `.gitignore`，加一行（文件夹加 `/`，如 `my_folder/`）保存即可。

---

## 七、分支（进阶，了解一下即可）

分支就是“并行的存档线”，适合做实验不干扰主线：

```powershell
git branch 实验分支        # 新建分支
git checkout 实验分支      # 切换过去
git checkout main          # 切回主线
```

新手阶段可以不碰分支，只在 `main` 上提交就够用了。

---

## 八、不想打命令？用图形界面

### 方案 A：VS Code（推荐，免费）

1. 打开 VS Code，菜单“文件 → 打开文件夹”，选 `D:\haowanyouxi\Canton\CPTOND-2025\Guangzhou`；
2. 左侧工具栏点“源代码管理”（图标像分叉的树枝）；
3. 改过的文件会列在“更改”里；点文件旁边的 `+` 号暂存；
4. 上方输入框写说明，点“提交”按钮即可。

### 方案 B：GitHub Desktop（纯图形，更简单）

官网下载安装后，“File → Add local repository”选择项目文件夹，之后所有操作都是按钮，无需命令。

---

## 九、常见报错与解决办法

### 报错：`not a git repository`
原因：当前目录不是项目文件夹。先执行 `cd D:\haowanyouxi\Canton\CPTOND-2025\Guangzhou` 再试。

### 报错：`Author identity unknown`（不知道你是谁）
第一次提交前先设置身份（引号里换成你的名字和邮箱）：

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

目前本仓库的提交身份是 “Codex”，想改成你的名字，执行上面两条后，再对已有提交执行：

```powershell
git commit --amend --reset-author
```

### 提示：`LF will be replaced by CRLF`
Windows 换行符提示，**无害**，不用管。

### 提示：`nothing to commit, working tree clean`
没有需要存档的改动，正常。

### 报错：`detected dubious ownership`
如果提示目录所有者不匹配，执行：

```powershell
git config --global --add safe.directory D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou
```

---

## 十、术语表

| 术语 | 意思 |
|---|---|
| 仓库（repository） | 项目文件夹 + 它的存档记录（.git） |
| 提交（commit） | 一个存档点 |
| 暂存区（staging area） | add 之后、commit 之前的中间状态 |
| add | 把改动放进暂存区 |
| commit | 把暂存区的改动正式存成版本 |
| status | 查看当前改动状态 |
| log | 查看存档历史 |
| diff | 对比差异 |
| checkout | 切换/恢复（不同用法含义不同，注意看上下文） |
| reset | 撤销/回退（有 --soft / --hard 之分） |
| branch | 分支，并行的存档线 |
| HEAD | 当前所在的最新存档位置 |
| .gitignore | 忽略文件清单 |

---

## 十一、安全建议（必读）

1. **经常存档**：改完一小步就 `git add -A` + `git commit -m "说明"`，养成习惯；
2. **提交说明写清楚**：一个月后你会靠它回忆当时改了什么；
3. **谨慎使用 `reset --hard` 和 `checkout --`**：会丢改动，拿不准就先问；
4. **重要文件先备份再折腾**：不确定的操作，先把文件夹复制一份到别处；
5. **本仓库已推送到 GitHub**（17512974001/Ranger），GitHub Pages 会自动发布网站。改完记得 `git push`，只提交不推送的话网站不会更新。

---

> 记不住没关系：最常用的就三句话——
> `git status`（看看）→ `git add -A`（放进暂存）→ `git commit -m "说明"`（存档）。
> 拿不准就问 AI，让它帮你跑。

---

## 十二、本项目专属：自己改完数据文件后，怎么上传

### 0. 先说清楚：网站用的是哪份数据

- 网页加载的是 `transit_site\data\` 文件夹里的数据（比如 `bus_routes.js`）；
- 根目录 `data\` 里是同一批数据的“分析用副本”；
- **两份必须保持一致**：你改了其中一份，另一份也要改成一样，否则网站不会显示你的改动（上次 106/107/108 电车公司名就是这样漏掉的）。

改完文件后，按下面任选一种方式上传。

### 方式 1：让 AI 代劳（最省事，推荐）

改完文件后，在 Codex 对话里直接说：

> 我改了 `data\bus_routes.js`，帮我同步两份并上传。

Codex 会帮你：把改动复制到 `transit_site\data\` → `git add` → `git commit` → `git push`。

### 方式 2：GitHub Desktop 可视化按钮（自己动手推荐）

1. 下载安装 [GitHub Desktop](https://desktop.github.com/)，登录你的 GitHub 账号；
2. 菜单 `File → Add local repository…`（添加本地仓库），选择文件夹 `D:\haowanyuxi\Canton\CPTOND-2025\Guangzhou`，点 Add；
3. 平时用记事本/编辑器正常改文件；
4. 改完打开 GitHub Desktop，窗口左侧 **Changes（更改）** 会列出所有改动的文件；
   - 如果改了 `data\bus_routes.js`，记得把同样的内容也同步到 `transit_site\data\bus_routes.js`（拿不准就让 AI 同步）；
5. 在左下角 **Summary（摘要）** 框写一句说明，例如“补充 106/107/108 公司名”；
6. 点 **Commit to main**（提交到 main）；
7. 点窗口顶部的 **Push origin**（推送到 GitHub）；
8. 完成。

### 方式 3：命令行（熟练后用）

在 PowerShell 里执行：

```powershell
cd D:\haowanyuxi\Canton\CPTOND-2025\Guangzhou
git add -A
git commit -m "说明这次改了什么"
git push
```

### 上传之后

- 等 1–2 分钟，GitHub Pages 会自动发布新版本；
- 打开网站后按 **Ctrl+F5** 强制刷新（防止浏览器缓存旧页面）；
- 如果没变化或报错，把现象截图发给 AI。

### 最容易踩的三个坑

1. **只改了根目录 `data\`，忘了同步 `transit_site\data\`** → 网站不更新（本次 106/107/108 就是）；
2. **改了文件但没点 Commit / 没执行 commit** → 文件只是躺在“更改”列表里，还没上传；
3. **在 GitHub 网页上直接编辑大文件**（如 `bus_routes.js`）→ 容易和本地不同步，非必要不用。
