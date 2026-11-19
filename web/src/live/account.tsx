import { Field } from "../shared/Field";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../shared/session";
import { APIError, requestJSON } from "../shared/api";
import { Feedback } from "./context";
import { useEditingControls } from "./editing";
import { PageHeader } from "../shared/PageHeader";
import { MetaTag, MetaTags } from "../shared/ui";
import { hasControlNull, utf8ByteLength } from "./validation";

export { RecordsPage } from "./records";

export function ProfilePage() {
  const { session, refresh, clearSession } = useSession();
  const { clearAllDirty } = useEditingControls();
  const navigate = useNavigate();

  const initialName = session?.user.display_name || "";
  const [name, setName] = useState(initialName);
  const lastSyncedNameRef = useRef(initialName);

  useEffect(() => {
    const serverName = session?.user.display_name || "";
    if (serverName !== lastSyncedNameRef.current) {
      setName((prev) => (prev === lastSyncedNameRef.current ? serverName : prev));
      lastSyncedNameRef.current = serverName;
    }
  }, [session?.user.display_name]);

  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileFailed, setProfileFailed] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMessage, setPwdMessage] = useState("");
  const [pwdFailed, setPwdFailed] = useState(false);

  const newPwdBytes = utf8ByteLength(newPassword);

  async function saveProfile() {
    const trimmed = name.trim();
    if (!trimmed || utf8ByteLength(trimmed) > 100 || hasControlNull(trimmed)) {
      setProfileFailed(true);
      setProfileMessage("显示姓名不能为空，且不能超过 100 字节");
      return;
    }
    setProfileBusy(true);
    setProfileFailed(false);
    setProfileMessage("");
    try {
      await requestJSON(
        "/learning/profile",
        {
          method: "PUT",
          body: JSON.stringify({ display_name: trimmed }),
        },
        session?.csrf_token,
      );
      lastSyncedNameRef.current = trimmed;
      setName(trimmed);
      setProfileMessage("资料已保存");
      refresh();
    } catch (e) {
      if (e instanceof APIError && e.status === 401) {
        refresh();
      }
      setProfileFailed(true);
      setProfileMessage(e instanceof Error ? e.message : "保存资料失败");
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword() {
    if (
      !oldPassword ||
      utf8ByteLength(oldPassword) > 72 ||
      hasControlNull(oldPassword)
    ) {
      setPwdFailed(true);
      setPwdMessage("请输入有效的原密码（不超过 72 字节）");
      return;
    }
    if (
      !newPassword.trim() ||
      newPwdBytes < 12 ||
      newPwdBytes > 72 ||
      hasControlNull(newPassword)
    ) {
      setPwdFailed(true);
      setPwdMessage("新密码须为 12 到 72 字节，且不能全为空白");
      return;
    }
    if (newPassword === oldPassword) {
      setPwdFailed(true);
      setPwdMessage("新密码不能与原密码相同");
      return;
    }
    if (confirmPassword !== newPassword) {
      setPwdFailed(true);
      setPwdMessage("两次输入的新密码不一致");
      return;
    }

    setPwdBusy(true);
    setPwdFailed(false);
    setPwdMessage("");
    try {
      await requestJSON(
        "/learning/password",
        {
          method: "PUT",
          body: JSON.stringify({
            old_password: oldPassword,
            new_password: newPassword,
          }),
        },
        session?.csrf_token,
      );
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      clearAllDirty();
      clearSession();
      navigate("/login", { replace: true });
    } catch (e) {
      setPwdFailed(true);
      setPwdMessage(e instanceof Error ? e.message : "修改密码失败");
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <div className="live-page">
      <PageHeader title="个人设置" />
      <div className="live-grid is-even">
        <Card className="card-panel" title="个人资料">
        {session && (
          <MetaTags>
            <MetaTag>账号：{session.user.username}</MetaTag>
            <MetaTag>
              身份：{session.user.role === "teacher" ? "教师" : "学生"}
            </MetaTag>
          </MetaTags>
        )}
        <Form
          className="live-form"
          style={{ marginTop: 12 }}
          onFinish={() => {
            void saveProfile();
          }}
          layout="vertical"
        >
          <Feedback message={profileMessage} failed={profileFailed} />
          <Field
            className="ui-field"
            label="显示姓名"
            required
            extra={
              <Typography.Text
                type={utf8ByteLength(name.trim()) > 100 ? "danger" : "secondary"}
              >
                {utf8ByteLength(name.trim())} / 100 字节
              </Typography.Text>
            }
          >
            <Input
              aria-label="显示姓名"
              value={name}
              onChange={(e) => {
                setProfileMessage("");
                setProfileFailed(false);
                setName(e.target.value);
              }}
            />
          </Field>
          <Button
            disabled={
              profileBusy ||
              !name.trim() ||
              name.trim() === (session?.user.display_name || "")
            }
            htmlType="submit"
            type="primary"
          >
            保存资料
          </Button>
        </Form>
      </Card>

      <Card className="card-panel" title="修改密码">
        <Form
          className="live-form"
          onFinish={() => {
            void savePassword();
          }}
          layout="vertical"
        >
          {pwdFailed && pwdMessage && (
            <Alert type="error" showIcon role="alert" message={pwdMessage} />
          )}
          <Field className="ui-field" label="原密码" required>
            <Input.Password
              aria-label="原密码"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => {
                setPwdFailed(false);
                setPwdMessage("");
                setOldPassword(e.target.value);
              }}
            />
          </Field>
          <Field
            className="ui-field"
            label="新密码"
            required
            extra={
              <Typography.Text
                type={
                  newPassword && (newPwdBytes < 12 || newPwdBytes > 72)
                    ? "danger"
                    : "secondary"
                }
              >
                当前 {newPwdBytes} 字节（要求 12–72 字节，不能全为空白）
              </Typography.Text>
            }
          >
            <Input.Password
              aria-label="新密码"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setPwdFailed(false);
                setPwdMessage("");
                setNewPassword(e.target.value);
              }}
            />
          </Field>
          <Field className="ui-field" label="确认新密码" required>
            <Input.Password
              aria-label="确认新密码"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setPwdFailed(false);
                setPwdMessage("");
                setConfirmPassword(e.target.value);
              }}
            />
          </Field>
          <p className="live-meta">
            修改密码后将注销当前及所有其他设备的登录会话，并跳转回登录页重新登录。
          </p>
          <Button disabled={pwdBusy} htmlType="submit">
            修改密码
          </Button>
        </Form>
      </Card>
      </div>
    </div>
  );
}
