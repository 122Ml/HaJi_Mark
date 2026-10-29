export interface NavigationGroup {
  label: string;
  links: [string, string][];
}

export const teacherNavigation: NavigationGroup[] = [
  { label: "教学概览", links: [["dashboard", "教师看板"], ["intervention", "干预任务"]] },
  { label: "课程与资源", links: [["course-twin", "课程底座"]] },
  { label: "作业与评价", links: [["homework", "作业中心"], ["quiz", "测验中心"]] },
  { label: "交流与教研", links: [["interaction", "教学互动"], ["research", "教研协同"], ["industry-intelligence", "行业能力"]] },
];

export const studentNavigation: NavigationGroup[] = [
  { label: "学习概览", links: [["home", "今日学习"], ["learning", "个性化路径"]] },
  { label: "课程与资源", links: [["course-content", "学习中心"]] },
  { label: "作业与测验", links: [["homework", "作业测验"], ["quiz", "在线测验"]] },
  { label: "任务与交流", links: [["intervention", "老师任务"], ["interaction", "互动答疑"]] },
];
