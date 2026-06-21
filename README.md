# Scopus Research Explorer

**Obsidian Plugin** สำหรับวิเคราะห์วรรณกรรมจาก Scopus CSV — ค้นหางานที่เกี่ยวข้อง จัดกลุ่มด้วย Collections และสร้าง Graph แสดงความสัมพันธ์ระหว่างบทความ

> ⚠️ **Desktop only** — ใช้ได้บน Windows 10/11 และ macOS 12+ เท่านั้น (ไม่รองรับมือถือ)

---

## ติดตั้งใน 3 ขั้นตอน

### 1 — ดาวน์โหลดไฟล์

กด **Code → Download ZIP** แล้วแตกไฟล์ออกมา

หรือดาวน์โหลดแยกทีละไฟล์จากหน้านี้ (ต้องครบทั้ง 5 ไฟล์):

| ไฟล์ | ขนาด |
|------|------|
| `main.js` | ~511 KB |
| `database.worker.js` | ~295 KB |
| `manifest.json` | < 1 KB |
| `styles.css` | ~9 KB |
| `sqlite3.wasm` | ~844 KB |

---

### 2 — วางไฟล์ใน Vault

คัดลอกไฟล์ทั้ง 5 ไปวางในโฟลเดอร์นี้ภายใน Obsidian Vault:

```
<ชื่อ Vault>/
└── .obsidian/
    └── plugins/
        └── scopus-research-explorer/   ← สร้างโฟลเดอร์นี้แล้ววางไฟล์ทั้ง 5 ไว้ที่นี่
```

> **Windows**: ถ้าไม่เห็นโฟลเดอร์ `.obsidian` → เปิด File Explorer → View → เปิด **Hidden items**  
> **macOS**: กด **Command + Shift + .** เพื่อแสดงไฟล์ซ่อน

---

### 3 — เปิดใช้งาน Plugin

1. เปิด Obsidian → **Settings (⚙️)** → **Community plugins**
2. กด **Turn on community plugins** (ถ้ายังไม่ได้เปิด)
3. กด 🔄 **Reload** ในส่วน Installed plugins
4. หา **Scopus Research Explorer** แล้วเปิด Toggle

---

## วิธีใช้งาน

### นำเข้าข้อมูลจาก Scopus

1. ไปที่ [scopus.com](https://www.scopus.com) → ค้นหาหัวข้อที่ต้องการ
2. เลือกบทความ → **Export** → เลือก **CSV** → กด Export
3. ใน Obsidian กดไอคอน 🕸️ ใน ribbon ซ้ายเพื่อเปิด plugin
4. กด **New** → ตั้งชื่อ Workspace → กด **Import Scopus CSV**
5. เลือกไฟล์ CSV → **Run Preflight** → **Import**

### ค้นหาบทความที่เกี่ยวข้อง

1. เลือก checkbox หน้าบทความที่ต้องการใช้เป็น Seed (1–10 บทความ)
2. เลือกโหมดการค้นหา: **Similar Work / Earlier Work / Later Work / References**
3. กด **Explore**
4. ดูผลลัพธ์ในรายการและ Graph

### จัดกลุ่มด้วย Collections

กด **Set up Literature Review collections** เพื่อสร้าง 5 collections พร้อมใช้:

| Collection | สี | วัตถุประสงค์ |
|-----------|-----|-------------|
| Must Read | 🔴 | บทความที่ต้องอ่านก่อนทำงาน |
| Foundational | 🟠 | งานรากฐานของสาขา |
| Methodology | 🟢 | บทความที่ใช้วิธีวิจัยที่คล้ายกัน |
| State of the Art | 🔵 | งานล่าสุดในสาขา |
| Out of Scope | ⚫ | บทความที่ไม่เกี่ยวข้อง |

กดจุดสีข้างแต่ละบทความในรายการเพื่อเพิ่มเข้า Collection ได้ทันที

---

## ความต้องการของระบบ

- **Obsidian** เวอร์ชัน 1.5.0 ขึ้นไป ([ดาวน์โหลด](https://obsidian.md))
- Windows 10/11 หรือ macOS 12+
- ไม่ต้องติดตั้ง Node.js หรือ package เพิ่มเติมใดๆ

---

## แก้ปัญหาเบื้องต้น

| อาการ | วิธีแก้ |
|-------|---------|
| ไม่เห็น Plugin ในรายการ | ตรวจสอบชื่อโฟลเดอร์ต้องเป็น `scopus-research-explorer` และมีครบ 5 ไฟล์ |
| Plugin เปิดไม่ติด | ตรวจสอบ Obsidian เวอร์ชัน (ต้อง ≥ 1.5.0) |
| Import CSV แล้ว error | ใช้ไฟล์ CSV ที่ export จาก Scopus โดยตรง ไม่ใช่ Google Scholar |
| ข้อมูลไม่แสดงใน Graph | กด **Explore** ก่อน (Graph จะแสดงหลังกด Explore) |

---

## ข้อมูลเพิ่มเติม

- ข้อมูลทั้งหมดเก็บอยู่ใน Vault ของคุณเอง — ไม่มีการส่งข้อมูลออกอินเตอร์เน็ต
- Plugin ใช้ SQLite สำหรับจัดเก็บข้อมูล ประมวลผลทุกอย่างในเครื่อง
- Version: **0.1.0**
