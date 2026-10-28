# course 责任导航

当前活动业务在 `backend/internal/learning` 与 `web/src/live`，定位：course.go、curriculum.go、notes.go；course/curriculum/graph/notes.tsx。本目录保留原纵向责任入口，不另外注册重复服务。

课程/提交/评分/路径/干预均已接PostgreSQL，实际契约见 docs/contracts.md；每个对象校验课程和本人权限，认证写操作校验CSRF。查询在learning.sql，经sqlc生成store；迁移00001—00007已使用。AI按用户要求关闭，不返回假模型结果。

后续按docs/team.md领取垂直改进，修改后运行相应真实HTTP/Go/浏览器验收。结构化rubric、E6模型评阅和独立实验仍未完成，不能把整题人工评分或规则路径当作AI能力。
