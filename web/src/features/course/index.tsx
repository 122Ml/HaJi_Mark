import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, List, Skeleton, Typography } from 'antd';
import { getJSON } from '../../shared/api';

type Course = { id: string; title: string; version: number; knowledge_point_count: number };

export function CoursePage() {
  const query = useQuery({ queryKey: ['courses'], queryFn: ({ signal }) => getJSON<{ data: Course[] }>('/courses', signal) });
  return <section aria-labelledby="page-title">
    <Typography.Title id="page-title" level={1}>课程与学习</Typography.Title>
    <Typography.Paragraph>查看已发布的课程。课程资料、学习记录与提问将在后续迭代接入。</Typography.Paragraph>
    {query.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : query.isError ?
      <Alert type="error" showIcon message="课程加载失败" description={query.error.message}
        action={<Button onClick={() => void query.refetch()} loading={query.isFetching}>重试</Button>} /> :
      <List grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2 }} dataSource={query.data.data}
        locale={{ emptyText: '暂无已发布课程，请等待教师发布。' }}
        renderItem={(course) => <List.Item><Card title={course.title}>
          <p>发布版本 v{course.version}</p><p>{course.knowledge_point_count} 个知识点</p>
        </Card></List.Item>} />}
  </section>;
}
