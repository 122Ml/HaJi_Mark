export interface InteractionItem {
  id: string;
  title: string;
  content: string;
  className: string;
  course: string;
  createdAt: string;
  updatedAt: string;
  kind: "announcement" | "discussion";
  questions: { id: string; text: string; reply?: string }[];
}
export const interactionItems: InteractionItem[] = [
  {
    id: "announcement-1",
    title: "本周实践任务安排",
    content: "请先完成日志数据清洗资源学习，再提交代码题作业。",
    className: "大数据201",
    course: "course_big_data",
    createdAt: "2026/6/30 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
    kind: "announcement",
    questions: [],
  },
  {
    id: "announcement-2",
    title: "课堂测验说明",
    content:
      "Kafka 数据接入小测只读取已发布题目定义，未发布草稿不进入正式评价。",
    className: "大数据201",
    course: "course_big_data",
    createdAt: "2026/6/29 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
    kind: "announcement",
    questions: [],
  },
  {
    id: "discussion-1",
    title: "日志清洗作业容易漏掉哪些异常值？",
    content: "请结合本周日志数据清洗作业，讨论异常值识别与处理方法。",
    className: "大数据201",
    course: "course_big_data",
    createdAt: "2026/6/29 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
    kind: "discussion",
    questions: [
      {
        id: "q-1",
        text: "重复日志和缺失字段应该如何处理？",
        reply:
          "先识别重复记录并保留唯一事件，再根据字段业务含义处理缺失值，并记录处理依据。",
      },
    ],
  },
  {
    id: "discussion-2",
    title: "实时指标监控应该先看吞吐还是延迟？",
    content: "结合流处理系统，分析吞吐与延迟之间的关系。",
    className: "大数据201",
    course: "course_big_data",
    createdAt: "2026/6/28 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
    kind: "discussion",
    questions: [
      {
        id: "q-2",
        text: "高吞吐时如何保证延迟？",
        reply: "同时观察吞吐、端到端延迟和队列积压，结合业务目标确定优先级。",
      },
    ],
  },
];
