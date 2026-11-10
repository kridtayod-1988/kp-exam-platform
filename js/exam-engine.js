/* Exam Engine API adapter. Answers stay in memory; scoring and answer keys remain server-side. */
(() => {
  const config = window.KP_CONFIG || {};
  const baseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');

  async function request(path, options = {}) {
    if (!baseUrl) throw new Error('ยังไม่ได้กำหนด API URL');
    const response = await fetch(baseUrl + path, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message || payload.error || 'API ตอบกลับ HTTP ' + response.status;
      throw new Error(message);
    }
    return payload.data ?? payload;
  }

  function normalizeQuestion(raw) {
    if (!raw || raw.id === undefined || typeof raw.question_text !== 'string') {
      throw new Error('รูปแบบข้อมูลข้อสอบจาก API ไม่ถูกต้อง');
    }
    const choices = Array.isArray(raw.choices) ? raw.choices :
      (Array.isArray(raw.options) ? raw.options : []);
    if (!choices.length) throw new Error('ข้อสอบไม่มีตัวเลือก');
    return {
      id: raw.id,
      questionText: raw.question_text,
      passage: typeof raw.passage === 'string' ? raw.passage : '',
      choices: choices.map(choice => typeof choice === 'string' ? choice : String(choice?.text ?? '')),
      subject: raw.subject_name || raw.subject || ''
    };
  }

  async function startAttempt({ examYearId, questionCount, mode = 'practice' }) {
    const data = await request('/api/attempts', {
      method: 'POST',
      body: {
        exam_year_id: examYearId,
        question_count: questionCount,
        mode
      }
    });
    const attempt = data.attempt || data;
    const rawQuestions = data.questions || attempt.questions;
    if (!attempt.id || !Array.isArray(rawQuestions) || !rawQuestions.length) {
      throw new Error('API ยังไม่ส่งข้อมูล Attempt และรายการข้อสอบตามสัญญา');
    }
    return {
      id: attempt.id,
      examYearLabel: attempt.exam_year_label || '',
      startedAt: attempt.started_at || new Date().toISOString(),
      questions: rawQuestions.map(normalizeQuestion)
    };
  }

  async function submitAttempt(attemptId, answers) {
    const normalized = answers.map(answer => ({
      question_id: answer.questionId,
      selected_index: answer.selectedIndex
    }));
    return request('/api/attempts/' + encodeURIComponent(attemptId) + '/submit', {
      method: 'POST',
      body: { answers: normalized }
    });
  }

  window.KP_EXAM_ENGINE = { startAttempt, submitAttempt };
})();
