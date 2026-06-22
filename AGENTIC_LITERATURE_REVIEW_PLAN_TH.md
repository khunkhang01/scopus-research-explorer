# แผนพัฒนา Scopus Research Explorer ให้ทำงานร่วมกับ AI Agent สำหรับการทบทวนวรรณกรรม

> วันที่ค้นคว้าและจัดทำ: 21 มิถุนายน 2026  
> ขอบเขต: Codex, Google Antigravity, Claude Cowork/Claude Code และ agent อื่นที่รองรับ MCP

## สรุปข้อเสนอ

แนวทางที่เหมาะสมที่สุดไม่ใช่การฝัง Codex, Antigravity หรือ Claude Cowork ลงใน Obsidian plugin โดยตรง แต่ควรพัฒนา **Scopus Research Explorer ให้เป็น research engine แบบ local-first ที่ agent หลายค่ายเรียกใช้ผ่าน Model Context Protocol (MCP)** แล้วจัดทำ research skill หรือ workflow ที่กำหนดวิธีใช้เครื่องมือเหล่านั้นอย่างเป็นระบบ

สถาปัตยกรรมที่เสนอมี 4 ชั้น:

1. **Research data layer** — ฐานข้อมูลบทความ กราฟการอ้างอิง collections สถานะการอ่าน และ provenance ซึ่งมีอยู่แล้วใน plugin
2. **Research tool layer** — API ภายในที่ให้คำตอบแบบมีโครงสร้างและตรวจสอบย้อนกลับได้
3. **MCP bridge** — เปิด tools, resources และ prompts ให้ Codex, Claude และ agent host อื่นเรียกใช้
4. **Pedagogy and integrity layer** — workflow สำหรับนักศึกษา rubric, checkpoints, evidence ledger และข้อกำหนดให้มนุษย์ตรวจสอบก่อนสร้างข้อสรุป

ผลลัพธ์คือ plugin จะไม่ผูกกับผู้ให้บริการรายเดียว และไม่ต้องเปลี่ยนแกนหลักทุกครั้งที่ผลิตภัณฑ์ agent เปลี่ยนชื่อ รุ่น หรือรูปแบบการทำงาน

---

## 1. สิ่งที่ plugin มีอยู่แล้ว

จากการสำรวจ `main.js`, `database.worker.js`, `manifest.json` และ `README.md` ปัจจุบัน plugin มีรากฐานสำคัญดังนี้:

- เป็น Obsidian desktop plugin แบบ local-first
- นำเข้า Scopus CSV พร้อม preflight validation
- ใช้ SQLite WASM, Web Worker และ OPFS
- เก็บ raw source archive และ portable backup
- มี workspace และ corpus แยกตามโครงการวิจัย
- ค้นด้วย FTS/BM25
- จัดอันดับจากข้อความ คำสำคัญ ผู้แต่ง ปี และ shared references
- สำรวจ similar, earlier, later, references และ cited-by-in-corpus
- มี citation graph และ similarity graph
- มี collections และ reading state
- สร้าง publication note ใน Obsidian พร้อม frontmatter
- แสดงเหตุผลประกอบ recommendation และ confidence

ดังนั้นไม่ควรเริ่มจาก “เพิ่ม chatbot” แต่ควรยกระดับความสามารถเหล่านี้ให้เป็น **เครื่องมือวิจัยที่ agent เรียกได้อย่างปลอดภัยและอ้างหลักฐานได้**

### ช่องว่างสำคัญก่อนเปิดให้ agent ใช้งาน

