export type NavigationIcon =
  | "dashboard"
  | "book"
  | "clipboard"
  | "chart"
  | "sliders"
  | "message"
  | "sparkles"
  | "target"
  | "git-branch";

export interface NavigationGroup {
  label: string;
  icon: NavigationIcon;
  links: [string, string][];
}

export const teacherNavigation: NavigationGroup[] = [
  { label: "教学概览", icon: "dashboard", links: [["dashboard", "教学看板"]] },
  { label: "课程管理", icon: "sliders", links: [["courses", "课程与成员"], ["curriculum", "课程目录"]] },
  { label: "课程内容", icon: "book", links: [["materials", "学习资料"], ["knowledge", "知识库"], ["question-bank", "题库与标准"], ["retrieval", "检索与问答"], ["content-impact", "内容变更"]] },
  { label: "作业与批阅", icon: "clipboard", links: [["homework", "作业中心"], ["quiz", "测验"], ["regrades", "整组重评"]] },
  { label: "学情与干预", icon: "chart", links: [["insight", "学情分析"], ["intervention", "补学补练"]] },
  { label: "交流与记录", icon: "message", links: [["interaction", "课程互动"], ["research", "教研记录"], ["industry-intelligence", "行业能力"]] },
  { label: "课程助理", icon: "sparkles", links: [["assistant", "课程助理"]] },
];

export const studentNavigation: NavigationGroup[] = [
  { label: "我的任务", icon: "target", links: [["home", "我的概览"], ["intervention", "老师任务"]] },
  { label: "课程学习", icon: "book", links: [["course-content", "学习资料"], ["knowledge", "知识库"], ["retrieval", "资料问答"]] },
  { label: "作业与反馈", icon: "clipboard", links: [["homework", "作业"], ["quiz", "测验"]] },
  { label: "学习路径", icon: "git-branch", links: [["learning", "学习路径"]] },
  { label: "课程交流", icon: "message", links: [["interaction", "课程互动"]] },
  { label: "课程助理", icon: "sparkles", links: [["assistant", "课程助理"]] },
];

export function findGroup(groups: NavigationGroup[], root: string, pathname: string) {
  return groups.find((group) =>
    group.links.some(([path]) => pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`)),
  );
}

export function isLinkActive(root: string, path: string, pathname: string) {
  return pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`);
}
