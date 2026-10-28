export interface Assignment {
  id: string;
  title: string;
  chapter: string;
  type: string;
  status: string;
  question: string;
  deadline: string;
  maxScore: number;
}
export interface Submission {
  id: string;
  assignmentId: string;
  answer: string;
  status: string;
  score?: number;
  aiScore?: number;
  comment?: string;
  submittedAt: string;
}
export interface TaskPack {
  id: string;
  title: string;
  student: string;
  status: string;
  progress: number;
  description: string;
  answer?: string;
  comment?: string;
}
export const assignments: Assignment[] = [
  {
    id: "7bcfeeef0a1e4363a7a348d9c42e85cc",
    title: "数据清洗概念测验",
    chapter: "日志数据清洗",
    type: "主观题",
    status: "published",
    question: "请结合课程内容完成作答。",
    deadline: "2026/7/4 16:35:58",
    maxScore: 100,
  },
  {
    id: "9f885eb50dca41e2",
    title: "数据采集流程分析",
    chapter: "数据采集流程",
    type: "主观题",
    status: "published",
    question: "请结合课程内容，说明数据采集、清洗与质量检验的完整流程。",
    deadline: "2026/7/3 16:35:58",
    maxScore: 100,
  },
  {
    id: "b7f17a5ba11b477cb58ed093b7e10f14",
    title: "日志字段统计代码题",
    chapter: "Kafka 数据接入",
    type: "主观题",
    status: "published",
    question: "请编写代码统计日志中各字段的分布，并说明异常值处理方式。",
    deadline: "2026/7/5 16:35:58",
    maxScore: 100,
  },
];
export const submissions: Submission[] = [
  {
    id: "sub-log",
    assignmentId: assignments[2].id,
    answer: "读取日志，按字段分组统计，清理空值并检查异常值。",
    status: "submitted",
    submittedAt: "2026/10/21 21:56:36",
  },
  {
    id: "sub-clean",
    assignmentId: assignments[0].id,
    answer:
      "数据清洗包括识别缺失值、处理重复记录、检测异常值和统一数据格式。清洗后需要验证数据完整性。",
    status: "graded",
    score: 68,
    aiScore: 66,
    comment: "已完成批改，建议按路径继续复习。",
    submittedAt: "2026/6/30 16:35:58",
  },
  {
    id: "sub-log-history",
    assignmentId: assignments[2].id,
    answer: "按日志字段分组统计频率，记录缺失字段与异常格式。",
    status: "graded",
    score: 72,
    aiScore: 70,
    comment: "已完成批改，建议按路径继续复习。",
    submittedAt: "2026/6/30 16:35:58",
  },
  {
    id: "sub-collect",
    assignmentId: assignments[1].id,
    answer: "确定数据源，采集数据并清洗，再进行数据质量评估。",
    status: "graded",
    score: 72,
    aiScore: 70,
    comment: "已完成批改，建议按路径继续复习。",
    submittedAt: "2026/6/30 16:35:58",
  },
];
export const taskPacks: TaskPack[] = [
  {
    id: "showcase_pkg_zyh",
    title: "showcase",
    student: "曾懿涵",
    status: "assigned",
    progress: 0,
    description:
      "围绕 数据采集流程 安排资源复习、测验和一道练习，请按任务包完成学习与练习",
  },
];
export const chapters = [
  "大数据基础概念",
  "数据获取",
  "数据质量与预处理",
  "数据存储系统",
  "数据处理系统",
  "大数据平台与工具",
  "大数据应用与挑战",
];
export const sections = [
  "大数据生命周期与应用",
  "大数据基本概念",
  "大数据特征与类型",
  "大数据技术与模型",
];
export const knowledge = [
  "大数据生命周期",
  "大数据驱动因素",
  "DIKW金字塔模型",
  "商务智能的发展过程",
];
