import { App } from "antd";

export interface ConfirmOptions {
  content?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function useConfirm() {
  const { modal } = App.useApp();
  return (title: string, options?: ConfirmOptions) => new Promise<boolean>((resolve) => {
    modal.confirm({
      title,
      content: options?.content,
      okText: options?.okText ?? "确认",
      cancelText: options?.cancelText ?? "取消",
      okButtonProps: options?.danger ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
