# 🔬 Scopus Research Explorer

An Obsidian desktop plugin for building and exploring a local research corpus from Scopus CSV exports and live Semantic Scholar searches.

> 🌐 **Languages:** [English](#-english) · [ภาษาไทย](#-ภาษาไทย)

---

# 🇬🇧 English

## ✨ Overview

Scopus Research Explorer helps researchers collect, organize, search, and explore academic publications without leaving Obsidian.

The plugin supports:

- 📄 Scopus CSV imports
- 🌐 Live Semantic Scholar searches
- 🗂️ Research workspaces and collections
- 🔎 Local corpus search and filtering
- 🕸️ Citation and similarity graphs
- 📚 Reading-state tracking
- 📝 Managed Obsidian publication notes
- 💾 Portable SQLite backups

Research data is stored locally inside the selected Obsidian vault.

## ✅ Requirements

- Windows, macOS, or Linux
- Obsidian Desktop 1.5.0 or newer
- An Obsidian vault
- A Scopus CSV export and/or internet access for Semantic Scholar

> ⚠️ Mobile Obsidian is not supported. The plugin requires desktop APIs, WebAssembly, workers, OPFS, and local filesystem access.

## 🚀 Installation

The plugin is currently installed manually rather than through the Obsidian community plugin directory.

### 1. Download and build

Download or clone this repository. If release files are not already included, run:

```powershell
npm install
npm run build
```

### 2. Create the plugin folder

Create this directory inside your vault:

```text
<vault>/.obsidian/plugins/scopus-research-explorer/
```

### 3. Copy the release files

Copy these five files into the plugin folder:

```text
scopus-research-explorer/
|-- main.js
|-- manifest.json
|-- styles.css
|-- database.worker.js
`-- sqlite3.wasm
```

### 4. Enable the plugin

1. Restart Obsidian.
2. Open **Settings > Community plugins**.
3. Disable Restricted mode if required.
4. Enable **Scopus Research Explorer**.

> 💡 The folder must be named `scopus-research-explorer`. Ensure `manifest.json` and `main.js` are directly inside it, not inside another nested folder.

## 🏁 Quick start

1. Select the network icon in the left ribbon, or run **Open research explorer** from the Command Palette.
2. Create a research workspace.
3. In the left sidebar, find **Add papers**.
4. Select **Import** beside **Scopus CSV**, or **Search** beside **Semantic Scholar**.
5. Search and filter the local corpus.
6. Check up to 10 papers to use as exploration seeds.
7. Select an exploration mode and choose **Explore**.
8. Open a paper to update its reading state, add it to a collection, or create an Obsidian note.

> ℹ️ Scopus and Semantic Scholar are data sources, not separate application modes. Papers from either source are imported into the selected workspace and can be searched and explored together.

## 📄 Importing Scopus CSV files

Under **Add papers** in the workspace sidebar, select **Import** beside **Scopus CSV**. The same action is available as **Import Scopus CSV** in the Command Palette.

1. Choose one or more CSV files.
2. Keep automatic encoding detection enabled unless you know the file encoding.
3. Optionally enter the original Scopus query and export date.
4. Select **1. Validate**.
5. Review duplicates, conflicts, invalid rows, warnings, and available discovery features.
6. Select **2. Import**.

The importer supports:

- UTF-8
- UTF-16 LE
- Windows-1252
- Identifier-aware updates
- Duplicate and conflict reporting
- Transactional imports
- Raw source archiving

Imported source files are archived under:

```text
<vault>/.research-explorer/imports/
```

> 💡 For better citation graphs, include identifiers, abstracts, keywords, author IDs, and the **References** field in the Scopus export.

## 🌐 Using Semantic Scholar

### 🔑 Configure an API key

The API key is optional.

1. Open **Settings > Scopus Research Explorer**.
2. Paste the key into **Semantic Scholar > API key**.
3. Select **Test connection**.

The current client limits itself to:

- Without an API key: 1 request per second
- With an API key: up to 10 requests per second

> 🔒 The key is stored in the plugin's vault-local Obsidian data file. Do not use a sensitive key in a shared or cloud-synchronized vault.

### 🔍 Search and import papers

1. Open a workspace and find **Add papers** in the left sidebar.
2. Select **Search** beside **Semantic Scholar**. The same action is available as **Search Semantic Scholar** in the Command Palette.
3. Enter a search query.
4. Choose a maximum of 1-100 results.
5. Optionally enable **Fetch references**.
6. Select **Search** to preview the results.
7. Select **Import into workspace**.

Fetching references can make one additional API request for every returned paper. Reference failures are non-fatal, so the primary search results can still be imported.

> ⏳ Large reference imports may take time because requests are rate-limited.

## 🔎 Searching and filtering

The local corpus can be searched using publication titles, keywords, and abstracts.

Available filters include:

- Publication year range
- Has abstract
- No abstract
- Collection membership

The maximum number of loaded results can be changed in the plugin settings.

## 🕸️ Exploring the corpus

Available exploration modes depend on the data in the selected workspace:

- **Similar Work** — ranks papers using local text similarity
- **Earlier Work** — finds related papers published before the selected seeds
- **Later Work** — finds related papers published after the selected seeds
- **References** — follows references from the selected seeds
- **Cited By in Corpus** — finds imported papers that cite the selected seeds

Graph layouts:

- **Scatter** — positions papers using publication year and citation count
- **Force graph** — displays a network-oriented relationship layout

> ℹ️ Citation modes appear only when references can be matched to other papers in the same workspace.

## 🗂️ Collections

Collections can have a name, color, and comma-separated tags.

You can:

- Filter the paper list by collection
- Save currently selected seeds to a collection
- Ctrl-click or Command-click a collection to load up to 10 papers as seeds
- Add or remove papers from the publication detail panel
- Create five starter collections with **Set up Literature Review collections**

The starter collections are:

- Must Read
- Foundational
- Methodology
- State of the Art
- Out of Scope

## 📝 Publication notes

Select **Create/open note** from a publication's detail panel to create a managed Obsidian note.

The default notes folder is:

```text
Research/Publications
```

Change it under **Settings > Scopus Research Explorer > Publication notes folder**.

## 💾 Data storage and backups

The live database uses SQLite WebAssembly with OPFS. Portable data is stored inside the vault:

```text
<vault>/.research-explorer/
|-- schema.json
|-- database/
|   |-- portable-backup.sqlite3
|   `-- backup-manifest.json
`-- imports/
```

The plugin refreshes the portable backup after imports, workspace deletion, database migration, and plugin shutdown.

If backup creation fails, the database operation may still have succeeded. Obsidian displays a backup warning so the problem can be corrected.

> 🛡️ Back up the entire vault before upgrading, moving, or manually modifying plugin data.

## ⌨️ Commands

- **Open research explorer**
- **Create research workspace**
- **Import Scopus CSV**
- **Search Semantic Scholar**
- **Run database runtime diagnostics**

## 🔄 Updating

1. Run `npm run build` or download a newly built release.
2. Close Obsidian.
3. Replace the five release files in:

   ```text
   <vault>/.obsidian/plugins/scopus-research-explorer/
   ```

4. Reopen Obsidian.
5. Enable the plugin again if necessary.

> ⚠️ Do not delete `<vault>/.research-explorer/` unless you intentionally want to remove the research database and archived imports.

## 🧰 Troubleshooting

### The plugin is not listed

- Confirm the folder is named `scopus-research-explorer`.
- Confirm `manifest.json` and `main.js` are directly inside the folder.
- Remove any extra nested repository folder.
- Confirm the plugin was copied into the currently open vault.
- Restart Obsidian.

### The research database is unavailable

- Update Obsidian Desktop.
- Confirm `database.worker.js` and `sqlite3.wasm` are beside `main.js`.
- Disable and re-enable the plugin.
- Restart Obsidian.
- Run **Run database runtime diagnostics**.

### Semantic Scholar reports `Failed to resolve module specifier 'obsidian'`

The installed `main.js` is outdated. Replace it with the current rebuilt file, then restart Obsidian or disable and re-enable the plugin.

### Semantic Scholar returns 401 or 403

The API key may be invalid or unauthorized. Enter it again and select **Test connection**.

### Semantic Scholar returns 429

The service is rate-limiting the request. Wait before retrying, reduce reference fetching, or configure a valid API key.

### Citation exploration options are missing

The workspace does not contain enough matched citation data. Import the Scopus **References** field and related papers into the same workspace, or enable Semantic Scholar reference importing.

### A portable backup warning appears

Check vault permissions and available disk space. Restart or reload the plugin to retry the backup.

## 🧑‍💻 Development

Install dependencies:

```powershell
npm install
```

Start the watch build:

```powershell
npm run dev
```

Run TypeScript checks:

```powershell
npm run typecheck
```

Run tests:

```powershell
npm test
```

Run the complete local verification suite:

```powershell
npm run verify
```

`npm run verify` checks TypeScript, runs all Vitest tests, and creates production bundles.

Additional scripts are available for Obsidian smoke, contract, restore, performance, real-export, and quality validation. These scripts require an Obsidian instance configured for Chrome DevTools Protocol access.

---

# 🇹🇭 ภาษาไทย

## ✨ ภาพรวม

Scopus Research Explorer เป็นปลั๊กอินสำหรับ Obsidian Desktop ที่ช่วยรวบรวม จัดระเบียบ ค้นหา และสำรวจบทความวิชาการภายใน Obsidian

ปลั๊กอินรองรับ:

- 📄 การนำเข้าไฟล์ CSV จาก Scopus
- 🌐 การค้นหาและนำเข้าข้อมูลจาก Semantic Scholar
- 🗂️ Workspace และ Collection สำหรับแยกหัวข้องานวิจัย
- 🔎 การค้นหาและกรองบทความภายในฐานข้อมูล
- 🕸️ กราฟความคล้ายคลึงและความสัมพันธ์การอ้างอิง
- 📚 การติดตามสถานะการอ่าน
- 📝 การสร้างโน้ตบทความใน Obsidian
- 💾 การสำรองฐานข้อมูล SQLite แบบพกพา

ข้อมูลการวิจัยจะถูกจัดเก็บไว้ภายใน Obsidian vault ที่เลือก

## ✅ ความต้องการของระบบ

- Windows, macOS หรือ Linux
- Obsidian Desktop เวอร์ชัน 1.5.0 ขึ้นไป
- Obsidian vault
- ไฟล์ CSV จาก Scopus และ/หรืออินเทอร์เน็ตสำหรับใช้งาน Semantic Scholar

> ⚠️ ไม่รองรับ Obsidian Mobile เนื่องจากปลั๊กอินต้องใช้ Desktop API, WebAssembly, Worker, OPFS และการเข้าถึงระบบไฟล์

## 🚀 การติดตั้ง

ขณะนี้ต้องติดตั้งปลั๊กอินด้วยตนเอง เนื่องจากยังไม่ได้เผยแพร่ผ่าน Community plugins ของ Obsidian

### 1. ดาวน์โหลดและ Build

ดาวน์โหลดหรือ Clone repository นี้ หากยังไม่มีไฟล์สำหรับติดตั้ง ให้รัน:

```powershell
npm install
npm run build
```

### 2. สร้างโฟลเดอร์ปลั๊กอิน

สร้างโฟลเดอร์นี้ภายใน vault:

```text
<vault>/.obsidian/plugins/scopus-research-explorer/
```

### 3. คัดลอกไฟล์สำหรับติดตั้ง

คัดลอกไฟล์ทั้งห้านี้ไปยังโฟลเดอร์ปลั๊กอิน:

```text
scopus-research-explorer/
|-- main.js
|-- manifest.json
|-- styles.css
|-- database.worker.js
`-- sqlite3.wasm
```

### 4. เปิดใช้งานปลั๊กอิน

1. ปิดและเปิด Obsidian ใหม่
2. ไปที่ **Settings > Community plugins**
3. ปิด Restricted mode หากจำเป็น
4. เปิดใช้งาน **Scopus Research Explorer**

> 💡 ชื่อโฟลเดอร์ต้องเป็น `scopus-research-explorer` และไฟล์ `manifest.json` กับ `main.js` ต้องอยู่ภายในโฟลเดอร์นี้โดยตรง

## 🏁 เริ่มต้นใช้งาน

1. กดไอคอนรูปเครือข่ายที่แถบด้านซ้าย หรือเรียกคำสั่ง **Open research explorer**
2. สร้าง Research Workspace
3. มองหาส่วน **Add papers** ที่แถบด้านซ้าย
4. กด **Import** ข้าง **Scopus CSV** หรือกด **Search** ข้าง **Semantic Scholar**
5. ค้นหาและกรองบทความในฐานข้อมูล
6. เลือกบทความได้สูงสุด 10 รายการเพื่อใช้เป็น Seed
7. เลือกรูปแบบการสำรวจแล้วกด **Explore**
8. เปิดรายละเอียดบทความเพื่อเปลี่ยนสถานะการอ่าน เพิ่มลง Collection หรือสร้างโน้ต

> ℹ️ Scopus และ Semantic Scholar เป็นแหล่งข้อมูล ไม่ใช่โหมดการทำงานแยกกัน บทความจากทั้งสองแหล่งจะถูกนำเข้าไปยัง Workspace ที่เลือก และสามารถค้นหาหรือสำรวจร่วมกันได้

## 📄 การนำเข้าไฟล์ Scopus CSV

ในแถบด้านซ้ายของ Workspace ให้ไปที่ **Add papers** แล้วกด **Import** ข้าง **Scopus CSV** หรือเรียกคำสั่ง **Import Scopus CSV** จาก Command Palette

1. เลือกไฟล์ CSV อย่างน้อยหนึ่งไฟล์
2. ใช้การตรวจจับ Encoding อัตโนมัติ เว้นแต่ทราบ Encoding ของไฟล์
3. ระบุคำค้นเดิมจาก Scopus และวันที่ส่งออกได้ตามต้องการ
4. กด **1. Validate**
5. ตรวจสอบรายการซ้ำ ข้อมูลขัดแย้ง แถวที่ไม่ถูกต้อง คำเตือน และฟีเจอร์ที่ใช้งานได้
6. กด **2. Import**

ระบบนำเข้ารองรับ:

- UTF-8
- UTF-16 LE
- Windows-1252
- การอัปเดตข้อมูลโดยอ้างอิง Identifier
- รายงานข้อมูลซ้ำและข้อมูลขัดแย้ง
- การนำเข้าแบบ Transaction
- การเก็บสำเนาไฟล์ต้นฉบับ

ไฟล์ต้นฉบับที่นำเข้าจะถูกเก็บไว้ที่:

```text
<vault>/.research-explorer/imports/
```

> 💡 เพื่อให้กราฟการอ้างอิงทำงานได้ดี ควรส่งออก Identifier, Abstract, Keyword, Author ID และฟิลด์ **References** จาก Scopus

## 🌐 การใช้งาน Semantic Scholar

### 🔑 ตั้งค่า API Key

API Key เป็นตัวเลือกเสริม

1. ไปที่ **Settings > Scopus Research Explorer**
2. วาง Key ใน **Semantic Scholar > API key**
3. กด **Test connection**

ระบบจำกัดอัตราการเรียก API ดังนี้:

- ไม่มี API Key: 1 Request ต่อวินาที
- มี API Key: สูงสุด 10 Requests ต่อวินาที

> 🔒 Key จะถูกเก็บไว้ในไฟล์ข้อมูลของปลั๊กอินภายใน vault ไม่ควรใช้ Key สำคัญใน vault ที่แชร์กับผู้อื่นหรือ Sync ผ่าน Cloud

### 🔍 ค้นหาและนำเข้าบทความ

1. เปิด Workspace แล้วมองหาส่วน **Add papers** ที่แถบด้านซ้าย
2. กด **Search** ข้าง **Semantic Scholar** หรือเรียกคำสั่ง **Search Semantic Scholar** จาก Command Palette
3. กรอกคำค้น
4. เลือกจำนวนผลลัพธ์สูงสุด 1-100 รายการ
5. เปิด **Fetch references** หากต้องการนำเข้ารายการอ้างอิง
6. กด **Search** เพื่อดูตัวอย่างผลลัพธ์
7. กด **Import into workspace**

การเปิด Fetch references อาจส่ง API Request เพิ่มอีกหนึ่งครั้งต่อบทความ หากการดึง References บางรายการล้มเหลว ระบบยังสามารถนำเข้าผลการค้นหาหลักได้

> ⏳ การนำเข้า References จำนวนมากอาจใช้เวลานาน เนื่องจากระบบจำกัดอัตราการเรียก API

## 🔎 การค้นหาและกรองข้อมูล

สามารถค้นหาฐานข้อมูลภายในเครื่องด้วยชื่อบทความ Keyword และ Abstract

ตัวกรองที่รองรับ:

- ช่วงปีที่เผยแพร่
- มี Abstract
- ไม่มี Abstract
- Collection

สามารถกำหนดจำนวนผลลัพธ์สูงสุดที่โหลดได้ในหน้าตั้งค่าปลั๊กอิน

## 🕸️ การสำรวจบทความ

รูปแบบการสำรวจที่ใช้งานได้จะขึ้นอยู่กับข้อมูลใน Workspace:

- **Similar Work** — จัดอันดับบทความด้วยความคล้ายคลึงของข้อความ
- **Earlier Work** — ค้นหางานที่เกี่ยวข้องและเผยแพร่ก่อน Seed
- **Later Work** — ค้นหางานที่เกี่ยวข้องและเผยแพร่หลัง Seed
- **References** — แสดงบทความที่ Seed อ้างอิงถึง
- **Cited By in Corpus** — แสดงบทความที่นำเข้าแล้วและอ้างอิงถึง Seed

รูปแบบกราฟ:

- **Scatter** — จัดตำแหน่งตามปีเผยแพร่และจำนวนการอ้างอิง
- **Force graph** — แสดงความสัมพันธ์ในรูปแบบเครือข่าย

> ℹ️ ตัวเลือกด้านการอ้างอิงจะแสดงเมื่อระบบสามารถจับคู่ References กับบทความอื่นใน Workspace เดียวกันได้

## 🗂️ Collection

Collection สามารถกำหนดชื่อ สี และ Tag ที่คั่นด้วยเครื่องหมายจุลภาค

สามารถ:

- กรองรายการบทความตาม Collection
- บันทึก Seed ที่เลือกลง Collection
- กด Ctrl-click หรือ Command-click ที่ Collection เพื่อโหลดบทความสูงสุด 10 รายการเป็น Seed
- เพิ่มหรือลบบทความจากหน้าแสดงรายละเอียด
- สร้าง Collection เริ่มต้นห้ารายการด้วย **Set up Literature Review collections**

Collection เริ่มต้นประกอบด้วย:

- Must Read
- Foundational
- Methodology
- State of the Art
- Out of Scope

## 📝 โน้ตบทความ

กด **Create/open note** จากหน้าแสดงรายละเอียดบทความเพื่อสร้างโน้ตที่ปลั๊กอินจัดการให้

โฟลเดอร์เริ่มต้นคือ:

```text
Research/Publications
```

เปลี่ยนตำแหน่งได้ที่ **Settings > Scopus Research Explorer > Publication notes folder**

## 💾 การจัดเก็บและสำรองข้อมูล

ฐานข้อมูลหลักใช้ SQLite WebAssembly และ OPFS ส่วนไฟล์สำรองแบบพกพาจะอยู่ภายใน vault:

```text
<vault>/.research-explorer/
|-- schema.json
|-- database/
|   |-- portable-backup.sqlite3
|   `-- backup-manifest.json
`-- imports/
```

ระบบจะอัปเดตไฟล์สำรองหลังการนำเข้า การลบ Workspace การ Migration ฐานข้อมูล และการปิดปลั๊กอิน

หากการสำรองข้อมูลล้มเหลว การเปลี่ยนแปลงฐานข้อมูลอาจสำเร็จแล้ว แต่ Obsidian จะแสดงคำเตือนเพื่อให้แก้ไขปัญหา

> 🛡️ ควรสำรองข้อมูลทั้ง vault ก่อนอัปเดต ย้าย หรือแก้ไขข้อมูลของปลั๊กอินด้วยตนเอง

## ⌨️ คำสั่ง

- **Open research explorer**
- **Create research workspace**
- **Import Scopus CSV**
- **Search Semantic Scholar**
- **Run database runtime diagnostics**

## 🔄 การอัปเดต

1. รัน `npm run build` หรือดาวน์โหลด Release ที่ Build แล้ว
2. ปิด Obsidian
3. แทนที่ไฟล์สำหรับติดตั้งทั้งห้าไฟล์ใน:

   ```text
   <vault>/.obsidian/plugins/scopus-research-explorer/
   ```

4. เปิด Obsidian ใหม่
5. เปิดใช้งานปลั๊กอินอีกครั้งหากจำเป็น

> ⚠️ อย่าลบ `<vault>/.research-explorer/` เว้นแต่ต้องการลบฐานข้อมูลและไฟล์นำเข้าที่จัดเก็บไว้ทั้งหมด

## 🧰 การแก้ไขปัญหา

### ไม่พบปลั๊กอิน

- ตรวจสอบว่าชื่อโฟลเดอร์คือ `scopus-research-explorer`
- ตรวจสอบว่า `manifest.json` และ `main.js` อยู่ในโฟลเดอร์โดยตรง
- ลบโฟลเดอร์ repository ที่ซ้อนเกินมา
- ตรวจสอบว่าคัดลอกปลั๊กอินไปยัง vault ที่กำลังเปิดอยู่
- ปิดและเปิด Obsidian ใหม่

### ไม่สามารถเปิดฐานข้อมูลได้

- อัปเดต Obsidian Desktop
- ตรวจสอบว่า `database.worker.js` และ `sqlite3.wasm` อยู่ข้าง `main.js`
- ปิดและเปิดใช้งานปลั๊กอินใหม่
- ปิดและเปิด Obsidian ใหม่
- เรียกคำสั่ง **Run database runtime diagnostics**

### Semantic Scholar แสดง `Failed to resolve module specifier 'obsidian'`

ไฟล์ `main.js` ที่ติดตั้งเป็น Build รุ่นเก่า ให้แทนที่ด้วยไฟล์ที่ Build ล่าสุด แล้วปิดและเปิด Obsidian หรือ Reload ปลั๊กอิน

### Semantic Scholar แสดงข้อผิดพลาด 401 หรือ 403

API Key อาจไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน ให้กรอก Key ใหม่แล้วกด **Test connection**

### Semantic Scholar แสดงข้อผิดพลาด 429

บริการกำลังจำกัดอัตราการเรียก API ให้รอก่อนลองใหม่ ลดการดึง References หรือกำหนด API Key ที่ใช้งานได้

### ไม่มีตัวเลือกสำรวจการอ้างอิง

Workspace มีข้อมูลการอ้างอิงที่จับคู่กันไม่เพียงพอ ให้นำเข้าฟิลด์ **References** และบทความที่เกี่ยวข้องจาก Scopus ใน Workspace เดียวกัน หรือเปิดการนำเข้า References จาก Semantic Scholar

### แสดงคำเตือน Portable Backup

ตรวจสอบสิทธิ์การเขียนไฟล์และพื้นที่ว่างในดิสก์ จากนั้น Restart หรือ Reload ปลั๊กอินเพื่อให้ระบบลองสำรองข้อมูลอีกครั้ง

## 🧑‍💻 การพัฒนา

ติดตั้ง Dependencies:

```powershell
npm install
```

เริ่ม Watch Build:

```powershell
npm run dev
```

ตรวจสอบ TypeScript:

```powershell
npm run typecheck
```

รัน Test:

```powershell
npm test
```

รันชุดตรวจสอบทั้งหมด:

```powershell
npm run verify
```

`npm run verify` จะตรวจสอบ TypeScript รัน Vitest ทั้งหมด และสร้าง Production Bundle

มี Script เพิ่มเติมสำหรับทดสอบ Obsidian Runtime, Smoke Test, Contract, Restore, Performance, Real Export และ Quality Validation โดยต้องเปิด Obsidian พร้อม Chrome DevTools Protocol

---

## 📜 License

This repository does not currently include a license file.

Repository นี้ยังไม่มีไฟล์ License
