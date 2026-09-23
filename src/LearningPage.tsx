import { useEffect, useState } from 'react';
import { ArrowRight, Award, BookOpen, Check, CheckCircle2, Clock3, GraduationCap, LockKeyhole, RotateCcw, Sparkles, Trophy, X } from 'lucide-react';
import { api } from './api';

export const DEMO_MODULE_ID = 'LM_PERIPHERALS_01';
export type Achievement = { achievement_id: string; title: string; description: string; icon: string; awarded_at?: string; source?: string };
type Module = { module_id: string; title: string; description: string; duration_minutes: number; skill_id: string;
  skill_name: string; gain: number; max_level: number; pass_percent: number };
type Lesson = { lesson_id: string; position: number; title: string; lead: string; points: string[]; tip: string };
type Question = { question_id: string; position: number; prompt: string; options: string[] };
type Progress = { status: 'not_started' | 'in_progress' | 'completed'; lesson_index: number; attempts: number; score_percent: number | null; completed_at: string | null };
type Course = { module: Module; lessons: Lesson[]; questions: Question[]; progress: Progress;
  attempts: { score_percent: number; correct_count: number; passed: boolean; attempted_at: string }[] };
type QuizResult = { passed: boolean; score: number; correctCount: number; totalQuestions: number;
  skill: { id: string; name: string; before: number; after: number };
  readiness: { before: number; after: number }; newAchievements: Achievement[] };

