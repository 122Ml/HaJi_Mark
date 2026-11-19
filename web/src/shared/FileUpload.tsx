import { Button, Upload } from "antd";
import type { UploadFile, UploadProps } from "antd";
import { useEffect, useState } from "react";

// File selection stays local until the enclosing business form is submitted.
export function FileUpload({
  onChange,
  multiple,
  accept,
  disabled,
  resetKey,
  "aria-label": label,
}: {
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  required?: boolean;
  resetKey?: number | string;
  "aria-label"?: string;
}) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  useEffect(() => {
    if (resetKey !== undefined) setFiles([]);
  }, [resetKey]);
  const change: UploadProps["onChange"] = ({ fileList }) => {
    const next = multiple ? fileList : fileList.slice(-1);
    setFiles(next);
    const extracted = next
      .map((file) => file.originFileObj)
      .filter((item): item is NonNullable<UploadFile["originFileObj"]> => Boolean(item));
    onChange(extracted);
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
