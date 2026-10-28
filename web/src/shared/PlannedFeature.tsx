import { Empty, Typography } from 'antd';

export function PlannedFeature({ title, description }: { title: string; description: string }) {
  return <section aria-labelledby="page-title">
    <Typography.Title id="page-title" level={1}>{title}</Typography.Title>
    <Typography.Paragraph>{description}</Typography.Paragraph>
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="功能尚在建设中，当前没有业务记录。" />
  </section>;
}
