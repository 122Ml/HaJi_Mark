import type { ReactNode } from "react";
import { Button } from "../ui";

export function Table({
  headers,
  rows,
  empty = "暂无数据",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: ReactNode;
}) {
  return (
    <div className="industry-table-wrap">
      <table className="industry-table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, column) => (
                  <td key={column}>{value}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function TeacherHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="hero-panel app-hero app-hero--teacher">
      <div className="app-hero-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-desc">{description}</p>
      </div>
      <div className="app-hero-actions">{children}</div>
    </section>
  );
}
export function ClassCourseFields({
  className,
  course,
  onClass,
  onCourse,
}: {
  className: string;
  course: string;
  onClass: (v: string) => void;
  onCourse: (v: string) => void;
}) {
  return (
    <div className="two-col">
      <label className="field">
        <span>班级</span>
        <select
          className="input"
          value={className}
          onChange={(e) => onClass(e.target.value)}
        >
          <option value="">未指定</option>
          <option>大数据201</option>
          <option>大数据2201</option>
        </select>
      </label>
      <label className="field">
        <span>课程</span>
        <select
          className="input"
          value={course}
          onChange={(e) => onCourse(e.target.value)}
        >
          <option value="">未指定</option>
          <option>course_big_data</option>
        </select>
      </label>
    </div>
  );
}
export function Refresh({ onClick }: { onClick: () => void }) {
  return <Button onClick={onClick}>刷新</Button>;
}
export const now = () => new Date().toLocaleString("zh-CN", { hour12: false });
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const statusName = (status: string) =>
  ({
    draft: "草稿",
    published: "已发布",
    closed: "已关闭",
    submitted: "已提交",
    graded: "已评分",
    assigned: "待处理",
    reviewed: "已复查",
  })[status] || status;
