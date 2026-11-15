# KP e-Exam Platform

แพลตฟอร์มเตรียมสอบ ก.พ. พัฒนาด้วย Frontend แบบ responsive และ Cloudflare Workers + D1 สำหรับ API/ข้อมูล

## Frontend

- `index.html` — application shell, navigation และ page container
- `assets/styles.css` — responsive design system สำหรับ desktop / tablet / mobile
- `js/app.js` — Dashboard, ฝึกข้อสอบแยกปี, Mock Exam, คลังข้อสอบ, ผลการสอบ และสมาชิก
- `js/config.js` — public API endpoint และ feature flags
- `_headers` — security headers เบื้องต้น

## UX/UI ที่มีใน branch นี้

- Dashboard พร้อมสถิติและทางลัดเข้าสู่โมดูลฝึก
- ฝึกข้อสอบแยกปี: โหลดรายการปีสอบจาก `GET /api/exam-years` แทนการ hardcode ปีตัวอย่าง
- Mock Exam: หน้าเตรียมรูปแบบสอบจำลอง
- คลังข้อสอบ: โครงหน้าหมวดวิชา
- ผลการสอบ: โครงคะแนน ประวัติ และพื้นที่วิเคราะห์ผล
- สมาชิก: โครงแพ็กเกจ Free / Premium / Enterprise
- Responsive sidebar และ navigation สำหรับหน้าจอมือถือ

## สถานะการเชื่อมต่อ

- Frontend API base URL ใน branch นี้: `https://kp-exam-api-staging.kridtayod.workers.dev`
- API year list: `GET /api/exam-years`
- Google Authentication: เปิด Feature Flag ใน Staging (`authEnabled: true`) และ Frontend เริ่ม flow ผ่าน `/auth/google/start` ได้แล้ว อย่างไรก็ตาม การเปิด Flag ไม่ใช่หลักฐานว่า Auth ผ่านการทดสอบ End-to-End กับ Google และ Browser จริงครบถ้วน จึงยังไม่ถือว่าพร้อม Production
- การเปิดใช้ Production ต้องตรวจสอบ OAuth callback, Session, CSRF, Logout, User/Admin authorization และสถานะบัญชี inactive ให้ผ่านก่อน
- Exam Engine frontend รองรับการเริ่ม Attempt, เลือกคำตอบ, เปลี่ยนข้อ และส่งคำตอบผ่าน API adapter แล้ว แต่ API `POST /api/attempts` และ `POST /api/attempts/:attemptId/submit` ยังต้องพัฒนาและทดสอบฝั่ง Server ก่อนใช้งานจริง
- Server-side scoring, ประวัติผลสอบ, payment และ Admin CRUD ยังไม่ถือว่าเปิดใช้งานจริง
- หน้าสถิติและแพ็กเกจบางส่วนเป็น UI placeholder และจะต้องเชื่อมข้อมูลจาก API ในเฟสถัดไป

## Auth Staging configuration

- Worker Staging ใช้ `workers/api/wrangler.staging.jsonc` และ D1 database `kp_exam_platform_staging`
- Frontend Staging ใช้ API base URL ข้างต้น โดย CORS allowlist ต้องตรงกับ Frontend Staging origin
- CI สำหรับ Auth hardening branch ตรวจ Wrangler Staging configuration ด้วย `wrangler deploy --dry-run` เท่านั้น ขั้นตอนนี้เป็นการตรวจสอบการ build/configuration ไม่ได้ Deploy Worker
- ห้ามนำค่า OAuth client secret, session secret หรือ credentials ไปใส่ในไฟล์ `vars` หรือ Frontend; ให้จัดเก็บค่าลับผ่าน Cloudflare Worker Secrets

## Exam Engine integration

- API contract: `docs/exam-engine-api-contract.md`
- Frontend adapter: `js/exam-engine.js`
- คำตอบเก็บในหน่วยความจำของหน้าเว็บเท่านั้น ไม่ใช้ localStorage/sessionStorage
- ต้องให้ Server ตรวจสิทธิ์ สร้างชุดข้อสอบ บันทึกคำตอบ และตรวจคะแนน โดยไม่ส่งเฉลยก่อนส่งข้อสอบ
- การเชื่อมต่อ frontend ยังไม่ยืนยันว่า API endpoints พร้อมใช้งาน และไม่ใช่การเปิดระบบสอบจริง

## Security notes

- ห้ามใส่ Google Client Secret, private keys, service tokens หรือ credentials ใน frontend
- ห้ามเก็บ ID token ใน localStorage หรือ sessionStorage
- ทุก admin action และการตรวจ role ต้อง enforce ฝั่ง API; การซ่อนเมนูใน frontend เป็นเพียง UX
- ตรวจ CORS allowlist ให้ตรงกับ frontend origin จริงก่อน deploy
- ห้ามส่ง `correct_index` หรือเฉลยไปยัง browser ก่อนส่งคำตอบ ให้ตรวจคะแนนฝั่ง server
- ทดสอบบัญชี inactive, User/Admin authorization, rate limits และ error handling ก่อนเปิดใช้จริง

## Local preview

เปิด static server จาก root ของ repository เช่น:

```bash
python -m http.server 8000
```

จากนั้นเข้า `http://localhost:8000`.

## Deployment

การเปลี่ยนแปลงใน branch นี้ยังแยกจาก `main` เพื่อ review ก่อน merge และ deploy จริง
