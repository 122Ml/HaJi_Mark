import { PlannedFeature } from '../../shared/PlannedFeature';

export function InsightPage({ teacher }: { teacher: boolean }) {
  return <PlannedFeature title={teacher ? '学情与教学干预' : '画像与学习任务'}
    description={teacher ? '从班级完成情况查看个人证据，安排补学补练并复查结果。' : '查看有证据的学习反馈、推荐资料与教师任务，继续学习。'} />;
}