- ยังไม่มี API boundary ภายนอกที่เป็นมาตรฐาน
- ไฟล์ที่เผยแพร่เป็น bundled/minified JavaScript และไม่มี source tree หรือ build configuration ใน repository ชุดนี้
- ยังไม่มี schema สำหรับ research question, screening decision, extraction form, claim หรือ evidence
- ยังไม่มี run log ที่บันทึกว่า agent ใช้ข้อมูลใด สร้างผลลัพธ์ใด และมนุษย์อนุมัติเมื่อใด
- ยังไม่มี distinction ระหว่าง metadata, abstract, full text และข้อความที่ AI สร้าง
- ยังไม่มีระบบ citation-grounded synthesis ที่บังคับให้ทุกข้ออ้างเชื่อมกลับไปยังบทความต้นทาง
- ยังไม่มีสิทธิ์ระดับ read-only/write หรือ approval gate สำหรับงานของ agent

---

## 2. สิ่งที่ควรเรียนรู้จาก agent แต่ละประเภท

### 2.1 Codex

เอกสาร Codex แยกบทบาทขององค์ประกอบได้ชัดเจน:

- `AGENTS.md` ใช้เก็บกติกาประจำโครงการ
- skills ใช้บรรจุ workflow และความรู้เฉพาะด้านที่ทำซ้ำได้
- MCP ใช้เชื่อม agent กับเครื่องมือหรือระบบภายนอก
- subagents ใช้แยกบทบาทเฉพาะทาง
- plugin package สามารถรวม skills, MCP servers, apps และ hooks ได้

สิ่งที่นำมาใช้กับโครงการนี้:

- ทำ `literature-review` skill เพื่อสอนขั้นตอนทำงาน ไม่ใช่ใส่ตรรกะทั้งหมดไว้ใน prompt เดียว
- ให้ Codex เรียกฐานข้อมูลผ่าน MCP tools
- ใช้ subagents แยกงานค้นหา คัดกรอง สกัดข้อมูล และตรวจสอบข้ออ้าง
- ใส่กติกาความซื่อสัตย์ทางวิชาการและคำสั่งทดสอบไว้ใน `AGENTS.md`
- ในอนาคตสามารถแจกเป็น Codex plugin package สำหรับผู้สอนและนักศึกษา

### 2.2 Google Antigravity

Antigravity ถูกนำเสนอเป็น agent-first development environment โดยเน้น:

- การมอบหมายงานหลายขั้นตอนแก่ agent
- การควบคุม agent หลายตัว
- การสร้าง artifact เช่น แผน งานที่ทำ และหลักฐานสำหรับตรวจสอบ
- การใช้ editor, terminal และ browser เป็นพื้นที่ทำงานของ agent

แนวคิดที่ควรนำมาใช้ แม้ไม่ผูก implementation กับ Antigravity โดยตรง คือ **artifact-first workflow** นักศึกษาไม่ควรได้รับเพียงคำตอบสุดท้าย แต่ควรได้ชุดหลักฐาน เช่น:

- search protocol
- screening log
- inclusion/exclusion table
- extraction matrix
- claim-evidence matrix
- synthesis draft
- limitations and uncertainty report
- agent activity record

เอกสารสาธารณะที่ตรวจสอบได้เกี่ยวกับ integration contract ของ Antigravity ยังมีรายละเอียดน้อยกว่า Codex และ Claude ดังนั้น MVP ไม่ควรพึ่ง API เฉพาะของ Antigravity หาก Antigravity รุ่นที่สถาบันใช้อยู่รองรับ MCP หรือการรัน local command จึงค่อยเพิ่ม adapter บาง ๆ โดยไม่เปลี่ยน research core

### 2.3 Claude Cowork และ Claude Code

Claude Code รองรับ MCP อย่างเป็นทางการ ทั้ง local stdio และ remote HTTP และสามารถติดตั้ง MCP server ไปพร้อม plugin ได้ ส่วน Cowork เน้นการมอบหมายงานกับไฟล์และงานความรู้ผ่านประสบการณ์ที่เข้าถึงง่ายกว่าสำหรับผู้ไม่เขียนโค้ด

สิ่งที่เหมาะกับนักศึกษา:

