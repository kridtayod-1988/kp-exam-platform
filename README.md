# KP e-Exam Platform

Frontend prototype แยก repository จาก Portfolio เดิมโดยสิ้นเชิง ออกแบบให้ deploy เป็น static site บน Cloudflare Pages

## โครงสร้าง

- `index.html` — application shell
- `assets/styles.css` — responsive UI
- `js/app.js` — navigation และหน้า prototype
- `js/config.js` — public client configuration placeholders
- `_headers` — security headers เบื้องต้น

## สถานะปัจจุบัน

นี่คือ **frontend prototype** ไม่ใช่ระบบ production-ready: ยังไม่มี backend, Firebase Authentication, database, exam engine, server-side scoring, payment หรือ admin authorization การเลือกปี/จำนวนข้อเป็น UI demo เท่านั้น

## Deploy ด้วย GitHub + Cloudflare Pages

1. สร้าง GitHub repository ชื่อ `kp-exam-platform` (แนะนำ Public หรือ Private ตามความต้องการ)
2. อัปโหลดไฟล์และโฟลเดอร์ทั้งหมดใน repository นี้ โดยให้ `index.html` อยู่ที่ root
3. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
4. เลือก GitHub account และ repository `kp-exam-platform`
5. Framework preset: `None`; Build command: เว้นว่าง; Build output directory: `/` หรือ `.` ตามหน้าจอ
6. กด Save and Deploy; ทุก commit บน branch production จะ trigger deployment ใหม่

## ขั้นตอนก่อนเปิดใช้จริง

- ตั้งค่า Firebase project และ Authorized domains; ใส่เฉพาะ Firebase Web config ใน `js/config.js` (ไม่ใช่ private key)
- พัฒนา backend/API ที่ตรวจ Firebase ID token และ role ทุก request
- ใช้ฐานข้อมูลจริงสำหรับ `exam_years` และ `questions.exam_year_id`; อย่า hardcode ปีสอบใน production
- อย่าส่ง `correct_index` หรือเฉลยไป browser ก่อนส่งคำตอบ ให้ตรวจคะแนนฝั่ง server
- จำกัด CORS ด้วย allowlist ของโดเมนจริง
- ห้าม commit service-account JSON, private keys, access tokens หรือ secrets ลง GitHub
- ทดสอบสิทธิ์ User/Admin, RLS/authorization, rate limits, concurrency และการสำรองข้อมูลก่อน production

## Local preview

เปิด `index.html` ผ่าน static server เช่น `python -m http.server 8000` แล้วเข้า `http://localhost:8000`.
