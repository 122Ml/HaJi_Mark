import { useEffect, useRef } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Alert, Typography } from 'antd';
import { CoursePage } from '../features/course';
import { AssessmentPage } from '../features/assessment';
import { GradingPage } from '../features/grading';
import { InsightPage } from '../features/insight';

export function App() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const teacher = pathname.startsWith('/teacher');
  const root = teacher ? '/teacher' : '/student';
  useEffect(() => { mainRef.current?.focus(); }, [pathname]);
  return <>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="header">
      <Link to="/student/courses" className="brand">HaJi Mark <span>智能学习平台</span></Link>
      <nav aria-label="端口预览"><Link to="/student/courses">学生端</Link><Link to="/teacher/courses">教师端</Link></nav>
    </header>
    <div className="shell">
      <aside><nav aria-label="功能导航">
        <NavLink to={`${root}/courses`}>课程与学习</NavLink>
        <NavLink to={`${root}/assignments`}>测验与作业</NavLink>
        {teacher && <NavLink to="/teacher/grading">有据评阅</NavLink>}
        <NavLink to={`${root}/insight`}>{teacher ? '学情与干预' : '画像与学习任务'}</NavLink>
      </nav></aside>
      <main ref={mainRef} id="main-content" tabIndex={-1}>
        <Alert className="scaffold-notice" type="info" showIcon message="开发骨架预览 · 尚未接入身份认证，功能进度见项目 README。" />
        <Routes>
          <Route path="/" element={<Navigate replace to="/student/courses" />} />
          <Route path="/student/courses" element={<CoursePage />} />
          <Route path="/teacher/courses" element={<CoursePage />} />
          <Route path="/student/assignments" element={<AssessmentPage />} />
          <Route path="/teacher/assignments" element={<AssessmentPage />} />
          <Route path="/teacher/grading" element={<GradingPage />} />
          <Route path="/student/insight" element={<InsightPage teacher={false} />} />
          <Route path="/teacher/insight" element={<InsightPage teacher />} />
          <Route path="*" element={<><Typography.Title level={1}>页面不存在</Typography.Title><Link to="/">返回课程入口</Link></>} />
        </Routes>
      </main>
    </div>
  </>;
}