- ให้ Cowork ทำงานกับโฟลเดอร์ research project ที่จำกัดขอบเขต
- ให้ MCP เป็นช่องทางอ่าน corpus แทนการให้ agent อ่าน SQLite หรือไฟล์ภายในโดยตรง
- ใช้ skill/plugin สำหรับ workflow เช่น “สร้าง evidence table แต่ยังห้ามเขียนบทสรุป”
- จำกัด write access ให้เขียนเฉพาะ draft และ artifact folder
- งานลบ ย้าย หรือแก้ publication note ต้องขออนุมัติ

---

## 3. สถาปัตยกรรมเป้าหมาย

```text
Scopus CSV / metadata / abstracts / permitted full text
                         |
                         v
              Obsidian Plugin + SQLite
        corpus, graph, collections, notes, provenance
                         |
              Internal Research Service
        typed queries, validation, evidence, audit log
                         |
                  Local MCP Bridge
       tools + resources + prompts + access policy
              /             |              \
             v              v               v
          Codex       Claude Code/Cowork   Antigravity
             \              |               /
              \             |              /
               Research skills and workflows
                         |
                         v
        Review protocol, screening, extraction,
       synthesis, verification, learning artifacts
```

### หลักการออกแบบ

1. **Agent-agnostic** — research logic ต้องไม่ขึ้นกับชื่อ model หรือผลิตภัณฑ์
2. **Local-first** — metadata, notes และผลการคัดกรองอยู่ใน vault/ฐานข้อมูลก่อน
3. **Evidence before prose** — สร้างหลักฐานและตารางก่อนสร้างบทสังเคราะห์
4. **No citation without source ID** — ข้ออ้างทุกข้อที่เป็นสาระสำคัญต้องอ้าง publication ID/DOI
5. **Human approval at irreversible stages** — การเขียนทับ ลบ ส่งออก หรือยืนยัน inclusion ต้องมี approval
6. **Reproducible runs** — บันทึก query, corpus version, tool inputs, model/provider และ output hash
7. **Progressive autonomy** — นักศึกษาปีต้นใช้โหมดแนะนำ นักศึกษาขั้นสูงจึงเปิด multi-agent orchestration

---

## 4. MCP server ที่ควรสร้าง

แนะนำให้สร้าง sidecar process แยกจาก Obsidian renderer เช่น Node.js/TypeScript โดยเริ่มจาก local `stdio` transport แล้วเพิ่ม local/remote HTTP ภายหลัง

### เหตุผลที่ไม่ควรให้ MCP อ่าน SQLite โดยตรง

- schema ภายในอาจเปลี่ยน
- agent อาจสร้าง SQL ที่แพงหรือไม่ปลอดภัย
- ข้าม validation และ workspace boundary
- ทำให้ audit และ permission control ยาก
- ผูก integration กับรายละเอียด OPFS/WASM

MCP bridge ควรเรียก **Research Service API ที่กำหนดชนิดข้อมูลไว้แล้ว** หรือสื่อสารกับ plugin ผ่าน localhost/IPC ที่มี token ชั่วคราว

### Read-only tools สำหรับ MVP

| Tool | หน้าที่ |
|---|---|
| `list_workspaces` | แสดงโครงการวิจัยที่มีอยู่ |
| `get_workspace_capabilities` | ตรวจว่ามี abstract, keyword และ citation graph เพียงพอหรือไม่ |
| `search_publications` | ค้น corpus ด้วยคำ ปี ผู้แต่ง keyword และตัวกรอง |
| `get_publication` | อ่าน metadata/abstract ของบทความหนึ่งรายการ |
| `get_publications_batch` | อ่านข้อมูลหลายบทความโดยจำกัดจำนวน |
| `explore_related_work` | similar/earlier/later/references/cited-by |
| `explain_recommendation` | คืนช่องทางคะแนน เหตุผล และ coverage |
| `get_citation_neighborhood` | อ่านกราฟรอบ seed papers |
| `list_collections` | อ่านชุดบทความที่ผู้ใช้จัดไว้ |
| `get_collection` | อ่านสมาชิกและ labels |
| `get_corpus_statistics` | จำนวนบทความ ปี coverage และ missing fields |
| `get_source_provenance` | คืนข้อมูลแหล่งนำเข้า query วัน export และ corpus version |

