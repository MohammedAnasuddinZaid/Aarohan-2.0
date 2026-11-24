# Demo Question Bank

Every patient in this dataset is **synthetic** and flagged `synthetic: true`. No
question below is a prompt to fabricate anything: each one is answerable from the
seeded chart and inserted documents, and the assistant cites the passage it read.

The in-app assistant **generates these questions automatically** from the chart
(`src/lib/care/demoQuestions.ts`). Open a session's Live care assistant and the
suggestion chips are built from *that* patient's allergies, latest observation
readings, care plan, active conditions, current medicines and newest document —
so you never have to invent a question and hope the record answers it. The list
below is a ready-made script if you would rather type.

---

## New in this pass (pt_0015–pt_0022)

### pt_0015 — Vikram Singh, 58, post-heart-attack with a coronary stent
- "What is Vikram's latest Troponin reading, and how has it changed?"
  *Shows a falling troponin trend after a heart attack.*
- "What is Vikram's Ticagrelor for, and what dose is it?"
  *Dual antiplatelet therapy — the "do not stop without cardiology advice" note.*
- "What is Vikram's care plan?"
- "Summarise the 'Discharge summary — heart attack with a coronary stent' record."

### pt_0016 — Priya Nair, 27, dengue fever with warning signs
- "What is Priya's latest Platelet count reading, and how has it changed?"
  *180 → 95 → 42 ×10⁹/L — the classic dengue fall.*
- "What is Priya's latest Haematocrit reading, and how has it changed?"
  *42 → 46 → 48% — rising haematocrit with falling platelets = plasma leakage.*
- "What is Priya's care plan?" *Explains why NSAIDs are avoided in dengue.*

### pt_0017 — Mohammed Farooq, 43, pulmonary tuberculosis on daily treatment
- "What is Mohammed's latest Sputum AFB reading, and how has it changed?"
  *Positive → Positive → Negative at two months.*
- "What is Mohammed's latest ALT reading, and how has it changed?"
  *Liver-test monitoring under four-drug TB therapy.*
- "What is Mohammed's Rifampicin for, and what dose is it?"
  *Turns urine orange; interacts with many medicines.*

### pt_0018 — Sunita Rao, 52, breast cancer on chemotherapy
- "What is Sunita allergic to, and what reaction happens?" *Morphine.*
- "What is Sunita's latest Absolute neutrophil count reading, and how has it changed?"
  *3.9 → 0.6 ×10⁹/L — neutropenia and infection risk.*
- "What is Sunita's care plan?" *The 38 °C fever-is-an-emergency rule.*

### pt_0019 — Ramesh Gupta, 71, Parkinson's disease with falls
- "What is Ramesh's latest Blood pressure standing reading, and how has it changed?"
  *Lying 138/82 vs standing 106/66 — orthostatic drop.*
- "What is Ramesh's Levodopa/Carbidopa for, and what dose is it?"
  *Doses must be given exactly on time.*
- "What is Ramesh allergic to, and what reaction happens?"
  *Metoclopramide worsens Parkinson's movements.*

### pt_0020 — Ananya Desai, 30, antenatal care with gestational diabetes
- "What is Ananya's latest Fasting glucose reading, and how has it changed?"
- "What is Ananya's latest Blood pressure reading, and how has it changed?"
  *Pre-eclampsia surveillance.*
- "What is Ananya's care plan?" *Report headache, blurred vision, reduced movements.*

### pt_0021 — Aarav Bose, 4, new asthma diagnosis and peanut allergy
- "What is Aarav allergic to, and what reaction happens?" *Peanuts — severe.*
- "What is Aarav's latest Oxygen saturation reading, and how has it changed?"
  *94% → 97% after treatment.*
- "What is Aarav's Prednisolone for, and what dose is it?" *Short steroid course.*

### pt_0022 — Kavita Pillai, 45, severe anaemia from heavy periods
- "What is Kavita's latest Haemoglobin reading, and how has it changed?"
  *62 → 78 → 95 g/L after intravenous iron.*
- "What is Kavita's latest Ferritin reading, and how has it changed?"
  *4 → 120 ng/mL.*
- "What is Kavita's care plan?" *Complete iron, gynaecology review for fibroids.*

---

## Original scenarios (pt_0001–pt_0014)

| Patient | Scenario | Try asking |
|---|---|---|
| Anita Sharma | Heart-failure follow-up | "What is Anita's latest Weight reading, and how has it changed?" · "What is Anita allergic to, and what reaction happens?" |
| Rahul Verma | Hypertension review | "What is Rahul's latest Systolic BP reading?" · "What medications is Rahul on?" |
| Lakshmi Iyer | Diabetes + dizziness | "What is Lakshmi's latest Fasting glucose reading?" · "What happened at Lakshmi's most recent contact?" |
| Imran Khan | Asthma control | "What is Imran's latest Peak flow reading?" · "What is Imran's Salbutamol for, and what dose is it?" |
| Meera Nair | COPD + oxygen weaning | "What is Meera's latest SpO2 on 1 L oxygen reading?" · "What is Meera's care plan?" |
| David Fernandes | Post-op wound review | "What is David's latest Temperature reading?" · "Summarise the 'Community nurse wound review' record." |
| Margaret O'Connor | Hip fracture + falls | "What is Margaret allergic to, and what reaction happens?" · "When did Margaret have her hip operation?" |
| Arjun Patel | CKD stage 4 + gout | "What is Arjun's latest Potassium reading?" · "What is Arjun allergic to, and what reaction happens?" |
| Sofia Mendes | Postpartum pre-eclampsia | "What is Sofia's latest Blood pressure reading?" · "What is Sofia's care plan?" |
| Thomas Green | AF + recent TIA | "What is Thomas's latest INR reading, and how has it changed?" · "What is Thomas allergic to?" |
| Fatima Al-Hassan | Rheumatoid arthritis + cough | "What is Fatima's latest CRP reading?" · "What is Fatima's Methotrexate for, and what dose is it?" |
| Noah Williams | New type 1 diabetes (child) | "What is Noah's latest Blood glucose reading?" · "What is Noah's Glucagon for, and what dose is it?" |
| Elena Rossi | Stroke + dysphagia | "What is Elena's latest NIHSS reading?" · "Summarise the 'Speech and language therapy note' record." |
| Samuel Okafor | Urosepsis + catheter | "What is Samuel's latest Urine output reading?" · "What is Samuel allergic to?" |

---

## Cross-patient questions (the ward assistant)

- "Who needs follow-up today?"
- "Which patients were escalated?"
- "Which reading is closest to its threshold?"
- "Draft an SBAR handoff" (per focused patient)

## Safety questions (any patient)

- "What are the warning signs of sepsis?"
- "She has chest pain right now" → the emergency path, not a chart lookup.

> The assistant never invents a value, diagnosis or medication change. If the
> chart does not answer a question it says so and names what to check.
