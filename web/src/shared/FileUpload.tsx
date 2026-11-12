import { Button, Upload } from "antd";
import type { UploadFile, UploadProps } from "antd";
import { useState } from "react";

// File selection stays local until the enclosing business form is submitted.
export function FileUpload({
  onChange,
  multiple,
  accept,
  disabled,
  "aria-label": label,
}: {
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-label"?: string;
}) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const change: UploadProps["onChange"] = ({ fileList }) => {
    const next = multiple ? fileList : fileList.slice(-1);
    setFiles(next);
    onChange(
      next.map((file) => file.originFileObj || (file as unknown as File)),
    );
  };
  return (
    <Upload
      accept={accept}
      multiple={multiple}
      disabled={disabled}
      fileList={files}
      beforeUpload={() => false}
      onChange={change}
    >
      <Button disabled={disabled} aria-label={label}>
        选择文件
      </Button>
    </Upload>
  );
}
