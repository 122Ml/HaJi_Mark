import { App } from "antd";

export function useConfirm() {
  const { modal } = App.useApp();
  return (title: string) => new Promise<boolean>((resolve) => {
    modal.confirm({ title, okText: "确认", cancelText: "取消", onOk: () => resolve(true), onCancel: () => resolve(false) });
  });
}
