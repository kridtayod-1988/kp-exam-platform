(() => {
  const cfg=window.KP_CONFIG||{};
  const root=document.getElementById('view-container');
  const sidebar=document.getElementById('sidebar');
  const scrim=document.getElementById('scrim');
  const titles={dashboard:'ภาพรวม','by-year':'ฝึกสอบตามรายวิชา',mock:'คลังข้อสอบ',bank:'จำลองสนามจริง',results:'ผลการสอบ',member:'สมาชิก'};
  let years=[];
  let catalog={subject_groups:[],subcategories:[]};
  let examSets=[];
  let viewRequestId=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function notify(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),2600);}
  const intro=(title,desc)=>`<div class="page-intro"><div><h2>${title}</h2><p>${desc}</p></div></div>`;
  const panelHead=(title,desc)=>`<div class="panel-head"><div><h3>${title}</h3><p>${desc||''}</p></div></div>`;
  function dashboard(){return `
    <section class="welcome"><div class="welcome-inner"><div class="overline">YOUR NEXT STEP STARTS HERE</div><h2>เตรียมสอบ ก.พ. อย่างเป็นระบบ</h2><p>ฝึกฝนอย่างมีเป้าหมาย ติดตามพัฒนาการ และพร้อมสำหรับทุกสนามสอบ</p><div class="welcome-actions"><button class="btn light" data-go="by-year">ฝึกสอบตามรายวิชา</button><button class="btn ghost" data-go="mock">เปิดคลังข้อสอบ</button></div></div></section>
    <div class="stats">
      <article class="stat"><div class="stat-top">คะแนนเฉลี่ย <span class="stat-icon">◉</span></div><div class="stat-value">—</div><div class="stat-foot">รอข้อมูลผลการสอบ</div></article>
      <article class="stat"><div class="stat-top">ชุดข้อสอบที่ทำแล้ว <span class="stat-icon">▤</span></div><div class="stat-value">0</div><div class="stat-foot">เริ่มฝึกเพื่อบันทึกสถิติ</div></article>
      <article class="stat"><div class="stat-top">เวลาฝึกทั้งหมด <span class="stat-icon">◷</span></div><div class="stat-value">0 ชม.</div><div class="stat-foot">เวลาฝึกสะสม</div></article>
      <article class="stat"><div class="stat-top">ความคืบหน้า <span class="stat-icon">↗</span></div><div class="stat-value">0%</div><div class="stat-foot">เป้าหมายการเตรียมสอบ</div></article>
    </div>
    <div class="section-head"><div><h3>เลือกวิธีฝึกของคุณ</h3><p>เริ่มจากรูปแบบที่เหมาะกับเป้าหมาย</p></div></div>
    <div class="quick-grid">
      <article class="feature"><div class="feature-icon">▣</div><h3>ฝึกสอบตามรายวิชา</h3><p>เลือกจากรายวิชาที่มีในฐานข้อมูล พร้อมดูจำนวนข้อสอบก่อนเริ่มฝึก</p><button class="btn" data-go="by-year">เลือกรายวิชา</button></article>
      <article class="feature"><div class="feature-icon">◷</div><h3>คลังข้อสอบ</h3><p>เลือกชุดข้อสอบตามรอบสอบ วันที่ และจำนวนข้อจากฐานข้อมูล</p><button class="btn soft" data-go="mock">เลือกชุดข้อสอบ</button></article>
      <article class="feature"><div class="feature-icon">▤</div><h3>จำลองสนามจริง</h3><p>ฝึกทำข้อสอบแบบจับเวลา พร้อมบันทึกคำตอบและรายงานผล</p><button class="btn soft" data-go="bank">ดูรูปแบบการสอบ</button></article>
    </div>
    <div class="dashboard-grid">
      <section><div class="section-head"><div><h3>กิจกรรมล่าสุด</h3><p>ประวัติการฝึกและผลสอบของคุณ</p></div><button class="text-link" data-go="results">ดูผลการสอบ</button></div><div class="panel"><div class="empty"><strong>ยังไม่มีกิจกรรม</strong>เมื่อเริ่มทำข้อสอบ ประวัติและคะแนนจะปรากฏที่นี่</div></div></section>
      <section><div class="section-head"><div><h3>เป้าหมายการเตรียมสอบ</h3><p>ติดตามแผนการฝึกของคุณ</p></div></div><div class="panel"><div class="score-placeholder"><div class="score-ring">0%</div><p class="muted" style="font-size:10px">ยังไม่ได้ตั้งเป้าหมาย</p><button class="btn soft small" data-go="member">ดูบัญชีสมาชิก</button></div></div></section>
    </div>`;}
  async function fetchYears(){
    const base=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    if(!base)return [];
    const response=await fetch(base+'/api/exam-years',{headers:{Accept:'application/json'},credentials:'include'});
    if(!response.ok)throw new Error('API '+response.status);
    const body=await response.json();
    const list=Array.isArray(body)?body:(body.data?.exam_years||body.data?.years||body.exam_years||body.examYears||body.years||[]);
    return list.filter(x=>x&&x.is_active!==0&&x.is_active!==false).map(x=>({id:x.id,label:x.label||String(x.year_be??x.year??''),year:x.year_be??x.year,questionCount:Number(x.question_count||0)})).filter(x=>x.id!==undefined&&x.label);
  }
  async function fetchCatalog(){
    const base=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    if(!base)throw new Error('ยังไม่ได้กำหนด API URL');
    const response=await fetch(base+'/api/catalog',{headers:{Accept:'application/json'},credentials:'include'});
    if(!response.ok)throw new Error('API '+response.status);
    const body=await response.json();
    const data=body.data||body;
    return {subject_groups:data.subject_groups||[],subcategories:data.subcategories||[]};
  }
  async function fetchExamSets(){
    const base=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    if(!base)throw new Error('ยังไม่ได้กำหนด API URL');
    const response=await fetch(base+'/api/exam-sets',{headers:{Accept:'application/json'},credentials:'include'});
    if(!response.ok)throw new Error('API '+response.status);
    const body=await response.json();
    const data=body.data||body;
    return data.exam_sets||[];
  }
  function byYear(){
    const groups=catalog.subject_groups||[];
    const subjects=catalog.subcategories||[];
    return intro('ฝึกสอบตามรายวิชา','เลือกวิชาที่ต้องการฝึก ระบบจะแสดงจำนวนข้อสอบที่มีอยู่จริงในฐานข้อมูล')+
      (groups.length?groups.map(group=>{
        const items=subjects.filter(subject=>subject.subject_group_id===group.id);
        if(!items.length)return '';
        return `<section class="subject-section"><div class="section-head"><div><h3>${esc(group.name)}</h3><p>${Number(group.question_count||0)} ข้อในหมวดนี้</p></div></div><div class="subject-grid">${items.map(subject=>{
          const count=Number(subject.question_count||0);
          const yearId=subject.latest_exam_year_id;
          const canStart=count>=10&&yearId;
          return `<article class="panel subject"><span class="badge gray">${count} ข้อในคลัง</span><h3>${esc(subject.name)}</h3><p>${count?'เลือกฝึกจากข้อสอบที่มีในฐานข้อมูล':'ยังไม่มีข้อสอบในรายวิชานี้'}</p><div class="subject-meta"><span>${count?'พร้อมฝึก':'รอเพิ่มข้อสอบ'}</span><span>${canStart?'เริ่มได้ 10 ข้อ':'ยังไม่ครบ 10 ข้อ'}</span></div><button class="btn ${canStart?'':'outline'}" data-practice-subject="${esc(subject.id)}" data-practice-year="${esc(yearId||'')}" ${canStart?'':'disabled'}>${canStart?'เริ่มฝึก 10 ข้อ':'ยังไม่พร้อม'}</button></article>`;
        }).join('')}</div></section>`;
      }).join(''):'<div class="panel empty">ยังไม่พบรายวิชาในฐานข้อมูล</div>')+
      '<div class="alert info">ขณะนี้มีโครงสร้างรายวิชา 20 รายการ จำนวนข้อสอบจะแสดงตามข้อมูลจริง แต่ละวิชาที่มีอย่างน้อย 10 ข้อจึงจะเริ่มฝึกได้</div>';
  }
  function formatExamDate(value){
    if(!value)return 'ไม่ระบุวันที่';
    const date=new Date(value+'T00:00:00+07:00');
    return Number.isNaN(date.getTime())?esc(value):new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(date);
  }
  function mock(){
    return intro('คลังข้อสอบ','เลือกชุดข้อสอบตามรอบวันเดือนปี และจำนวนข้อที่บันทึกอยู่ในฐานข้อมูล')+
      (examSets.length?'<div class="subject-grid">'+examSets.map(set=>{
        const count=Number(set.question_count||0);
        const defaultCount=Math.min(Number(set.default_question_count||50),50);
        return `<article class="panel subject"><span class="badge">${esc(set.session_label||'ชุดข้อสอบ')}</span><h3>${esc(set.title)}</h3><p>${formatExamDate(set.exam_date)} • พ.ศ. ${esc(set.year_be)}</p><div class="subject-meta"><span>จำนวนข้อสอบในชุด</span><strong>${count} ข้อ</strong></div><div class="subject-meta"><span>รูปแบบจำลอง</span><span>${defaultCount} ข้อ • 60 นาที</span></div><button class="btn" data-start-set="${esc(set.id)}" data-set-year="${esc(set.exam_year_id)}" data-set-count="${defaultCount}" ${count>=defaultCount?'':'disabled'}>${count>=defaultCount?'เริ่มจำลองสนามจริง':'ข้อสอบยังไม่ครบจำนวน'}</button><small class="hint">${set.source_status==='user_supplied_unverified'?'ชุดเริ่มต้นจากไฟล์ผู้ใช้ • แหล่งที่มายังไม่ยืนยัน':''}</small></article>`;
      }).join('')+'</div>':'<div class="panel empty"><strong>ยังไม่มีชุดข้อสอบ</strong>เมื่อมีการนำเข้าชุดข้อสอบแล้ว รายการจะแสดงที่นี่โดยอัตโนมัติ</div>')+
      '<div class="alert info">จำนวนข้อสอบและวันที่แสดงจากฐานข้อมูลโดยตรง ไม่มีตัวเลือกแบบดอปดาวน์</div>';
  }
  function bank(){
    const groups=catalog.subject_groups||[];
    return intro('จำลองสนามจริง','ฝึกทำข้อสอบในสภาพแวดล้อมใกล้เคียงการสอบจริง พร้อมจับเวลาและบันทึกคำตอบอัตโนมัติ')+
      '<div class="subject-grid">'+groups.map(group=>`<article class="panel subject"><div class="feature-icon">▣</div><span class="badge gray">หมวดวิชา</span><h3>${esc(group.name)}</h3><p>มีข้อสอบในฐานข้อมูล ${Number(group.question_count||0)} ข้อ</p></article>`).join('')+'</div>'+
      '<section class="panel form-panel"><div class="panel-head"><div><h3>ระบบจำลองสนามสอบ</h3><p>ใช้เวลาสอบจาก Server และบันทึกคำตอบระหว่างทำข้อสอบ</p></div><span class="badge">60 นาที</span></div><div class="form-actions"><button class="btn" data-go="mock">เลือกชุดข้อสอบเพื่อเริ่ม</button></div></section>';
  }
  function results(){return intro('ผลการสอบ','ดูคะแนนย้อนหลัง วิเคราะห์ผลรายวิชา และวางแผนทบทวน')+
    '<div id="results-summary" class="stats"><div class="panel">กำลังโหลดสรุปผลการสอบ…</div></div>'+
    '<div class="section-head"><div><h3>ประวัติการสอบ</h3><p>แสดงเฉพาะประวัติของบัญชีที่เข้าสู่ระบบ</p></div></div>'+
    '<div id="history-panel" class="panel"><div class="empty">กำลังโหลดประวัติการสอบ…</div></div>';}
  function memberRoleMarkup(){const profile=window.KP_AUTH?.profile;const role=profile?.role;if(role==='admin')return '<span id="member-role-badge" class="badge">Admin</span>';if(window.KP_AUTH?.authenticated&&role==='user')return '<span id="member-role-badge" class="badge gray">User</span>';return '<span id="member-role-badge" class="badge gray">Guest</span>';}
  function member(){return intro('สมาชิกและแพ็กเกจ','จัดการบัญชี ตรวจสอบสิทธิ์ และดูแพ็กเกจการใช้งาน')+`
    <section class="panel"><div class="panel-head"><div><h3>ข้อมูลบัญชี</h3><p>สถานะการเข้าสู่ระบบปัจจุบัน</p></div>${memberRoleMarkup()}</div><div class="alert">เข้าสู่ระบบด้วย Google ได้จากปุ่มด้านบนของหน้าเว็บ เมื่อเข้าสู่ระบบสำเร็จ ชื่อและบทบาทของบัญชีจะแสดงบริเวณมุมขวาบน</div></section>
    <div class="section-head"><div><h3>แพ็กเกจสมาชิก</h3><p>โครงสร้างสิทธิ์การใช้งานเบื้องต้น</p></div></div>
    <div class="plan-grid"><article class="plan"><span class="badge gray">เริ่มต้น</span><h3>Free</h3><div class="plan-price">ฟรี</div><p>เริ่มต้นฝึกและทำความคุ้นเคยกับระบบ</p><ul><li>ฝึกข้อสอบตามโควตาที่กำหนด</li><li>ดูผลการฝึกเบื้องต้น</li></ul><button class="btn outline" disabled>แพ็กเกจปัจจุบัน (ตัวอย่าง)</button></article>
    <article class="plan"><span class="badge">สำหรับผู้เตรียมสอบ</span><h3>Premium</h3><div class="plan-price">—</div><p>เพิ่มขีดความสามารถในการฝึกและวิเคราะห์ผล</p><ul><li>สิทธิ์ฝึกข้อสอบตามแพ็กเกจ</li><li>Mock Exam และรายงานเชิงลึก</li></ul><button class="btn soft" disabled>ยังไม่เปิดจำหน่าย</button></article>
    <article class="plan"><span class="badge gray">สำหรับองค์กร</span><h3>Enterprise</h3><div class="plan-price">ติดต่อ</div><p>เครื่องมือสำหรับการจัดการผู้เรียนเป็นกลุ่ม</p><ul><li>จัดการสมาชิกและสิทธิ์</li><li>รายงานภาพรวมองค์กร</li></ul><button class="btn outline" disabled>ยังไม่เปิดให้บริการ</button></article></div>`;}
  const views={dashboard,'by-year':byYear,mock,bank,results,member};
  function closeMenu(){sidebar.classList.remove('open');scrim.classList.remove('show');}
  async function show(key){
    if(!views[key])key='dashboard';
    const requestId=++viewRequestId;
    root.innerHTML=views[key]();
    document.getElementById('page-title').textContent=titles[key];
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===key));
    closeMenu();
    try{
      if(key==='by-year'){
        const [nextCatalog,nextYears]=await Promise.all([fetchCatalog(),fetchYears()]);
        catalog=nextCatalog;years=nextYears;
      }else if(key==='bank'){
        catalog=await fetchCatalog();
      }else if(key==='mock'){
        examSets=await fetchExamSets();
      }
      if(requestId===viewRequestId)root.innerHTML=views[key]();
    }catch(err){
      if(requestId===viewRequestId){
        root.innerHTML+=`<div class="alert error">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</div>`;
        notify('โหลดข้อมูลไม่สำเร็จ: '+err.message);
      }
    }
    if(key==='results')loadResults(1).catch(err=>{const panel=document.getElementById('history-panel');if(panel)panel.textContent='โหลดประวัติไม่สำเร็จ: '+err.message;});
  }
  document.getElementById('main-nav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)show(b.dataset.view);});
  window.addEventListener('kp-auth-state',event=>{const badge=document.getElementById('member-role-badge');if(!badge)return;const profile=event.detail?.profile;const role=profile?.role;if(!event.detail?.authenticated){badge.textContent='Guest';badge.className='badge gray';return;}badge.textContent=role==='admin'?'Admin':'User';badge.className=role==='admin'?'badge':'badge gray';});

  let activeAttempt=null;
  let attemptAnswers={};
  let currentQuestionIndex=0;
  let submitting=false;
  let autosaveTimer=null;
  let autosaveState='saved';
  let autosaveSequence=0;
  let autosaveInFlight=false;
  let autosaveQueued=false;
  let countdownTimer=null;

  function renderAttempt(){
    if(!activeAttempt)return;
    const q=activeAttempt.questions[currentQuestionIndex];
    const selected=attemptAnswers[String(q.id)];
    const remaining=activeAttempt.deadlineAt?Math.max(0,Math.ceil((Date.parse(activeAttempt.deadlineAt)-Date.now())/1000)):null;
    const clock=remaining===null?'ไม่จำกัดเวลา':String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
    const saveLabel=autosaveState==='saving'?'กำลังบันทึก…':autosaveState==='pending'?'รอบันทึก…':autosaveState==='error'?'บันทึกไม่สำเร็จ':'บันทึกแล้ว';
    root.innerHTML=`<div class="exam-toolbar"><button class="btn soft small" id="exit-attempt">ออกจากข้อสอบ</button><span class="badge">${activeAttempt.mode==='simulation'?'Mock Exam':'กำลังทำข้อสอบ'}</span><span class="exam-progress">ข้อ ${currentQuestionIndex+1} / ${activeAttempt.questions.length}</span><strong id="exam-clock" class="badge">${clock}</strong></div>
      <div class="exam-progress-track"><span style="width:${((currentQuestionIndex+1)/activeAttempt.questions.length)*100}%"></span></div>
      <section class="panel exam-panel"><div class="exam-question-meta"><span>${q.subject?esc(q.subject):'ข้อสอบ ก.พ.'}</span><span>ข้อที่ ${currentQuestionIndex+1}</span></div>
      ${q.passage?`<div class="exam-passage">${esc(q.passage)}</div>`:''}
      <h2 class="exam-question">${esc(q.questionText)}</h2>
      <div class="exam-choices">${q.choices.map((choice,i)=>`<label class="exam-choice ${selected===i?'selected':''}"><input type="radio" name="exam-answer" value="${i}" ${selected===i?'checked':''}><span class="choice-key">${String.fromCharCode(65+i)}</span><span>${esc(choice)}</span></label>`).join('')}</div>
      <div class="exam-actions"><button class="btn soft" id="prev-question" ${currentQuestionIndex===0?'disabled':''}>ข้อก่อนหน้า</button><span class="hint">ตอบแล้ว ${Object.keys(attemptAnswers).length} / ${activeAttempt.questions.length} ข้อ</span>${currentQuestionIndex<activeAttempt.questions.length-1?'<button class="btn" id="next-question">ข้อต่อไป</button>':'<button class="btn" id="review-submit">ตรวจทานและส่งข้อสอบ</button>'}</div></section>
      <div class="exam-number-grid">${activeAttempt.questions.map((item,i)=>`<button class="question-number ${i===currentQuestionIndex?'current':''} ${attemptAnswers[String(item.id)]!==undefined?'answered':''}" data-question-index="${i}" aria-label="ไปข้อที่ ${i+1}">${i+1}</button>`).join('')}</div>
      <p class="hint">สถานะคำตอบ: <strong id="autosave-status">${saveLabel}</strong> • ระบบบันทึกคำตอบไปยัง Server อัตโนมัติ</p>`;
  }
  function currentAnswers(){
    return activeAttempt.questions.filter(q=>attemptAnswers[String(q.id)]!==undefined)
      .map(q=>({questionId:q.id,selectedIndex:attemptAnswers[String(q.id)]}));
  }
  function queueAutosave(){
    if(!activeAttempt)return;
    clearTimeout(autosaveTimer);
    autosaveState='pending';
    renderAttempt();
    const sequence=++autosaveSequence;
    autosaveTimer=setTimeout(async()=>{
      if(!activeAttempt)return;
      if(autosaveInFlight){autosaveQueued=true;return;}
      autosaveInFlight=true;
      autosaveState='saving';renderAttempt();
      try{
        await window.KP_EXAM_ENGINE.saveAnswers(activeAttempt.id,currentAnswers());
        if(sequence===autosaveSequence){autosaveState='saved';renderAttempt();}
      }catch(error){
        if(sequence===autosaveSequence){
          if(String(error.message||'').includes('หมดเวลา')){submitAttempt(true);return;}
          autosaveState='error';renderAttempt();notify(error.message||'บันทึกคำตอบไม่สำเร็จ');
        }
      }finally{
        autosaveInFlight=false;
        if(autosaveQueued&&activeAttempt){autosaveQueued=false;queueAutosave();}
      }
    },450);
  }
  function startCountdown(){
    clearInterval(countdownTimer);
    if(!activeAttempt?.deadlineAt)return;
    countdownTimer=setInterval(()=>{
      if(!activeAttempt)return clearInterval(countdownTimer);
      const remaining=Math.max(0,Math.ceil((Date.parse(activeAttempt.deadlineAt)-Date.now())/1000));
      const clock=document.getElementById('exam-clock');
      if(clock)clock.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
      if(remaining<=0){clearInterval(countdownTimer);submitAttempt(true);}
    },1000);
  }
  async function loadResults(page=1){
    const panel=document.getElementById('history-panel');
    const summary=document.getElementById('results-summary');
    if(!panel||!summary)return;
    if(!window.KP_AUTH?.authenticated){panel.innerHTML='<div class="empty"><strong>กรุณาเข้าสู่ระบบ</strong>ประวัติการสอบจะแสดงเฉพาะบัญชีที่เข้าสู่ระบบ</div>';return;}
    panel.innerHTML='<div class="empty">กำลังโหลดประวัติการสอบ…</div>';
    const data=await window.KP_EXAM_ENGINE.getHistory({page,limit:20});
    const stats=data.summary||{};
    summary.innerHTML=[
      ['คะแนนเฉลี่ย',stats.average_percentage==null?'—':Number(stats.average_percentage).toFixed(1)+'%'],
      ['คะแนนสูงสุด',stats.best_percentage==null?'—':Number(stats.best_percentage).toFixed(1)+'%'],
      ['จำนวนครั้งที่สอบ',stats.total_attempts||0],
      ['สอบเสร็จแล้ว',stats.completed_count||0]
    ].map(([label,value])=>'<article class="stat"><div class="stat-top">'+label+'</div><div class="stat-value">'+esc(value)+'</div></article>').join('');
    const rows=(data.attempts||[]).map(item=>{
      const status=item.status==='submitted'?'ส่งแล้ว':item.status==='expired'?'หมดเวลา': 'กำลังทำ';
      const mode=item.mode==='simulation'?'Mock Exam':'ฝึกทั่วไป';
      const score=item.score==null?'—':item.score+' / '+item.question_count;
      const percent=item.percentage==null?'—':Number(item.percentage).toFixed(1)+'%';
      const action=item.status==='in_progress'?'<button class="btn soft small" data-resume-attempt="'+esc(item.id)+'">ทำต่อ</button>':'—';
      return '<tr><td>'+esc(item.exam_year_label||('ปีสอบ #'+item.exam_year_id))+'</td><td>'+esc(mode)+'</td><td>'+esc(score)+'</td><td>'+esc(percent)+'</td><td>'+esc(status)+'</td><td>'+esc(item.started_at||'')+'</td><td>'+action+'</td></tr>';
    }).join('');
    panel.innerHTML=rows?'<div class="table-wrap"><table><thead><tr><th>ปีสอบ</th><th>รูปแบบ</th><th>คะแนน</th><th>เปอร์เซ็นต์</th><th>สถานะ</th><th>เริ่มสอบ</th><th>การทำรายการ</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="form-actions"><button class="btn soft small" data-history-page="'+(page-1)+'" '+(page<=1?'disabled':'')+'>ก่อนหน้า</button><span class="hint">หน้า '+page+' / '+(data.pagination?.total_pages||1)+'</span><button class="btn soft small" data-history-page="'+(page+1)+'" '+(page>=(data.pagination?.total_pages||1)?'disabled':'')+'>ถัดไป</button></div>':'<div class="empty"><strong>ไม่พบประวัติการสอบ</strong>เริ่มฝึกข้อสอบเพื่อสร้างประวัติของคุณ</div>';
  }
  async function resumeSavedAttempt(attemptId){
    try{
      activeAttempt=await window.KP_EXAM_ENGINE.resumeAttempt(attemptId);
      attemptAnswers={};
      activeAttempt.questions.forEach(q=>{if(q.selectedIndex!==null)attemptAnswers[String(q.id)]=q.selectedIndex;});
      currentQuestionIndex=Math.max(0,activeAttempt.questions.findIndex(q=>q.selectedIndex===null));
      autosaveState="saved";
      renderAttempt();startCountdown();
    }catch(error){notify(error.message||"ไม่สามารถกลับมาทำข้อสอบต่อได้");show("results");}
  }

  async function beginAttempt(mode="practice",options={}){
    const simulation=mode==="simulation";
    const year=options.examYearId??document.getElementById(simulation?"mock-year":"exam-year")?.value;
    const count=Number(options.questionCount??document.getElementById(simulation?"mock-count":"question-count")?.value??(simulation?50:10));
    if(!year&&!options.examSetId){notify("ไม่พบปีข้อสอบของชุดที่เลือก");return;}
    const button=options.button||document.getElementById(simulation?"start-mock":"start-practice");
    const originalLabel=button?.textContent;
    if(button){button.disabled=true;button.textContent="กำลังเตรียมข้อสอบ…";}
    try{
      activeAttempt=await window.KP_EXAM_ENGINE.startAttempt({
        examYearId:year,examSetId:options.examSetId??null,subcategoryId:options.subcategoryId??null,
        questionCount:count,mode
      });
      attemptAnswers={};currentQuestionIndex=0;autosaveState="saved";renderAttempt();startCountdown();
    }catch(error){
      notify(error.message||"ไม่สามารถเริ่มข้อสอบได้");
      if(button){button.disabled=false;button.textContent=originalLabel||"ลองเริ่มอีกครั้ง";}
    }
  }
  async function submitAttempt(automatic=false){
    if(!activeAttempt||submitting)return;
    const unanswered=activeAttempt.questions.length-Object.keys(attemptAnswers).length;
    if(!automatic&&unanswered>0&&!window.confirm("ยังไม่ได้ตอบ "+unanswered+" ข้อ ต้องการส่งข้อสอบหรือไม่?"))return;
    submitting=true;
    clearTimeout(autosaveTimer);clearInterval(countdownTimer);autosaveQueued=false;autosaveSequence++;
    const button=document.getElementById("review-submit");
    if(button){button.disabled=true;button.textContent="กำลังส่งข้อสอบ…";}
    try{
      const result=await window.KP_EXAM_ENGINE.submitAttempt(activeAttempt.id,currentAnswers());
      const data=result.result||result;
      const score=Number(data.score??data.correct_count);
      const total=Number(data.total??activeAttempt.questions.length);
      const percentage=Number(data.percentage??(total?score/total*100:0));
      const expired=data.status==="expired";
      root.innerHTML=`<div class="page-intro"><div><h2>${expired?"หมดเวลาสอบ":"ผลการสอบ"}</h2><p>${expired?"ระบบปิดรับคำตอบและบันทึกคะแนนจากคำตอบที่บันทึกไว้":"ระบบตรวจคะแนนจาก Server แล้ว"}</p></div></div>
        <section class="panel result-summary"><div class="result-score">${Number.isFinite(score)?score:"—"} <small>/ ${Number.isFinite(total)?total:activeAttempt.questions.length}</small></div>
        <h3>คะแนนที่ได้</h3><div class="result-percent">${Number.isFinite(percentage)?percentage.toFixed(1):"—"}%</div>
        <p class="muted">Attempt ID: ${esc(activeAttempt.id)}</p><button class="btn" id="return-history">ดูประวัติการสอบ</button></section>`;
      activeAttempt=null;attemptAnswers={};notify(expired?"บันทึกผลเมื่อหมดเวลาแล้ว":"บันทึกผลการสอบแล้ว");
    }catch(error){
      notify(error.message||"ส่งข้อสอบไม่สำเร็จ กรุณาลองอีกครั้ง");
      if(button){button.disabled=false;button.textContent="ตรวจทานและส่งข้อสอบ";}
      if(activeAttempt?.deadlineAt&&Date.parse(activeAttempt.deadlineAt)<=Date.now())setTimeout(()=>submitAttempt(true),1000);
    }finally{submitting=false;}
  }
  root.addEventListener('change',e=>{
    if(e.target.matches('input[name="exam-answer"]')&&activeAttempt){
      const q=activeAttempt.questions[currentQuestionIndex];
      attemptAnswers[String(q.id)]=Number(e.target.value);
      queueAutosave();
    }
  });
  root.addEventListener('click',async e=>{
    const go=e.target.closest('[data-go]');
    if(go){show(go.dataset.go);return;}
    const setButton=e.target.closest('[data-start-set]');
    if(setButton){beginAttempt('simulation',{examSetId:Number(setButton.dataset.startSet),examYearId:Number(setButton.dataset.setYear),questionCount:Number(setButton.dataset.setCount),button:setButton});return;}
    const subjectButton=e.target.closest('[data-practice-subject]');
    if(subjectButton){beginAttempt('practice',{subcategoryId:subjectButton.dataset.practiceSubject,examYearId:Number(subjectButton.dataset.practiceYear),questionCount:10,button:subjectButton});return;}
    if(e.target.id==='start-practice'){beginAttempt('practice');return;}
    if(e.target.id==='start-mock'){beginAttempt('simulation');return;}
    const resumeButton=e.target.closest('[data-resume-attempt]');
    if(resumeButton){resumeSavedAttempt(resumeButton.dataset.resumeAttempt);return;}
    const historyPage=e.target.closest('[data-history-page]');
    if(historyPage&&!historyPage.disabled){loadResults(Number(historyPage.dataset.historyPage)).catch(err=>notify(err.message));return;}
    if(e.target.id==='prev-question'&&currentQuestionIndex>0){currentQuestionIndex--;renderAttempt();return;}
    if(e.target.id==='next-question'&&currentQuestionIndex<activeAttempt.questions.length-1){currentQuestionIndex++;renderAttempt();return;}
    if(e.target.id==='review-submit'){submitAttempt();return;}
    if(e.target.id==='exit-attempt'){
      if(window.confirm('ออกจากข้อสอบหรือไม่? ระบบจะบันทึกคำตอบล่าสุดก่อนออก และสามารถกลับมาทำต่อจากประวัติการสอบได้')){
        clearTimeout(autosaveTimer);autosaveQueued=false;autosaveSequence++;
        try{
          while(autosaveInFlight)await new Promise(resolve=>setTimeout(resolve,25));
          await window.KP_EXAM_ENGINE.saveAnswers(activeAttempt.id,currentAnswers());
          clearInterval(countdownTimer);activeAttempt=null;attemptAnswers={};show('results');
        }catch(error){
          if(String(error.message||'').includes('หมดเวลา')){await submitAttempt(true);}
          else notify('ยังออกจากข้อสอบไม่ได้ เพราะบันทึกคำตอบล่าสุดไม่สำเร็จ: '+(error.message||'ลองอีกครั้ง'));
        }
      }
      return;
    }
    if(e.target.id==='return-practice'){show('by-year');return;}
    if(e.target.id==='return-history'){show('results');return;}
    const jump=e.target.closest('[data-question-index]');
    if(jump&&activeAttempt){currentQuestionIndex=Number(jump.dataset.questionIndex);renderAttempt();}
  });
  document.getElementById('menu-toggle').addEventListener('click',()=>{sidebar.classList.toggle('open');scrim.classList.toggle('show');});
  scrim.addEventListener('click',closeMenu);
  document.getElementById('help-button').addEventListener('click',()=>notify('ศูนย์ช่วยเหลือ KP e-Exam อยู่ระหว่างจัดทำ'));
  document.getElementById('year-now').textContent=new Date().getFullYear();
  if(cfg.apiBaseUrl)document.getElementById('environment-label').textContent='เชื่อมต่อ API Exam Engine';
  show('dashboard');
})();