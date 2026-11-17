import { Alert, Button, Card, Drawer, Pagination, Space, Table, Tag, Typography } from "antd";
import { useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../shared/ui";
import type { ReactNode } from "react";
import type { AssistAnswer } from "./knowledge";
import { useLiveQuery, when } from "./context";

type Turn = { id: string; question: string; state: string; created_at: string; profile_id: string; response: AssistAnswer };

export function RetrievalHistory({ reuse, renderAnswer }: { reuse: (question: string) => void; renderAnswer: (answer: AssistAnswer) => ReactNode }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("history_page")) || 1);
  const selected = params.get("turn") || "";
  const history = useLiveQuery<{ rows: Turn[]; total: number }>(`/assist/history?page=${page}&size=10`);
  const detail = useLiveQuery<Turn>(`/assist/history/${selected}`, !!selected, true);
  function select(id: string) {
    setParams(p => { id ? p.set("turn", id) : p.delete("turn"); return p; });
  }
  const state = (value: string) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "processing"}>{value === "succeeded" ? "已保存" : value === "failed" ? "生成未完成" : "结果待核对"}</Tag>;
  return <>
    <Card className="card-panel" title="我的问答历史" extra={<Button loading={history.isFetching} onClick={() => void history.refetch()}>刷新</Button>}>
      {history.error ? <ErrorState message={history.error.message} onRetry={() => void history.refetch()} /> : <>
        <Table<Turn> rowKey="id" loading={history.isPending} dataSource={history.data?.rows || []} pagination={false} scroll={{ x: 520 }} locale={{ emptyText: "完成一次资料问答后，记录会保存在这里" }} columns={[
          { title: "问题", dataIndex: "question", ellipsis: true, render: (text: string, row) => <Button type="link" className="table-text-action" onClick={() => select(row.id)}>{text}</Button> },
          { title: "状态", dataIndex: "state", width: 120, render: state },
          { title: "时间", dataIndex: "created_at", width: 180, render: when },
        ]} />
        <Pagination current={page} pageSize={10} total={history.data?.total || 0} showSizeChanger={false} hideOnSinglePage onChange={v => setParams(p => { p.set("history_page", String(v)); return p; })} />
      </>}
    </Card>
    <Drawer open={!!selected} title="问答记录" width={720} onClose={() => select("")} destroyOnHidden>
      {detail.isPending ? <LoadingState /> : detail.error ? <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /> : detail.data && <Space direction="vertical" size="middle" className="live-full-width">
        <Typography.Paragraph strong>{detail.data.question}</Typography.Paragraph>
        <Space wrap>{state(detail.data.state)}<Typography.Text type="secondary">{when(detail.data.created_at)}</Typography.Text></Space>
        {detail.data.state === "succeeded" ? renderAnswer(detail.data.response) : <Alert type="warning" showIcon message="本次尚无已保存回答" description="可刷新核对。需要重新请求时，先将问题带回输入框；系统不会自动重复模型调用。" action={<Button onClick={() => void detail.refetch()}>刷新记录</Button>} />}
        <Button onClick={() => { reuse(detail.data!.question); select(""); }}>带回输入框</Button>
      </Space>}
    </Drawer>
  </>;
}