### Write tools ระยะถัดไป

| Tool | เงื่อนไข |
|---|---|
| `create_collection` | อนุญาตอัตโนมัติได้ แต่ต้อง log |
| `add_to_collection` | แสดงเหตุผลและรายการก่อน commit |
| `set_screening_decision` | ต้องมี reviewer identity และ reason code |
| `save_extraction_record` | validate ตาม extraction schema |
| `create_research_artifact` | เขียนได้เฉพาะโฟลเดอร์ที่กำหนด |
| `link_claim_to_evidence` | ต้องระบุ source span หรือ field ที่รองรับข้ออ้าง |
| `materialize_publication_note` | ขออนุมัติก่อนสร้าง/แก้ไฟล์ |
| `export_review_package` | ขออนุมัติและสร้าง manifest/checksum |

### MCP resources

ควรเปิดข้อมูลที่อ้างถึงบ่อยเป็น resource URI เช่น:

```text
scopus://workspace/{workspaceId}
scopus://publication/{publicationId}
scopus://collection/{collectionId}
scopus://review/{reviewId}/protocol
scopus://review/{reviewId}/evidence-ledger
scopus://review/{reviewId}/screening-log
```

### MCP prompts

สร้าง prompt templates ที่กลายเป็น workflow command ได้ เช่น:

- `define_review_protocol`
- `build_search_concepts`
- `screen_titles_and_abstracts`
- `extract_study_characteristics`
- `map_theoretical_constructs`
- `find_contradictory_evidence`
- `audit_claims_and_citations`
- `draft_literature_synthesis`
- `generate_student_reflection`

Prompt ทุกตัวควรระบุ input/output schema, stopping condition และสิ่งที่ agent ห้ามทำ

---

## 5. Research data model ที่ควรเพิ่ม

### Review protocol

```text
review
- review_id
- workspace_id
- title
- research_question
- framework              # PICO, SPIDER, PCC หรือ custom
- population
- intervention_or_topic
- comparison
- outcomes
- inclusion_criteria_json
- exclusion_criteria_json
- date_range
- languages_json
- protocol_version
- created_by
- approved_at
```

### Screening

```text
screening_decision
- review_id
- publication_id
- stage                  # title, abstract, full_text
- decision               # include, exclude, maybe
- reason_code
- rationale
- reviewer_type          # student, instructor, agent
- reviewer_id
- confidence
- created_at
```

เก็บ decision ของมนุษย์และ agent แยกกัน ห้ามให้ agent เขียนทับคำตัดสินของนักศึกษา

### Extraction

```text
extraction_record
- review_id
- publication_id
- schema_version
- field_name
- value_json
- evidence_locator
- evidence_quote
- source_level           # metadata, abstract, full_text
- extracted_by
- verified_by
- created_at
```

`evidence_quote` ควรมีข้อจำกัดด้านลิขสิทธิ์และความยาว และต้องเก็บเฉพาะข้อความที่ผู้ใช้มีสิทธิ์ใช้งาน

### Claim and evidence ledger

```text
claim
- claim_id
- review_id
- claim_text
- claim_type             # descriptive, causal, methodological, theoretical
- status                 # draft, supported, contested, rejected

claim_evidence
- claim_id
- publication_id
- extraction_record_id
- relation               # supports, contradicts, qualifies
- strength
- reviewer_note
```

### Agent run provenance

```text
agent_run
- run_id
- review_id
- provider
- host                   # codex, claude, antigravity, other
- model
- skill_version
- prompt_hash
- corpus_version
- input_publication_ids_json
- tool_trace_summary_json
- output_artifact_path
- output_hash
- started_at
- completed_at
- approved_by
```

ไม่จำเป็นต้องเก็บ chain-of-thought ของ model ให้เก็บเพียง tool calls, inputs, outputs, decision summary และ artifacts ที่ตรวจสอบได้

