import { useEffect, useState } from 'react';
import { Award, BookOpen, CheckCircle2, Clock3 } from 'lucide-react';
import { api } from './api';

type LearningRow = { employee_id: string; full_name: string; module_id: string; module_title: string;
  status: 'in_progress' | 'completed'; lesson_index: number; lesson_count: number; attempts: number;
  score_percent: number | null; completed_at: string | null; achievements: { achievement_id: string; title: string }[] };
type HRLearning = { totalStarted: number; totalCompleted: number; averageScore: number; rows: LearningRow[] };

export function HRLearningPanel({ onSelectEmployee }: { onSelectEmployee: (id: string) => void }) {
  const [data, setData] = useState<HRLearning | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<HRLearning>('/api/hr/learning').then(setData).catch(failure => setError(failure.message)); }, []);
  return <section className="panel hr-learning-panel"><div className="panel-header"><div><span className="eyebrow">DEMO LEARNING ANALYTICS</span><h2>Обучение и достижения</h2></div><span className="pill light"><Award size={15} /> Learning</span></div>
    {error && <div className="form-error">{error}</div>}
    {data ? <><div className="hr-learning-metrics"><div><BookOpen size={19} /><strong>{data.totalStarted}</strong><span>начали курс</span></div><div><CheckCircle2 size={19} /><strong>{data.totalCompleted}</strong><span>завершили</span></div><div><Award size={19} /><strong>{data.averageScore}%</strong><span>средний успешный результат</span></div></div>
      <div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Курс</th><th>Прогресс</th><th>Тест</th><th>Достижения</th></tr></thead><tbody>{data.rows.map(row => <tr key={`${row.employee_id}:${row.module_id}`}><td><button className="learning-employee-link" onClick={() => onSelectEmployee(row.employee_id)}>{row.full_name}<small>{row.employee_id}</small></button></td><td><strong>{row.module_title}</strong></td><td>{row.status === 'completed' ? <span className="admin-status enabled">Completed</span> : <span className="learning-in-progress"><Clock3 size={13} /> {row.lesson_index}/{row.lesson_count} уроков</span>}</td><td>{row.score_percent === null ? '—' : <strong>{row.score_percent}%</strong>}</td><td>{row.achievements.length ? row.achievements.map(item => <span className="hr-achievement" key={item.achievement_id}>{item.title}</span>) : '—'}</td></tr>)}</tbody></table></div>{!data.rows.length && <div className="empty-small">Пока никто не начал demo-обучение. Войдите под learning@careerquest.demo, чтобы пройти полный сценарий.</div>}</>
      : !error && <div className="loading-inline">Загружаем прогресс обучения...</div>}
  </section>;
}
