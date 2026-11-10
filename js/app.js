(() => {
  const cfg=window.KP_CONFIG||{};
  const root=document.getElementById('view-container');
  const sidebar=document.getElementById('sidebar');
  const scrim=document.getElementById('scrim');
  const titles={dashboard:'ภาพรวม','by-year':'ฝึกข้อสอบแยกปี',mock:'Mock Exam',bank:'คลังข้อสอบ',results:'ผลการสอบ',member:'สมาชิก'};
  let years=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function notify(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),2600);}
  const intro=(title,desc)=>`<div class="page-intro"><div><h2>${title}</h2><p>${desc}</p></div></div>`;
  const panelHead=(title,desc)=>`<div class="panel-head"><div><h3>${title}</h3><p>${desc||''}</p></div></div>`;
  function dashboard(){return `
    <section class="welcome"><div class="welcome-inner"><div class="overline">YOUR NEXT STEP STARTS HERE</div><h2>เตรียมสอบ ก.พ. อย่างเป็นระบบ</h2><p>ฝึกฝนอย่างมีเป้าหมาย ติดตามพัฒนาการ และพร้อมสำหรับทุกสนามสอบ</p><div class="welcome-actions"><button class="btn light" data-go="by-year">เริ่มฝึกข้อสอบ</button><button class="btn ghost" data-go="mock">ดู Mock Exam</button></div></div></section>
    <div class="stats">
      <article class="stat"><div class="stat-top">คะแนนเฉลี่ย <span class="stat-icon">◉</span></div><div class="stat-value">—</div><div class="stat-foot">รอข้อมูลผลการสอบ</div></article>
      <article class="stat"><div class="stat-top">ชุดข้อสอบที่ทำแล้ว <span class="stat-icon">▤</span></div><div class="stat-value">0</div><div class="stat-foot">เริ่มฝึกเพื่อบันทึกสถิติ</div></article>
      <article class="stat"><div class="stat-top">เวลาฝึกทั้งหมด <span class="stat-icon">◷</span></div><div class="stat-value">0 ชม.</div><div class="stat-foot">เวลาฝึกสะสม</div></article>
      <article class="stat"><div class="stat-top">ความคืบหน้า <span class="stat-icon">↗</span></div><div class="stat-value">0%</div><div class="stat-foot">เป้าหมายการเตรียมสอบ</div></article>
    </div>
    <div class="section-head"><div><h3>เลือกวิธีฝึกของคุณ</h3><p>เริ่มจากรูปแบบที่เหมาะกับเป้าหมาย</p></div></div>
    <div class="quick-grid">
      <article class="feature"><div class="feature-icon">▣</div><h3>ฝึกข้อสอบแยกปี</h3><p>เลือกปีข้อสอบและจำนวนข้อที่ต้องการฝึก พร้อมทบทวนหลังทำ</p><button class="btn" data-go="by-year">เลือกปีข้อสอบ</button></article>
      <article class="feature"><div class="feature-icon">◷</div><h3>Mock Exam</h3><p>ฝึกบริหารเวลาในรูปแบบใกล้เคียงสนามสอบจริง</p><button class="btn soft" data-go="mock">ดูรายละเอียด</button></article>
      <article class="feature"><div class="feature-icon">▤</div><h3>คลังข้อสอบ</h3><p>เลือกทบทวนตามวิชาและหมวดหมู่ที่ต้องการพัฒนา</p><button class="btn soft" data-go="bank">เปิดคลังข้อสอบ</button></article>
    </div>
    <div class="dashboard-grid">
      <section><div class="section-head"><div><h3>กิจกรรมล่าสุด</h3><p>ประวัติการฝึกและผลสอบของคุณ</p></div><button class="text-link" data-go="results">ดูผลการสอบ</button></div><div class="panel"><div class="empty"><strong>ยังไม่มีกิจกรรม</strong>เมื่อเริ่มทำข้อสอบ ประวัติและคะแนนจะปรากฏที่นี่</div></div></section>
      <section><div class="section-head"><div><h3>เป้าหมายการเตรียมสอบ</h3><p>ติดตามแผนการฝึกของคุณ</p></div></div><div class="panel"><div class="score-placeholder"><div class="score-ring">0%</div><p class="muted" style="font-size:10px">ยังไม่ได้ตั้งเป้าหมาย</p><button class="btn soft small" data-go="member">ดูบัญชีสมาชิก</button></div></div></section>
    </div>`;}
  async function fetchYears(){const base=String(cfg.apiBaseUrl||'').replace(/\/$/,'');if(!base)return [];const response=await fetch(base+'/api/exam-years',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error('API '+response.status);const body=await response.json();const list=Array.isArray(body)?body:(body.data||body.examYears||body.years||[]);return list.filter(x=>x&&x.is_active!==0&&x.is_active!==false).map(x=>({id:x.id,label:x.label||String(x.year_be??x.year??''),year:x.year_be??x.year})).filter(x=>x.id!==undefined&&x.label);}
  function byYear(){return intro('ฝึกข้อสอบแยกปี','เลือกปีข้อสอบจากฐานข้อมูล แล้วกำหนดจำนวนข้อที่ต้องการฝึก')+`
    <section class="panel form-panel">${panelHead('ตั้งค่าการฝึก','กำหนดชุดข้อสอบก่อนเริ่ม')}<div class="form-grid">
      <div class="field"><label for="exam-year">ปีข้อสอบ</label><select id="exam-year"><option value="">${years.length?'เลือกปีข้อสอบ':'กำลังตรวจสอบรายการปีข้อสอบ…'}</option>${years.map(y=>`<option value="${esc(y.id)}">${esc(y.label)}</option>`).join('')}</select><span class="hint">รายการปีสอบจาก API /api/exam-years</span></div>
      <div class="field"><label for="question-count">จำนวนข้อ</label><select id="question-count"><option value="10">10 ข้อ</option><option value="25">25 ข้อ</option><option value="50">50 ข้อ</option></select><span class="hint">เลือกจำนวนข้อที่ต้องการฝึกในแต่ละรอบ</span></div>
    </div><div class="form-actions"><button class="btn" id="start-practice" ${years.length?'':'disabled'}>เริ่มทำข้อสอบแยกปี</button><span class="hint">ระบบจะตรวจสอบชุดข้อสอบก่อนเริ่ม</span></div><div id="year-alert" class="alert info">${years.length?'พบปีข้อสอบ '+years.length+' รายการ':'กำลังโหลดรายการปีข้อสอบจากฐานข้อมูลจริง'}</div></section>
    <div class="section-head"><div><h3>ขั้นตอนการฝึก</h3><p>จากการเลือกชุดข้อสอบจนถึงการทบทวนผล</p></div></div>
    <div class="steps"><div class="step"><div class="step-num">1</div><b>เลือกปีสอบ</b><small>เลือกปีจากฐานข้อมูล</small></div><div class="step"><div class="step-num">2</div><b>กำหนดจำนวนข้อ</b><small>เลือก 10, 25 หรือ 50 ข้อ</small></div><div class="step"><div class="step-num">3</div><b>ทำข้อสอบ</b><small>ตอบคำถามและตรวจทาน</small></div><div class="step"><div class="step-num">4</div><b>ดูผลสอบ</b><small>คะแนนและหัวข้อทบทวน</small></div></div>
    <div class="alert info">หมายเหตุ: หน้านี้เชื่อม API สำหรับโหลดปีสอบแล้ว ส่วนการสร้างชุดข้อสอบ บันทึกคำตอบ และตรวจคะแนนต้องเชื่อม Exam Engine ฝั่ง Server ก่อนเปิดใช้งาน</div>`;}
  function mock(){return intro('Mock Exam','ฝึกบริหารเวลาและประเมินความพร้อมก่อนวันสอบ')+`
    <div class="subject-grid">
      <article class="panel subject"><span class="badge">รูปแบบมาตรฐาน</span><h3>Mock Exam ภาค ก.</h3><p>ชุดสอบจำลองรวมทุกวิชาตามโครงสร้างที่กำหนด พร้อมเวลาสอบและสรุปคะแนน</p><div class="subject-meta"><span>Full simulation</span><span>เตรียมระบบ</span></div></article>
      <article class="panel subject"><span class="badge gray">โหมดฝึก</span><h3>ฝึกแบบไม่จับเวลา</h3><p>ทำข้อสอบตามจังหวะของตนเองและทบทวนคำอธิบายหลังตอบ</p><div class="subject-meta"><span>Practice mode</span><span>เตรียมระบบ</span></div></article>
      <article class="panel subject"><span class="badge gray">การประเมิน</span><h3>ทดสอบความพร้อม</h3><p>สรุปผลแยกตามวิชาเพื่อวางแผนการอ่านในรอบถัดไป</p><div class="subject-meta"><span>Readiness report</span><span>เตรียมระบบ</span></div></article>
    </div><div class="alert">หน้าจอและโครงสร้าง UX พร้อมแล้ว แต่ยังไม่สามารถเริ่มสอบได้จนกว่าจะเชื่อมชุดข้อสอบ ระบบจับเวลา และการตรวจคะแนนฝั่ง Server</div>`;}
  function bank(){const subjects=[['คิดวิเคราะห์','การคิดวิเคราะห์เชิงภาษา นามธรรม และเชิงปริมาณ','∑'],['ภาษาอังกฤษ','คำศัพท์ ไวยากรณ์ และการอ่านจับใจความ','A'],['ความรู้และลักษณะการเป็นข้าราชการที่ดี','กฎหมาย ระเบียบ และหลักการบริหารราชการ','§']];return intro('คลังข้อสอบ','เลือกวิชาและหมวดหมู่เพื่อวางแผนทบทวน')+`
    <div class="subject-grid">${subjects.map(s=>`<article class="panel subject"><div class="feature-icon">${s[2]}</div><span class="badge gray">หมวดวิชาหลัก</span><h3>${s[0]}</h3><p>${s[1]}</p><div class="subject-meta"><span>รายการข้อสอบ</span><span>รอเชื่อมฐานข้อมูล</span></div></article>`).join('')}</div>
    <div class="alert info">หมวดวิชาเป็นโครงสร้าง UX เบื้องต้น รายการวิชาและจำนวนข้อจริงจะดึงจากฐานข้อมูลเมื่อ API คลังข้อสอบพร้อมใช้งาน</div>`;}
  function results(){return intro('ผลการสอบ','ดูคะแนนย้อนหลัง วิเคราะห์ผลรายวิชา และวางแผนทบทวน')+`
    <div class="stats"><article class="stat"><div class="stat-top">คะแนนเฉลี่ย <span class="stat-icon">◉</span></div><div class="stat-value">—</div><div class="stat-foot">ยังไม่มีผลสอบ</div></article><article class="stat"><div class="stat-top">คะแนนสูงสุด <span class="stat-icon">↗</span></div><div class="stat-value">—</div><div class="stat-foot">รอการบันทึกผล</div></article><article class="stat"><div class="stat-top">จำนวนครั้งที่สอบ <span class="stat-icon">▤</span></div><div class="stat-value">0</div><div class="stat-foot">ทุกโหมดการสอบ</div></article><article class="stat"><div class="stat-top">หัวข้อที่ควรทบทวน <span class="stat-icon">◎</span></div><div class="stat-value">—</div><div class="stat-foot">รอข้อมูลวิเคราะห์</div></article></div>
    <div class="result-grid"><section class="panel">${panelHead('แนวโน้มคะแนน','กราฟคะแนนจากการสอบแต่ละครั้ง')}<div class="empty"><strong>ยังไม่มีข้อมูลกราฟ</strong>คะแนนจะแสดงหลังส่งข้อสอบสำเร็จ</div></section><section class="panel">${panelHead('วิเคราะห์ผลรายวิชา','จุดแข็งและหัวข้อที่ควรพัฒนา')}<div class="empty"><strong>ยังไม่มีข้อมูลวิเคราะห์</strong>ระบบจะสรุปผลเมื่อมีประวัติการสอบ</div></section></div>
    <div class="section-head"><div><h3>ประวัติการสอบ</h3><p>รายการสอบทั้งหมดของบัญชีนี้</p></div></div><div class="panel"><div class="empty"><strong>ไม่พบประวัติการสอบ</strong>เริ่มฝึกข้อสอบเพื่อสร้างประวัติของคุณ</div></div>`;}
  function member(){return intro('สมาชิกและแพ็กเกจ','จัดการบัญชี ตรวจสอบสิทธิ์ และดูแพ็กเกจการใช้งาน')+`
    <section class="panel"><div class="panel-head"><div><h3>ข้อมูลบัญชี</h3><p>สถานะการเข้าสู่ระบบปัจจุบัน</p></div><span class="badge amber">Guest</span></div><div class="alert">Google Login ยังคงปิดใช้งานเพื่อรอการตรวจสอบ Auth + Security ให้ครบถ้วน หน้านี้จะแสดงข้อมูลบัญชีจริงเมื่อเปิดระบบอย่างปลอดภัย</div></section>
    <div class="section-head"><div><h3>แพ็กเกจสมาชิก</h3><p>โครงสร้างสิทธิ์การใช้งานเบื้องต้น</p></div></div>
    <div class="plan-grid"><article class="plan"><span class="badge gray">เริ่มต้น</span><h3>Free</h3><div class="plan-price">ฟรี</div><p>เริ่มต้นฝึกและทำความคุ้นเคยกับระบบ</p><ul><li>ฝึกข้อสอบตามโควตาที่กำหนด</li><li>ดูผลการฝึกเบื้องต้น</li></ul><button class="btn outline" disabled>แพ็กเกจปัจจุบัน (ตัวอย่าง)</button></article>
    <article class="plan"><span class="badge">สำหรับผู้เตรียมสอบ</span><h3>Premium</h3><div class="plan-price">—</div><p>เพิ่มขีดความสามารถในการฝึกและวิเคราะห์ผล</p><ul><li>สิทธิ์ฝึกข้อสอบตามแพ็กเกจ</li><li>Mock Exam และรายงานเชิงลึก</li></ul><button class="btn soft" disabled>ยังไม่เปิดจำหน่าย</button></article>
    <article class="plan"><span class="badge gray">สำหรับองค์กร</span><h3>Enterprise</h3><div class="plan-price">ติดต่อ</div><p>เครื่องมือสำหรับการจัดการผู้เรียนเป็นกลุ่ม</p><ul><li>จัดการสมาชิกและสิทธิ์</li><li>รายงานภาพรวมองค์กร</li></ul><button class="btn outline" disabled>ยังไม่เปิดให้บริการ</button></article></div>`;}
  const views={dashboard,'by-year':byYear,mock,bank,results,member};
  function closeMenu(){sidebar.classList.remove('open');scrim.classList.remove('show');}
  function show(key){if(!views[key])key='dashboard';root.innerHTML=views[key]();document.getElementById('page-title').textContent=titles[key];document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===key));closeMenu();if(key==='by-year'&&!years.length){fetchYears().then(list=>{years=list;root.innerHTML=byYear();}).catch(err=>{const alert=document.getElementById('year-alert');if(alert)alert.textContent='ไม่สามารถโหลดปีข้อสอบจาก API ได้ในขณะนี้ ('+err.message+') กรุณาตรวจสอบ API แล้วลองใหม่';});}}
  document.getElementById('main-nav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)show(b.dataset.view);});
  let activeAttempt=null;
  let attemptAnswers={};
  let currentQuestionIndex=0;
  let submitting=false;
  function renderAttempt(){
    if(!activeAttempt)return;
    const q=activeAttempt.questions[currentQuestionIndex];
    const selected=attemptAnswers[String(q.id)];
    root.innerHTML=`<div class="exam-toolbar"><button class="btn soft small" id="exit-attempt">กลับหน้าฝึก</button><span class="badge">กำลังทำข้อสอบ</span><span class="exam-progress">ข้อ ${currentQuestionIndex+1} / ${activeAttempt.questions.length}</span></div>
      <div class="exam-progress-track"><span style="width:${((currentQuestionIndex+1)/activeAttempt.questions.length)*100}%"></span></div>
      <section class="panel exam-panel"><div class="exam-question-meta"><span>${q.subject?esc(q.subject):'ข้อสอบ ก.พ.'}</span><span>ข้อที่ ${currentQuestionIndex+1}</span></div>
      ${q.passage?`<div class="exam-passage">${esc(q.passage)}</div>`:''}
      <h2 class="exam-question">${esc(q.questionText)}</h2>
      <div class="exam-choices">${q.choices.map((choice,i)=>`<label class="exam-choice ${selected===i?'selected':''}"><input type="radio" name="exam-answer" value="${i}" ${selected===i?'checked':''}><span class="choice-key">${String.fromCharCode(65+i)}</span><span>${esc(choice)}</span></label>`).join('')}</div>
      <div class="exam-actions"><button class="btn soft" id="prev-question" ${currentQuestionIndex===0?'disabled':''}>ข้อก่อนหน้า</button><span class="hint">ตอบแล้ว ${Object.keys(attemptAnswers).length} / ${activeAttempt.questions.length} ข้อ</span>${currentQuestionIndex<activeAttempt.questions.length-1?'<button class="btn" id="next-question">ข้อต่อไป</button>':'<button class="btn" id="review-submit">ตรวจทานและส่งข้อสอบ</button>'}</div></section>
      <div class="exam-number-grid">${activeAttempt.questions.map((item,i)=>`<button class="question-number ${i===currentQuestionIndex?'current':''} ${attemptAnswers[String(item.id)]!==undefined?'answered':''}" data-question-index="${i}" aria-label="ไปข้อที่ ${i+1}">${i+1}</button>`).join('')}</div>
      <p class="hint">คำตอบจะเก็บไว้ชั่วคราวในหน้านี้ และจะส่งไปตรวจคะแนนเมื่อกดส่งข้อสอบ</p>`;
  }
  async function beginAttempt(){
    const year=document.getElementById('exam-year')?.value;
    const count=Number(document.getElementById('question-count')?.value||10);
    if(!year){notify('กรุณาเลือกปีข้อสอบ');return;}
    const button=document.getElementById('start-practice');
    if(button){button.disabled=true;button.textContent='กำลังเตรียมข้อสอบ…';}
    try{
      activeAttempt=await window.KP_EXAM_ENGINE.startAttempt({examYearId:year,questionCount:count,mode:'practice'});
      attemptAnswers={};currentQuestionIndex=0;renderAttempt();
    }catch(error){
      notify(error.message||'ไม่สามารถเริ่มข้อสอบได้');
      if(button){button.disabled=false;button.textContent='เริ่มทำข้อสอบแยกปี';}
    }
  }
  async function submitAttempt(){
    if(!activeAttempt||submitting)return;
    const unanswered=activeAttempt.questions.length-Object.keys(attemptAnswers).length;
    if(unanswered>0&&!window.confirm('ยังไม่ได้ตอบ '+unanswered+' ข้อ ต้องการส่งข้อสอบหรือไม่?'))return;
    submitting=true;
    const button=document.getElementById('review-submit');
    if(button){button.disabled=true;button.textContent='กำลังส่งข้อสอบ…';}
    try{
      const result=await window.KP_EXAM_ENGINE.submitAttempt(activeAttempt.id,
        activeAttempt.questions.filter(q=>attemptAnswers[String(q.id)]!==undefined)
          .map(q=>({questionId:q.id,selectedIndex:attemptAnswers[String(q.id)]})));
      const data=result.result||result;
      const score=Number(data.score??data.correct_count);
      const total=Number(data.total??activeAttempt.questions.length);
      const percentage=Number(data.percentage??(total?score/total*100:0));
      root.innerHTML=`<div class="page-intro"><div><h2>ผลการสอบ</h2><p>ส่งข้อสอบเรียบร้อย ระบบตรวจคะแนนจาก Server แล้ว</p></div></div>
        <section class="panel result-summary"><div class="result-score">${Number.isFinite(score)?score:'—'} <small>/ ${Number.isFinite(total)?total:activeAttempt.questions.length}</small></div>
        <h3>คะแนนที่ได้</h3><div class="result-percent">${Number.isFinite(percentage)?percentage.toFixed(1):'—'}%</div>
        <p class="muted">Attempt ID: ${esc(activeAttempt.id)}</p><button class="btn" id="return-practice">กลับไปเลือกชุดข้อสอบ</button></section>`;
      activeAttempt=null;attemptAnswers={};notify('บันทึกผลการสอบแล้ว');
    }catch(error){
      notify(error.message||'ส่งข้อสอบไม่สำเร็จ กรุณาลองอีกครั้ง');
      if(button){button.disabled=false;button.textContent='ตรวจทานและส่งข้อสอบ';}
    }finally{submitting=false;}
  }
  root.addEventListener('change',e=>{
    if(e.target.matches('input[name="exam-answer"]')&&activeAttempt){
      const q=activeAttempt.questions[currentQuestionIndex];
      attemptAnswers[String(q.id)]=Number(e.target.value);
      renderAttempt();
    }
  });
  root.addEventListener('click',e=>{
    const go=e.target.closest('[data-go]');
    if(go){show(go.dataset.go);return;}
    if(e.target.id==='start-practice'){beginAttempt();return;}
    if(e.target.id==='prev-question'&&currentQuestionIndex>0){currentQuestionIndex--;renderAttempt();return;}
    if(e.target.id==='next-question'&&currentQuestionIndex<activeAttempt.questions.length-1){currentQuestionIndex++;renderAttempt();return;}
    if(e.target.id==='review-submit'){submitAttempt();return;}
    if(e.target.id==='exit-attempt'){if(window.confirm('ออกจากข้อสอบหรือไม่? คำตอบที่ยังไม่ส่งจะไม่ถูกบันทึก')){activeAttempt=null;attemptAnswers={};show('by-year');}return;}
    if(e.target.id==='return-practice'){show('by-year');return;}
    const jump=e.target.closest('[data-question-index]');
    if(jump&&activeAttempt){currentQuestionIndex=Number(jump.dataset.questionIndex);renderAttempt();}
  });
  document.getElementById('menu-toggle').addEventListener('click',()=>{sidebar.classList.toggle('open');scrim.classList.toggle('show');});
  scrim.addEventListener('click',closeMenu);
  document.getElementById('help-button').addEventListener('click',()=>notify('ศูนย์ช่วยเหลือ KP e-Exam อยู่ระหว่างจัดทำ'));
  document.getElementById('year-now').textContent=new Date().getFullYear();
  if(cfg.apiBaseUrl)document.getElementById('environment-label').textContent='เชื่อมต่อ API สำหรับข้อมูลปีสอบ';
  show('dashboard');
})();