---

## 6. Workflow สำหรับนักศึกษา

### Workflow A: Scoping review แบบมีผู้ช่วย

1. นักศึกษาเขียนคำถามวิจัยด้วยตนเอง
2. Agent ช่วยแยก concepts, synonyms และขอบเขต
3. นักศึกษายืนยัน review protocol
4. นำเข้า Scopus CSV พร้อมเก็บ search provenance
5. Agent ตรวจ corpus coverage และข้อมูลที่ขาด
6. Agent เสนอชุดบทความสำหรับ calibration 10–20 เรื่อง
7. นักศึกษาและ agent คัดกรองแยกกัน
8. ระบบแสดง disagreement เพื่อให้นักศึกษาอธิบายการตัดสินใจ
9. Agent สร้าง extraction matrix จากรายการที่ได้รับอนุมัติ
10. นักศึกษาตรวจ evidence locator
11. Agent สร้าง thematic map และ contradictory evidence report
12. นักศึกษาเขียนหรือแก้ synthesis โดยใช้ claim-evidence matrix
13. Citation auditor ตรวจทุกข้ออ้างก่อนส่ง

### Workflow B: Literature review เพื่อการเรียนรู้

ใช้ agent เป็น “Socratic research coach”:

- ถามเหตุผลที่เลือกหรือไม่เลือกบทความ
- ขอให้นักศึกษาเปรียบเทียบวิธีวิจัยของสองงาน
- ชี้ว่าข้อสรุปใดอาศัยเพียง abstract
- ขอให้นักศึกษาระบุ confounder หรือ limitation
- แสดงงานที่ขัดแย้งกับความเชื่อเริ่มต้น
- ไม่สร้าง final essay จนกว่านักศึกษาจะผ่าน evidence checkpoints

### Workflow C: Multi-agent review

แยก agent roles:

- **Protocol Agent** — ตรวจความชัดเจนของคำถามและเกณฑ์
- **Discovery Agent** — ค้นและขยาย citation neighborhood
- **Screening Agent** — เสนอ include/exclude พร้อม reason code
- **Extraction Agent** — สกัดข้อมูลตาม schema
- **Synthesis Agent** — สร้าง themes จาก evidence ที่อนุมัติแล้ว
- **Skeptic Agent** — หาหลักฐานขัดแย้ง ความลำเอียง และข้อสรุปเกินข้อมูล
- **Citation Auditor** — ตรวจ DOI, source ID และ claim support

agent แต่ละตัวควรมี tool permissions ต่างกัน ตัวอย่างเช่น Screening Agent อ่านได้แต่ไม่มีสิทธิ์สร้างบทสรุป และ Synthesis Agent อ่านเฉพาะ extraction ที่ผ่านการตรวจแล้ว

---

## 7. คุณสมบัติที่ควรเพิ่มใน UI ของ Obsidian

### Research Review panel

- Review question และ protocol status
- corpus readiness/coverage
- screening progress
- disagreement queue
- extraction completion
- unverified claims
- latest agent runs

### Paper detail

เพิ่มแท็บ:

- Metadata
- Abstract
- Screening
- Extraction
- Evidence
- Agent suggestions
- Audit history

ต้องแสดง badge ชัดเจนว่าเนื้อหามาจาก:

- Scopus metadata
- abstract
- full text
- student note
- instructor note
- AI-generated draft

### Agent task dialog

ก่อนรันงานให้แสดง:

- agent จะอ่านอะไร
- agent จะเขียนที่ใด
- จำนวนบทความสูงสุด
- ข้อมูลจะออกนอกเครื่องหรือไม่
- ค่าใช้จ่ายโดยประมาณ หากทราบ
- สิ่งที่ต้องให้ผู้ใช้อนุมัติ

### Evidence matrix

ตารางหลักควรมี:

| Claim/theme | Supporting papers | Contradicting papers | Source level | Verified |
|---|---|---|---|---|