export function LearningPage({ employeeId, canParticipate, onCompleted, onJourney }: {
  employeeId: string; canParticipate: boolean; onCompleted: () => void; onJourney: () => void;
}) {
  const [course, setCourse] = useState<Course | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [celebration, setCelebration] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const route = `/api/employees/${employeeId}/learning/${DEMO_MODULE_ID}`;
  async function reload() { setCourse(await api<Course>(route)); }
  useEffect(() => { setCourse(null); setAnswers({}); setResult(null); setError(''); void reload().catch(failure => setError(failure.message)); }, [employeeId]);
  async function act(action: 'start' | 'advance') {
    if (!course) return;
    setBusy(true); setError('');
    try {
      await api(`${route}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'advance' ? { lessonIndex: course.progress.lesson_index } : {}) });
      await reload();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!course) return;
    if (course.questions.some(q => answers[q.question_id] === undefined)) { setError('Ответьте на все пять вопросов.'); return; }
    setBusy(true); setError('');
    try {
      const response = await api<QuizResult>(`${route}/quiz`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: course.questions.map(q => answers[q.question_id]) }) });
      setResult(response);
      await reload();
      if (response.passed) { onCompleted(); setCelebration(response); }
      else { setAnswers({}); }
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  if (!course) return <div className="loading-page">{error || 'Загружаем курс...'}</div>;
  const { module, lessons, questions, progress } = course;
  const lesson = lessons[progress.lesson_index];
  const completedLessons = Math.min(progress.lesson_index, lessons.length);
  const isQuiz = progress.status === 'in_progress' && completedLessons === lessons.length;
  return <>
    <div className="page-heading learning-heading"><div><span className="eyebrow">DEMO LEARNING · CAREER QUEST</span><h1>Обучение<span className="heading-dot">.</span></h1><p>Короткий курс, проверка знаний и ощутимый шаг к карьерной цели.</p></div><span className="pill violet"><GraduationCap size={15} /> Учебный модуль</span></div>
    <section className="learning-hero"><div><span className="eyebrow">01 / DIGITAL SKILLS</span><h2>{module.title}</h2><p>{module.description}</p><div className="learning-hero-meta"><span><Clock3 size={16} /> {module.duration_minutes} минут</span><span><BookOpen size={16} /> {lessons.length} урока</span><span><CheckCircle2 size={16} /> Тест · {questions.length} вопросов</span></div></div><div className="learning-hero-mark"><GraduationCap size={39} /></div></section>
    <div className="learning-layout"><section className="panel learning-stage"><div className="panel-header"><div><span className="eyebrow">ВАШ ПРОГРЕСС</span><h2>{progress.status === 'completed' ? 'Курс завершён' : progress.status === 'not_started' ? 'Готовы начать?' : isQuiz ? 'Проверка знаний' : `Урок ${progress.lesson_index + 1} из ${lessons.length}`}</h2></div><span className="learning-step-count">{completedLessons}/{lessons.length}</span></div>
      <div className="learning-progress-track"><span style={{ width: `${progress.status === 'completed' ? 100 : completedLessons / lessons.length * 100}%` }} /></div>
      {progress.status === 'not_started' && <div className="learning-intro"><div className="learning-symbol"><BookOpen size={28} /></div><h3>Небольшой курс, реальный прогресс</h3><p>Пройдите четыре коротких урока и ответьте на пять вопросов. Для зачёта нужно не менее {module.pass_percent}%. Результат и достижение сохраняются в вашем профиле.</p>{canParticipate ? <button className="button primary" disabled={busy} onClick={() => act('start')}>Начать обучение <ArrowRight size={18} /></button> : <div className="learning-readonly"><LockKeyhole size={17} /> Проходить курс может только сотрудник из своего аккаунта.</div>}</div>}
      {progress.status === 'in_progress' && !isQuiz && lesson && <div className="lesson-card"><span className="lesson-index">МАТЕРИАЛ {String(lesson.position).padStart(2, '0')}</span><h3>{lesson.title}</h3><p className="lesson-lead">{lesson.lead}</p><div className="lesson-points">{lesson.points.map(point => <div key={point}><span><Check size={15} /></span><p>{point}</p></div>)}</div><div className="lesson-tip"><Sparkles size={18} /><span>{lesson.tip}</span></div>{canParticipate && <button className="button primary" disabled={busy} onClick={() => act('advance')}>{busy ? 'Сохраняем...' : progress.lesson_index === lessons.length - 1 ? 'Перейти к тесту' : 'Следующий урок'} <ArrowRight size={18} /></button>}</div>}
      {isQuiz && <form className="learning-quiz" onSubmit={submit}><div className="quiz-intro"><span className="eyebrow">FINAL CHECK</span><h3>Проверьте, что запомнили</h3><p>Выберите один ответ для каждого вопроса. Проходной результат — {module.pass_percent}%. При необходимости тест можно повторить.</p></div>{questions.map((question, index) => <fieldset key={question.question_id} className="quiz-question"><legend><span>{String(index + 1).padStart(2, '0')}</span>{question.prompt}</legend><div className="quiz-options">{question.options.map((option, optionIndex) => <label key={optionIndex} className={answers[question.question_id] === optionIndex ? 'selected' : ''}><input type="radio" name={question.question_id} value={optionIndex} checked={answers[question.question_id] === optionIndex} onChange={() => setAnswers({ ...answers, [question.question_id]: optionIndex })} disabled={!canParticipate} /><span>{option}</span></label>)}</div></fieldset>)}{canParticipate && <button className="button primary" disabled={busy}>{busy ? 'Проверяем...' : 'Завершить тест'} <ArrowRight size={18} /></button>}</form>}
      {progress.status === 'completed' && <div className="learning-completed"><div className="learning-complete-icon"><Trophy size={31} /></div><span className="eyebrow">COMPLETED</span><h3>Новый навык в вашем профиле</h3><p>Курс успешно завершён. Результат теста и достижение сохранены в системе.</p><div className="learning-result-numbers"><div><strong>{progress.score_percent}%</strong><span>результат теста</span></div><div><strong>+{module.gain}</strong><span>{module.skill_name}</span></div></div><button className="button primary" onClick={onJourney}>Посмотреть траекторию <ArrowRight size={18} /></button></div>}
      {result && !result.passed && <div className="learning-retry"><RotateCcw size={20} /><div><strong>{result.score}% — до зачёта нужно {module.pass_percent}%</strong><p>Результат попытки сохранён. Повторите материалы и попробуйте тест ещё раз.</p></div></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      </section><aside className="panel learning-outline"><span className="eyebrow">ПРОГРАММА</span><h2>Ваш маршрут</h2><div>{lessons.map((item, index) => <div className={`learning-outline-item ${index < completedLessons ? 'done' : index === progress.lesson_index ? 'current' : ''}`} key={item.lesson_id}><span>{index < completedLessons ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{index < completedLessons ? 'Пройдено' : index === progress.lesson_index && progress.status === 'in_progress' ? 'Сейчас' : 'Впереди'}</small></div></div>)}<div className={`learning-outline-item ${isQuiz ? 'current' : progress.status === 'completed' ? 'done' : ''}`}><span>{progress.status === 'completed' ? <Check size={16} /> : '05'}</span><div><strong>Финальный тест</strong><small>{questions.length} вопросов · порог {module.pass_percent}%</small></div></div></div><div className="learning-outline-foot"><Award size={19} /><p>После зачёта вы получите профессиональный badge в профиле.</p></div></aside></div>
    {celebration && <div className="dialog-backdrop achievement-backdrop"><section className="achievement-dialog" role="dialog" aria-modal="true" aria-label="Получено достижение"><button className="achievement-close" aria-label="Закрыть" onClick={() => setCelebration(null)}><X size={20} /></button><div className="achievement-halo"><Award size={49} /></div><span className="eyebrow">НОВОЕ ДОСТИЖЕНИЕ</span><h2>{celebration.newAchievements[0]?.title ?? 'Обучение завершено'}</h2><p className="achievement-description">{celebration.newAchievements[0]?.description ?? 'Ваш результат сохранён в Career Quest.'}</p><div className="achievement-stats"><div><strong>{celebration.score}%</strong><span>тест · {celebration.correctCount}/{celebration.totalQuestions}</span></div><div><strong>{celebration.skill.before} → {celebration.skill.after}</strong><span>{celebration.skill.name}</span></div><div><strong>{celebration.readiness.before}% → {celebration.readiness.after}%</strong><span>готовность к цели</span></div></div>{celebration.newAchievements.length > 1 && <small>Также получено: {celebration.newAchievements.slice(1).map(item => item.title).join(', ')}</small>}<button className="button primary" onClick={() => setCelebration(null)}>Продолжить <ArrowRight size={17} /></button></section></div>}
  </>;
}
