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

- Frontend API base URL: `https://kp-exam-api.kridtayod.workers.dev`
- API year list: `GET /api/exam-years`
- Google Authentication: **ปิดใช้งานอยู่** (`authEnabled: false`) จนกว่า Auth + Security จะผ่านการตรวจสอบและทดสอบ User/Admin จริง
- Exam Engine, การบันทึกคำตอบ, server-side scoring, ประวัติผลสอบ, payment และ Admin CRUD ยังไม่ถือว่าเปิดใช้งานจริง
- หน้าสถิติและแพ็กเกจบางส่วนเป็น UI placeholder และจะต้องเชื่อมข้อมูลจาก API ในเฟสถัดไป

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

การเปลี่ยนแปลงใน branch `feat/full-ux-ui` ยังแยกจาก `main` เพื่อ review ก่อน merge และ deploy จริง
