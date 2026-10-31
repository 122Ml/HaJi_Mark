export interface NavigationGroup {
  label: string;
  links: [string, string][];
}

export const teacherNavigation: NavigationGroup[] = [
  { label: "教学概览", links: [["dashboard", "教学看板"], ["intervention", "干预任务"]] },
  { label: "课程与资源", links: [["course-twin", "课程与资料"]] },
  { label: "作业与评价", links: [["homework", "作业中心"], ["quiz", "测验"]] },
  { label: "交流与教研", links: [["interaction", "课程互动"], ["research", "教研记录"], ["industry-intelligence", "行业能力"]] },
];

export const studentNavigation: NavigationGroup[] = [
  { label: "学习概览", links: [["home", "我的概览"], ["learning", "学习路径"]] },
  { label: "课程与资源", links: [["course-content", "课程学习"]] },
  { label: "作业与测验", links: [["homework", "作业"], ["quiz", "测验"]] },
  { label: "任务与交流", links: [["intervention", "老师任务"], ["interaction", "课程互动"]] },
];

export function findGroup(groups: NavigationGroup[], root: string, pathname: string) {
  return groups.find((group) =>
    group.links.some(([path]) => pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`)),
  );
}

export function isLinkActive(root: string, path: string, pathname: string) {
  return pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`);
}
