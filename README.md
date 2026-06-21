# Scopus Research Explorer

An Obsidian plugin for importing and exploring research articles from a Scopus CSV file.

> This plugin works with the desktop version of Obsidian only. It does not require coding, Git, Node.js, or Terminal commands.

---

# English Guide

## What you need

- A Windows, macOS, or Linux computer
- [Obsidian](https://obsidian.md/) version 1.5.0 or newer
- An Obsidian vault
- A CSV file exported from Scopus

## Installation

### 1. Download the plugin

1. Open this GitHub repository.
2. Click the green **Code** button.
3. Select **Download ZIP**.
4. Open the downloaded ZIP file and extract it.
5. Rename the extracted folder to:

   ```text
   scopus-research-explorer
   ```

### 2. Open your Obsidian plugins folder

1. Open Obsidian.
2. Open the vault in which you want to use the plugin.
3. Go to **Settings → Files and links**.
4. Find **Default location for new notes** or use your file manager to locate the vault folder.
5. Inside the vault, open:

   ```text
   .obsidian/plugins
   ```

If the `plugins` folder does not exist, create it inside the `.obsidian` folder.

> The `.obsidian` folder may be hidden. On Windows, enable **View → Show → Hidden items** in File Explorer. On macOS, press `Command + Shift + .` in Finder.

### 3. Copy the plugin

Copy the entire `scopus-research-explorer` folder into `.obsidian/plugins`.

The final folder should contain these files directly:

```text
.obsidian/plugins/scopus-research-explorer/
├── main.js
├── manifest.json
├── styles.css
├── database.worker.js
└── sqlite3.wasm
```

Make sure there is not another `scopus-research-explorer` folder nested inside it.

### 4. Enable the plugin

1. Restart Obsidian.
2. Go to **Settings → Community plugins**.
3. Turn off **Restricted mode** if Obsidian asks.
4. Find **Scopus Research Explorer** under installed plugins.
5. Turn the plugin on.

## Getting started

1. Click the network icon in the left ribbon, or open the Command Palette and select **Open Scopus Research Explorer**.
2. Create a research workspace.
3. Open the Command Palette and select **Import Scopus CSV**.
4. Choose your Scopus CSV file.
5. Validate the file, then confirm the import.
6. Select one or more papers using the checkboxes.
7. Choose an exploration mode and click **Explore**.

Available exploration modes may include:

- **Similar Work**
- **Earlier Work**
- **Later Work**
- **References**
- **Cited By in Corpus**

`References` and `Cited By in Corpus` appear only when the imported CSV contains references that can be matched to other papers in the same imported collection.

## Troubleshooting

### The plugin is not listed in Obsidian

- Check that the folder name is exactly `scopus-research-explorer`.
- Check that `manifest.json` and `main.js` are directly inside that folder.
- Restart Obsidian after copying the files.
- Confirm that you copied the plugin into the correct vault.

### Some exploration options are missing

This normally means the imported CSV does not contain enough matching reference data. Try exporting the **References** field from Scopus and importing all related papers into the same workspace.

### The database does not open

- Update Obsidian to the latest desktop version.
- Disable and enable the plugin again.
- Restart Obsidian.
- Do not remove `database.worker.js` or `sqlite3.wasm`.

## Updating the plugin

1. Close Obsidian.
2. Download the newest ZIP from this repository.
3. Replace the plugin files in `.obsidian/plugins/scopus-research-explorer`.
4. Open Obsidian again.

Your imported research database is stored separately inside the vault, but keeping a backup of the vault before updating is recommended.

---

# คู่มือภาษาไทย

## สิ่งที่ต้องเตรียม

- คอมพิวเตอร์ Windows, macOS หรือ Linux
- [Obsidian](https://obsidian.md/) เวอร์ชัน 1.5.0 ขึ้นไป
- Vault สำหรับเก็บโน้ตใน Obsidian
- ไฟล์ CSV ที่ส่งออกจาก Scopus

## วิธีติดตั้ง

### 1. ดาวน์โหลดปลั๊กอิน

1. เปิดหน้า GitHub ของโปรเจกต์นี้
2. กดปุ่มสีเขียว **Code**
3. เลือก **Download ZIP**
4. เปิดไฟล์ ZIP ที่ดาวน์โหลดมาและแตกไฟล์
5. เปลี่ยนชื่อโฟลเดอร์ที่ได้เป็น:

   ```text
   scopus-research-explorer
   ```

### 2. เปิดโฟลเดอร์ปลั๊กอินของ Obsidian

1. เปิดโปรแกรม Obsidian
2. เปิด Vault ที่ต้องการติดตั้งปลั๊กอิน
3. ไปที่ **Settings → Files and links**
4. ใช้ File Explorer หรือ Finder เปิดโฟลเดอร์ของ Vault
5. ภายใน Vault ให้เปิดโฟลเดอร์:

   ```text
   .obsidian/plugins
   ```

หากไม่มีโฟลเดอร์ `plugins` ให้สร้างโฟลเดอร์นี้ไว้ภายใน `.obsidian`

> โฟลเดอร์ `.obsidian` อาจถูกซ่อนไว้ บน Windows ให้เปิด **View → Show → Hidden items** ส่วน macOS ให้กด `Command + Shift + .` ใน Finder

### 3. คัดลอกปลั๊กอิน

คัดลอกโฟลเดอร์ `scopus-research-explorer` ทั้งโฟลเดอร์ไปไว้ใน `.obsidian/plugins`

ภายในโฟลเดอร์ปลายทางควรมีไฟล์ดังนี้:

```text
.obsidian/plugins/scopus-research-explorer/
├── main.js
├── manifest.json
├── styles.css
├── database.worker.js
└── sqlite3.wasm
```

ตรวจสอบว่าไม่มีโฟลเดอร์ `scopus-research-explorer` ซ้อนกันสองชั้น

### 4. เปิดใช้งานปลั๊กอิน

1. ปิดและเปิด Obsidian ใหม่
2. ไปที่ **Settings → Community plugins**
3. ปิด **Restricted mode** หาก Obsidian แสดงคำถาม
4. หา **Scopus Research Explorer** ในรายการปลั๊กอินที่ติดตั้งแล้ว
5. กดเปิดใช้งานปลั๊กอิน

## วิธีเริ่มใช้งาน

1. กดไอคอนรูปเครือข่ายที่แถบด้านซ้าย หรือเปิด Command Palette แล้วเลือก **Open Scopus Research Explorer**
2. สร้าง Research Workspace
3. เปิด Command Palette แล้วเลือก **Import Scopus CSV**
4. เลือกไฟล์ CSV ที่ส่งออกจาก Scopus
5. ตรวจสอบไฟล์ แล้วกดยืนยันการนำเข้า
6. เลือกบทความอย่างน้อยหนึ่งเรื่องโดยกดช่องสี่เหลี่ยมหน้าบทความ
7. เลือกรูปแบบการสำรวจ แล้วกด **Explore**

รูปแบบการสำรวจประกอบด้วย:

- **Similar Work** — งานที่คล้ายกัน
- **Earlier Work** — งานที่เก่ากว่า
- **Later Work** — งานที่ใหม่กว่า
- **References** — งานที่บทความอ้างอิงถึง
- **Cited By in Corpus** — งานในชุดข้อมูลที่อ้างอิงบทความนี้

ตัวเลือก `References` และ `Cited By in Corpus` จะแสดงเมื่อข้อมูลอ้างอิงในไฟล์ CSV สามารถเชื่อมโยงกับบทความอื่นที่นำเข้าไว้ในชุดข้อมูลเดียวกันได้

## การแก้ปัญหาเบื้องต้น

### ไม่พบปลั๊กอินใน Obsidian

- ตรวจสอบว่าชื่อโฟลเดอร์เป็น `scopus-research-explorer`
- ตรวจสอบว่า `manifest.json` และ `main.js` อยู่ภายในโฟลเดอร์นี้โดยตรง
- ปิดและเปิด Obsidian ใหม่หลังคัดลอกไฟล์
- ตรวจสอบว่าคัดลอกปลั๊กอินไปยัง Vault ที่กำลังใช้งานอยู่

### ตัวเลือกการสำรวจแสดงไม่ครบ

โดยทั่วไปเกิดจากไฟล์ CSV ไม่มีข้อมูลอ้างอิงที่สามารถจับคู่กันได้ ควรเลือกส่งออกฟิลด์ **References** จาก Scopus และนำเข้าบทความที่เกี่ยวข้องทั้งหมดไว้ใน Workspace เดียวกัน

### ไม่สามารถเปิดฐานข้อมูลได้

- อัปเดต Obsidian Desktop ให้เป็นเวอร์ชันล่าสุด
- ปิดแล้วเปิดใช้งานปลั๊กอินอีกครั้ง
- ปิดและเปิด Obsidian ใหม่
- ห้ามลบไฟล์ `database.worker.js` และ `sqlite3.wasm`

## วิธีอัปเดตปลั๊กอิน

1. ปิด Obsidian
2. ดาวน์โหลดไฟล์ ZIP เวอร์ชันล่าสุดจาก GitHub
3. นำไฟล์ใหม่ไปแทนที่ไฟล์เดิมใน `.obsidian/plugins/scopus-research-explorer`
4. เปิด Obsidian อีกครั้ง

ฐานข้อมูลงานวิจัยจะถูกเก็บแยกไว้ภายใน Vault แต่แนะนำให้สำรองข้อมูล Vault ก่อนอัปเดตทุกครั้ง
