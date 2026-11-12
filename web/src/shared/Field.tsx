import { Form, type FormItemProps } from "antd";
import { cloneElement, isValidElement, useId } from "react";

// Associate every visible label, including dynamic labels, with its control.
export function Field({ children, ...props }: FormItemProps) {
  const generatedID = useId();
  if (!isValidElement<{ id?: string }>(children)) return <Form.Item {...props}>{children}</Form.Item>;
  const id = children.props.id || generatedID;
  return <Form.Item {...props} htmlFor={id}>{cloneElement(children, { id })}</Form.Item>;
}