นักศึกษาควรกดกลับไปยัง publication note หรือ abstract ที่รองรับข้ออ้างได้ทันที

---

## 8. Academic integrity และความปลอดภัย

### กติกาที่ควรบังคับในระบบ

- ห้ามสร้าง reference ที่ไม่มีอยู่ใน corpus หรือแหล่งค้นที่ตรวจสอบได้
- DOI/EID/title ต้อง resolve กลับไปยัง publication record
- ข้อสรุปจาก abstract ต้องติดป้ายว่า `abstract-only`
- agent ต้องแยก “ข้อมูลจากงานวิจัย” ออกจาก “การตีความของ agent”
- ห้าม auto-submit งานหรือเขียนทับ final assignment
- เก็บประวัติ revision และผู้อนุมัติ
- นักศึกษาต้องเปิดเผยระดับการใช้ AI ตามนโยบายรายวิชา
- instructor สามารถกำหนด allowed tools และ autonomy level ต่อรายวิชา
- destructive file operation ต้องปิดเป็นค่าเริ่มต้น
- API key ห้ามเก็บใน Markdown, SQLite export หรือ repository

### ระดับ autonomy ที่เสนอ

| ระดับ | ความสามารถ |
|---|---|
| 0: Explain | agent อธิบายวิธีทำ แต่ไม่อ่าน corpus |
| 1: Read | อ่าน ค้น และแนะนำโดยไม่เขียนข้อมูล |
| 2: Draft | สร้าง artifact/draft ในโฟลเดอร์เฉพาะ |
| 3: Curate | แก้ collections, screening และ extraction หลัง approval |
| 4: Orchestrate | ใช้หลาย agent และทำงานเป็น batch ภายใต้นโยบายผู้สอน |

ค่าเริ่มต้นสำหรับนักศึกษาควรเป็นระดับ 1 หรือ 2

---

## 9. แผนดำเนินงาน

### ระยะ 0 — ทำ repository ให้พัฒนาต่อได้

เป้าหมาย: แยก source code ออกจาก bundled release

- กู้หรือสร้าง TypeScript source tree
- เพิ่ม `package.json`, build, lint และ test scripts
- แยก modules: database, import, search, graph, notes, UI
- สร้าง typed contracts สำหรับ Research API
- เพิ่ม schema migrations และ fixture corpus
- ตรวจ encoding ของ README ภาษาไทย

เงื่อนไขผ่าน: สามารถ build `main.js` และ `database.worker.js` แบบ reproducible ได้

### ระยะ 1 — Research Review Core

เป้าหมาย: รองรับ review protocol, screening, extraction และ evidence โดยยังไม่มี LLM

- เพิ่มตารางและ migrations
- สร้าง UI review dashboard
- เพิ่ม manual screening/extraction
- เพิ่ม evidence ledger
- เพิ่ม export เป็น Markdown/CSV/JSON
- เพิ่ม audit log และ corpus-version binding

เงื่อนไขผ่าน: นักศึกษาทำ structured review ได้ครบโดยไม่ต้องใช้ agent

### ระยะ 2 — Read-only MCP MVP

เป้าหมาย: Codex และ Claude เรียกค้น corpus เดียวกันได้

- สร้าง local MCP sidecar
- เปิด read-only tools/resources
- เพิ่ม session token และ workspace scoping
- จำกัด pagination/output size
- เพิ่ม tool-call audit
- ทำ setup guide สำหรับ Codex และ Claude
- ทดลอง Antigravity ผ่าน MCP/local command หากรุ่นที่ใช้งานรองรับ

เงื่อนไขผ่าน: agent สองค่ายตอบคำถามจาก corpus เดียวกัน พร้อม publication IDs และไม่มีสิทธิ์แก้ข้อมูล

### ระยะ 3 — Literature Review Skill Pack

เป้าหมาย: สร้าง workflow ที่ทำซ้ำและประเมินผลได้

