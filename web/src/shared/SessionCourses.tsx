import { useEffect, useState } from 'react';
import { requestJSON, APIError } from './api';
import { useSession } from './session';

interface Course { id:string;title:string;status:string;version:number;knowledge_point_count:number }
export function SessionCourses() {
  const {session, refresh} = useSession();
  const [courses,setCourses] = useState<Course[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [result,setResult] = useState('');
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    requestJSON<{data:Course[]}>('/me/courses',{signal:controller.signal})
      .then(({data})=>setCourses(data))
      .catch(err=>{ if(controller.signal.aborted)return;setError(err.message);if(err instanceof APIError&&err.status===401)refresh(); })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[session?.user.id,revision,refresh]);
  async function check(course:Course, write=false) {
    if (!session) return;
    try {
      const path=`/${session.user.role}/courses/${course.id}/${write?'access-check':'context'}`;
      await requestJSON(path,write?{method:'POST'}:{},write?session.csrf_token:undefined);
      setResult(`${course.title}：${write?'会话、课程归属及CSRF校验通过（此示例不写入课程）':'已从服务端读取授权课程信息'}`);
    } catch(err) {setResult(err instanceof Error?err.message:'校验失败');if(err instanceof APIError&&err.status===401)refresh();}
  }
  return <section className="session-courses card-panel" aria-label="当前账户与真实课程"><div className="section-head"><h2>我的真实课程</h2><button className="ghost-btn small" onClick={()=>setRevision(v=>v+1)}>刷新课程</button></div><p className="muted">登录与下列课程归属由服务端验证。下方学习、作业、评分和画像仍为构造演示，尚未接入业务数据库。</p>{loading?<p role="status">正在读取课程…</p>:error?<p role="alert">{error}</p>:!courses.length?<p>当前账户暂无可访问课程，请联系课程教师。</p>:<ul>{courses.map(course=><li key={course.id}><div><strong>{course.title}</strong><small>{course.status==='published'?'已发布':'草稿（仅教师可见）'} · v{course.version} · {course.knowledge_point_count}个知识点</small></div><div className="replica-actions"><button className="ghost-btn small" onClick={()=>check(course)}>读取课程</button><button className="ghost-btn small" onClick={()=>check(course,true)}>校验写请求</button></div></li>)}</ul>}{result&&<p role="status">{result}</p>}</section>;
}
