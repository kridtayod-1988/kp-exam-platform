/* Exam Engine API adapter. Answers autosave to the server; scoring and answer keys remain server-side. */
(() => {
  const config = window.KP_CONFIG || {};
  const baseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');

  async function request(path, options = {}) {
    if (!baseUrl) throw new Error('ยังไม่ได้กำหนด API URL');
    const method = options.method || 'GET';
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };
    if (method !== 'GET') {
      const csrfToken = window.KP_AUTH?.csrfToken;
      if (!csrfToken) throw new Error('กรุณาเข้าสู่ระบบก่อนเริ่มหรือส่งข้อสอบ');
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(baseUrl + path, {
      method,
      headers,
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

  async function startAttempt({ examYearId, examSetId = null, subcategoryId = null, questionCount, mode = 'practice' }) {
    const data = await request('/api/attempts', {
      method: 'POST',
      body: {
        exam_year_id: examYearId == null ? null : Number(examYearId),
        exam_set_id: examSetId == null ? null : Number(examSetId),
        subcategory_id: subcategoryId || null,
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
      mode: attempt.mode || mode,
      examYearLabel: attempt.exam_year_label || '',
      examSetTitle: attempt.exam_set_title || '',
      startedAt: attempt.started_at || new Date().toISOString(),
      deadlineAt: attempt.deadline_at || null,
      timeLimitSeconds: attempt.time_limit_seconds ?? null,
      questions: rawQuestions.map(normalizeQuestion)
    };
  }

  function normalizeAnswers(answers) {
    return answers.map(answer => ({
      question_id: answer.questionId,
      selected_index: answer.selectedIndex
    }));
  }

  async function saveAnswers(attemptId, answers) {
    return request('/api/attempts/' + encodeURIComponent(attemptId) + '/answers', {
      method: 'PATCH',
      body: { answers: normalizeAnswers(answers) }
    });
  }

  async function submitAttempt(attemptId, answers) {
    return request('/api/attempts/' + encodeURIComponent(attemptId) + '/submit', {
      method: 'POST',
      body: { answers: normalizeAnswers(answers) }
    });
  }

  async function resumeAttempt(attemptId) {
    const data = await request('/api/attempts/' + encodeURIComponent(attemptId));
    const attempt = data.attempt || {};
    const rawQuestions = data.questions || [];
    if (!attempt.id || !rawQuestions.length) throw new Error('ไม่พบข้อมูลชุดข้อสอบที่กลับมาทำต่อ');
    return {
      id: attempt.id,
      mode: attempt.mode || 'practice',
      examYearLabel: attempt.exam_year_label || '',
      examSetTitle: attempt.exam_set_title || '',
      startedAt: attempt.started_at || '',
      deadlineAt: attempt.deadline_at || null,
      timeLimitSeconds: attempt.time_limit_seconds ?? null,
      questions: rawQuestions.map(raw => ({
        ...normalizeQuestion(raw),
        selectedIndex: raw.selected_index ?? null
      }))
    };
  }

  async function getHistory({ page = 1, limit = 20 } = {}) {
    return request('/api/attempts?page=' + encodeURIComponent(page) + '&limit=' + encodeURIComponent(limit));
  }

  window.KP_EXAM_ENGINE = { startAttempt, resumeAttempt, saveAnswers, submitAttempt, getHistory };
})();