- skill: protocol design
- skill: screening calibration
- skill: extraction
- skill: contradiction search
- skill: claim-citation audit
- skill: synthesis with limitations
- rubric และ student reflection template
- prompts ภาษาไทย/อังกฤษ

เงื่อนไขผ่าน: workflow สร้าง artifacts ตาม schema และไม่ข้าม approval checkpoints

### ระยะ 4 — Controlled Write Actions

เป้าหมาย: agent ช่วยบันทึกงานโดยไม่ทำลายข้อมูล

- เพิ่ม write tools พร้อม dry-run
- approval dialog ใน Obsidian
- optimistic locking/corpus version check
- reversible changes และ activity history
- instructor policy profiles

เงื่อนไขผ่าน: ทุก write action ระบุผู้สั่ง เหตุผล ผลกระทบ และย้อนกลับได้

### ระยะ 5 — Evaluation และ classroom pilot

เป้าหมาย: วัดว่าระบบช่วยการเรียนรู้ ไม่ใช่เพียงช่วยผลิตข้อความเร็วขึ้น

วัดอย่างน้อย:

- citation precision
- unsupported claim rate
- screening agreement กับผู้เชี่ยวชาญ
- extraction accuracy
- เวลาในการตรวจสอบต่อบทความ
- ความสามารถของนักศึกษาในการอธิบายเหตุผล
- ความแตกต่างระหว่างกลุ่ม agent-assisted และกลุ่ม control
- อัตราการยอมรับคำแนะนำผิดของ agent

เริ่ม pilot ขนาดเล็ก 10–20 คน ก่อนเปิดใช้ทั้งรายวิชา

---

## 10. MVP ที่แนะนำ

MVP รุ่นแรกควรมีเพียง:

1. Review protocol
2. Screening decision และ reason codes
3. Extraction form
4. Evidence ledger
5. Read-only MCP server
6. Codex/Claude skill สำหรับ “ค้น → สร้าง evidence table → ตรวจ citation”
7. Agent run log
8. Markdown report generator

ยังไม่ควรทำใน MVP:

- autonomous web search ที่นำข้อมูลเข้า corpus เอง
- multi-agent ที่แก้ข้อมูลพร้อมกัน
- full-text ingestion ที่ยังไม่จัดการลิขสิทธิ์
- automatic final essay generation
- direct SQLite access
- API adapter เฉพาะ Antigravity ที่ผูกกับรุ่นปัจจุบัน
- cloud synchronization ของข้อมูลนักศึกษาโดยไม่มีนโยบายสถาบัน

---

## 11. ตัวอย่าง task ที่นักศึกษาจะใช้

```text
ใช้ workspace "Digital literacy 2026"

1. ตรวจว่า corpus มีข้อมูลเพียงพอสำหรับตอบคำถาม
   "ปัจจัยใดสัมพันธ์กับ digital literacy ของนักศึกษามหาวิทยาลัย"
2. ห้ามใช้ข้อมูลนอก corpus
3. สร้างตาราง candidate papers 20 เรื่อง
4. แยก supporting, contradicting และ context-only
5. ทุกแถวต้องมี publication ID, ปี, เหตุผล และ source level
6. หากมีเพียง abstract ให้ระบุ abstract-only
7. ยังไม่ต้องเขียน literature review
8. สรุปข้อมูลที่ขาดและคำถามที่นักศึกษาต้องตัดสินใจก่อน
```

ตัวอย่างนี้จงใจให้ agent สร้าง **evidence artifact ก่อน prose** ซึ่งเหมาะกับการสอนมากกว่าคำสั่ง “เขียน literature review ให้ฉัน”

---

## 12. ข้อเสนอการจัดโครงสร้างไฟล์ในอนาคต

```text
src/
  main.ts
  api/
    research-api.ts
    contracts.ts
  database/
    worker.ts
    migrations/
    repositories/
  review/
    protocol.ts
    screening.ts
    extraction.ts
    evidence.ts
    provenance.ts
  notes/
  ui/
  security/

mcp-server/
  src/
    server.ts
    tools/
    resources/
    prompts/
    policy/

agent-pack/
  codex/
    AGENTS.md
    skills/literature-review/
  claude/
    plugin.json
    skills/literature-review/
    .mcp.json
  antigravity/
    README.md
    workflows/

tests/
  fixtures/
  database/
  mcp/
  review/
  evals/
```

ควรแยก `agent-pack` ออกจาก Obsidian plugin release เพราะวงจรการอัปเดตและข้อกำหนดของแต่ละ agent host เปลี่ยนเร็วกว่า research data model

---

## 13. การตัดสินใจเชิงผลิตภัณฑ์

### สิ่งที่ plugin ควรเป็น

**Trusted local research workspace and evidence engine**

### สิ่งที่ plugin ไม่ควรพยายามเป็น

- chatbot อีกหนึ่งตัว
- model provider
- ระบบสร้าง essay อัตโนมัติ
- เครื่องมือแทนวิจารณญาณของนักศึกษา
- full systematic-review platform ตั้งแต่รุ่นแรก

ความได้เปรียบที่แท้จริงของโครงการนี้คือข้อมูล Scopus ที่จัดโครงสร้างแล้ว กราฟความสัมพันธ์ provenance และการอยู่ใน Obsidian ซึ่งเป็นพื้นที่ที่นักศึกษาสามารถอ่าน เชื่อมโยง และเขียนความคิดของตนเองได้ ส่วน agent ควรเป็นผู้ใช้เครื่องมือเหล่านี้ภายใต้กติกาที่ตรวจสอบได้

---

## 14. ข้อสรุปสุดท้าย

ลำดับการลงทุนที่คุ้มค่าที่สุดคือ:

1. คืน source/build structure ให้ repository
2. สร้าง review/evidence data model โดยไม่พึ่ง AI
3. เปิด read-only MCP
4. สร้าง literature-review skills
5. เพิ่ม controlled writes และ approvals
6. ทำ classroom evaluation ก่อนเพิ่ม autonomy

หากเริ่มจากการต่อ API ของ model เข้า UI โดยตรง ระบบอาจสร้างบทสรุปได้เร็ว แต่จะยังขาด reproducibility, evidence trace, academic integrity และ portability ระหว่าง agent ต่าง ๆ

หากเริ่มจาก **MCP + evidence model + pedagogical workflow** plugin นี้มีโอกาสพัฒนาเป็นเครื่องมือที่ช่วยให้นักศึกษาคิดเป็นระบบ ตรวจหลักฐานเป็น และใช้ AI โดยไม่สูญเสียความรับผิดชอบทางวิชาการ

---

## แหล่งข้อมูล

### เอกสารทางการ

- OpenAI, Codex customization: <https://developers.openai.com/codex/concepts/customization>
- OpenAI, Build Codex plugins: <https://developers.openai.com/codex/plugins/build>
- Anthropic, Connect Claude Code to tools via MCP: <https://code.claude.com/docs/en/mcp>
- Model Context Protocol documentation: <https://modelcontextprotocol.io/docs/getting-started/intro>
- Google Antigravity product site: <https://antigravity.google/>

### ข้อมูลประกอบเกี่ยวกับ Antigravity

- The Verge, รายงานการเปิดตัว Antigravity และแนวคิด agent-first/artifacts:  
  <https://www.theverge.com/news/822833/google-antigravity-ide-coding-agent-gemini-3-pro>

> หมายเหตุ: ณ วันที่ค้นคว้า เอกสารสาธารณะที่เข้าถึงได้ของ Codex และ Claude ระบุ integration ผ่าน MCP อย่างชัดเจนกว่า Antigravity ดังนั้นข้อเสนอจึงถือว่า Antigravity เป็น agent host ที่ควรเชื่อมผ่านมาตรฐานหรือ adapter บาง ๆ เมื่อยืนยัน capability ของรุ่นที่สถาบันจะใช้แล้ว
