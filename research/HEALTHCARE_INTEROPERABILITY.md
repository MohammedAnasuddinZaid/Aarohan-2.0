# Healthcare Interoperability — CareSpeak → FHIR R4

**Status:** mapping plan and decision record. **Not a deployed FHIR server.**
**Date:** 2026-11-24.
**Method:** CareSpeak field definitions read from `src/lib/care/types.ts` and
`src/lib/care/seedPatients.ts` in this working tree; repository metadata fetched from
`https://api.github.com` (no web search available or used). Anything not verified against a
primary specification in this session is labelled **UNVERIFIED**.

---

## 0. Read this first

> **This document describes how CareSpeak's data maps to FHIR R4. An offline mapper exists
> (`src/lib/care/fhir.ts`, uncommitted at the time of writing) and produces a `Bundle` of
> type `collection`. There is no FHIR endpoint in this product. Nothing here has been sent
> to, received from, or validated by an EHR, a HAPI server, a Medplum project, or a
> terminology service.**
>
> The patients used as examples (`Anita Sharma`, `Rahul Verma`, …) are
> **synthetic demo data**. `seedPatients.ts` says so in its own header ("These are NOT real
> patients. Every record is fabricated for the hackathon and flagged `synthetic: true`"),
> and the domain model carries `ClinicalPatient.synthetic: boolean` plus
> `PatientRecord.synthetic?: boolean`.
>
> **Synthetic demo data must never be presented as a clinical integration.** A FHIR bundle
> generated from this seed is a *test fixture*. It must carry a `synthetic` tag on every
> resource, must never be POSTed to a production FHIR endpoint, and must never appear in a
> demo as "we are integrated with the hospital EHR".

Any prior document, slide or pitch that implies a live FHIR/EHR connection is inaccurate
and should be corrected.

---

## 1. Repository metadata (fetched)

`GET https://api.github.com/repos/<owner>/<repo>`, 2026-11-24. Stars drift; snapshot only.

| Repository | Language | License (SPDX) | Stars | Archived | Pushed | Forks | Open issues |
|---|---|---|---|---|---|---|---|
| `hapifhir/hapi-fhir` | Java | Apache-2.0 | 2,454 | false | 2026-11-23T20:35:22Z | 1,515 | 1,709 |
| `medplum/medplum` | TypeScript | Apache-2.0 | 2,815 | false | 2026-11-24T06:12:50Z | 1,034 | 802 |

Both are actively maintained (push within the last day at fetch time), both Apache‑2.0
(no copyleft problem for a commercial product), and neither is archived. Open-issue counts
are large in absolute terms but normal for projects of this age and scope.

---

## 2. Verdict up front

| Option | Verdict | Reasoning |
|---|---|---|
| **Build the mapper in TypeScript now** (types + JSON + fixtures, no server) | **ADOPT** | Already started: `src/lib/care/fhir.ts` + `tests/care-fhir.test.ts` (8 tests, passing). Zero dependencies, zero PHI surface. It needs hardening against the R4 spec — see §6 — not a rewrite. |
| **Medplum** | **TRIAL (later, gated)** | The only candidate that fits the stack: TypeScript, Apache‑2.0, FHIR R4 server + auth + React tooling. But it is a *service* holding PHI; adopting it means a hosting region, access control, audit review, retention policy and a data-processing agreement. That is a pilot decision, not a hackathon dependency. |
| **HAPI FHIR** | **REJECT as runtime; TRIAL as validator/reference** | Java/JVM server. Adding it means a second language runtime and a heavy operational surface (JPA, Lucene/Elasticsearch, DB tuning) next to Next.js. Its real value here is the **offline validator CLI** — use it to check generated bundles, not to serve them. |

**What to do today:** keep `src/lib/care/fhir.ts` as the single mapper, fix the nine
substantive defects (1–9) in §6, and make the test suite assert *FHIR* constraints
(valid `id`, required elements, absolute `fullUrl`, synthetic tag on every resource) rather
than only the mapper's own output. Nothing listens on a port.

---

## 3. CareSpeak → FHIR R4 resource map

### 3.1 Coverage matrix

Source types are exactly as declared in `src/lib/care/types.ts`.

| CareSpeak source | FHIR R4 target | Fidelity | Notes |
|---|---|---|---|
| `ClinicalPatient` | `Patient` | High, one gap (`age`) | §4.1 |
| `ClinicalCondition` | `Condition` | High, one lossy status | §4.2 |
| `ClinicalMedication` | `MedicationStatement` | High | §4.3. `MedicationRequest` is the better target if a prescriber is known. |
| `ClinicalAllergy` | `AllergyIntolerance` | Medium | Free-text substance, no terminology (§4.4) |
| `ClinicalObservation` | `Observation` | Medium–High | Needs LOINC + UCUM decisions (§4.5) |
| `EncounterSummary` | `Encounter` | Medium | Free-text summary has no `note` element in R4 (§4.6) |
| `ClinicalPatient.carePlan` (string) | `CarePlan` | Medium | One sentence → activities must be split manually (§4.7) |
| `PatientMessage` | `Communication` | High | §4.8 |
| `CareTask` | `Task` | High | Bonus — not in the required list, but already modelled |
| `CareAuditEntry` | `AuditEvent` | High | Bonus — audit is the interoperability story regulators ask about |
| `CareReport` | `DocumentReference` / `Composition` | Medium | §4.9 |
| `CareTranscriptEntry[]` | `DocumentReference` (text) or `Communication` per turn | Low–Medium | Not clinically structured; export as a document |
| `CareSession` | `Encounter` (telehealth) | Medium | Session tokens/hashes must never be exported |

### 3.2 Identifier and ID strategy

FHIR's `Resource.id` is restricted to `[A-Za-z0-9\-\.]{1,64}` — **underscores are
invalid**, so `pt_0001` cannot be used verbatim. The current mapper uses it verbatim
(`id: patient.id`) and every derived id inherits the underscore (`pt_0001-c1`); see §6,
defect 1.

| CareSpeak | FHIR | Example |
|---|---|---|
| `id: "pt_0001"` | `Resource.id` | `"pt-0001"` (underscore → hyphen) |
| `id: "pt_0001"` (original) | `Patient.identifier.value` with `system: "https://carespeak.example/identifiers/patient"` | preserves the source value losslessly |
| `extension: "1001"` | `Patient.identifier` with `system: "https://carespeak.example/identifiers/extension"`, `type.coding` = `MR` (medical record number) | `"1001"` |
| `synthetic: true` | `meta.tag` on **every** resource | `{system: "https://carespeak.example/tags", code: "synthetic", display: "Synthetic demo data"}` |

`carespeak.example` is a reserved `.example` domain on purpose — it cannot collide with a
real issuer. Replace it with the deploying organisation's URI before any pilot.

**Rule:** the same `synthetic` tag must be applied to the `Bundle` *and* to each contained
resource. A tag only on the bundle is lost the moment someone extracts a resource.

---

## 4. Field-level mappings, with real seed values

All examples below use `pt_0001` / Anita Sharma from `seedPatients.ts`.

### 4.1 `ClinicalPatient` → `Patient`

| CareSpeak field | FHIR R4 element | Example | Note |
|---|---|---|---|
| `id` | `Patient.id` | `pt-0001` | see §3.2 |
| `extension` | `Patient.identifier[1]` (type `MR`) | `1001` | |
| `displayName` | `Patient.name[0]` | `family: "Sharma"`, `given: ["Anita"]` | Splitting a display name is a guess. Safer: `name.text = "Anita Sharma"` **plus** `family`/`given` only when the source has structured name parts. The current model does not. |
| `sex` | `Patient.gender` | `female` | Map `female`/`male` → `female`/`male`; anything else → `other` or `unknown`, never guess. |
| `age: 68` | **no direct element** | — | `Patient.birthDate` is a *date*, not an age. **Do not compute a birthDate from today's date** — it drifts daily and is fabricated precision. The current mapper gets this right: it emits a `chart-age-years` extension. Keep that, or add `birthDate` to the source model. |
| `language: "en"` | `Patient.communication[0].language` | `{coding:[{system:"urn:ietf:bcp:47", code:"en"}]}`, `preferred: true` | BCP‑47. `en-IN` if the deployment locale is known. |
| `room: "Ward A / Bed 3"` | **no Patient element** | — | `Patient` has no location. Use `Encounter.location` (with a `Location` resource) for the current stay. Do not invent a `Patient` extension for it. |
| `primaryConcern` | `Condition` (as a problem-list item) or `Encounter.reasonCode.text` | — | It is a reason for care, not a demographic. Prefer `Encounter.reasonCode`. |
| `carePlan` | `CarePlan` | — | §4.7 |
| `synthetic` | `meta.tag` | — | §3.2 |

**Does not map:** `room` (belongs to Encounter/Location), `age` (no lossless element),
`primaryConcern` (belongs to Encounter/Condition).

### 4.2 `ClinicalCondition` → `Condition`

| CareSpeak | FHIR | Example |
|---|---|---|
| `id: "c1"` | `Condition.id` | `cond-pt-0001-c1` (prefix to keep ids globally unique) |
| `code: "I50.9"` | `Condition.code.coding[0].code` | `I50.9` |
| `name: "Heart failure (NYHA II)"` | `Condition.code.coding[0].display` **and** `Condition.code.text` | `Heart failure (NYHA II)` |
| **code system — not recorded** | `Condition.code.coding[0].system` | must be declared: `http://hl7.org/fhir/sid/icd-10-cm` (US) or `http://hl7.org/fhir/sid/icd-10` (WHO). **The seed mixes formats and never states the system.** Treat every code as **UNVERIFIED** until checked against a release. |
| `status: "active"` | `Condition.clinicalStatus` = `active` | |
| `status: "resolved"` | `Condition.clinicalStatus` = `resolved` | |
| `status: "history"` | `Condition.clinicalStatus` = `inactive` + local extension holding `"history"` | **Lossy.** FHIR has no "history" state; `inactive` is the closest, but "past medical history" and "inactive problem" are not the same claim. The current mapper maps it to `resolved`, which is stronger and false — see §6, defect 2. |
| `since: "2021-04-10"` | `Condition.onsetDateTime` | `2021-04-10` (date-only is legal for `dateTime`) |
| `note` | `Condition.note[0].text` | `Treated in hospital, resolved` |

Also set `Condition.subject = Reference(Patient/pt-0001)` and
`Condition.verificationStatus` explicitly (`confirmed` for clinician-entered, `unconfirmed`
for patient-reported) — leaving it absent implies nothing.

### 4.3 `ClinicalMedication` → `MedicationStatement`

| CareSpeak | FHIR | Example |
|---|---|---|
| `name: "Furosemide"` | `medicationCodeableConcept.text` | No drug code in the seed. Do **not** invent an RxNorm/SNOMED code; `text` is honest. |
| `dose: "40 mg"` | `dosage[0].doseAndRate[0].doseQuantity` | `{value: 40, unit: "mg", system: "http://unitsofmeasure.org", code: "mg"}` (parse; keep `dosage.text` verbatim as well) |
| `route: "oral"` | `dosage[0].route` | `{coding:[{system:"http://snomed.info/sct", code:"26643006", display:"Oral route"}]}` — candidate code, **UNVERIFIED** |
| `frequency: "once daily"` | `dosage[0].timing` or `dosage[0].text` | `timing.code.text = "once daily"`; do not fabricate a structured `repeat` schedule from prose |
| `status: "active"` / `"stopped"` | `MedicationStatement.status` | `active` / `stopped` (both valid R4 values) |
| `since` | `effectiveDateTime` | `2021-04-12` |
| `note` | `note[0].text` | `Added for BP control` |

If a prescriber and order intent are later captured, emit **`MedicationRequest`** instead;
`MedicationStatement` is the correct resource for "what the patient says they take".

### 4.4 `ClinicalAllergy` → `AllergyIntolerance`

| CareSpeak | FHIR | Example |
|---|---|---|
| `substance: "Penicillin"` | `code.text` (and `code.coding` only if a real terminology code is supplied) | `Penicillin` |
| `reaction: "Rash and facial swelling"` | `reaction[0].manifestation[0].text` | free text is acceptable in R4 |
| `severity: "moderate"` | `reaction[0].severity` | `moderate` (`mild`/`moderate`/`severe` are the only R4 values) |
| `severity: "unknown"` | omit `reaction.severity`, or `nullFlavor` | do not map to `mild` |
| **criticality — not modelled** | `AllergyIntolerance.criticality` | `low`/`high`/`unable-to-assess`. The app has no such field; emit `unable-to-assess` or omit. **Never infer `high` from `severity: severe`** — they are different concepts. The current mapper does exactly that inference; see §6, defect 3. |
| `severity` | `reaction[0].severity` | The current mapper drops it into `criticality` instead of emitting `severity` — see §6. |
| — | `patient`, `clinicalStatus: active`, `verificationStatus` | `verificationStatus: unconfirmed` for patient-reported |

### 4.5 `ClinicalObservation` → `Observation`

The hardest mapping, because the label is free text and units are ad hoc.

| CareSpeak | FHIR | Example |
|---|---|---|
| `label: "Weight"` | `code` | candidate LOINC `29463-7` (Body weight) — **UNVERIFIED against a LOINC release in this session** |
| `value: 74.1`, `unit: "kg"` | `valueQuantity` | `{value: 74.1, unit: "kg", system: "http://unitsofmeasure.org", code: "kg"}` |
| `value: "118/72"`, `unit: "mmHg"` | `component[]` (systolic + diastolic) | needs a parser + validation; if the string is not confidently parseable, emit `valueString` and flag it — do not silently drop half a BP |
| `at` | `effectiveDateTime` | ISO from `daysAgo()` |
| `provenance: "record" \| "patient" \| "ai"` | `meta.tag` or a linked `Provenance` resource | `ai`-derived values must be distinguishable at export, or a downstream clinician will read a generated number as measured |
| — | `status` | `final` for clinician-recorded, `preliminary` for device/patient-reported streams |
| — | `category` | `vital-signs` for weight/BP/HR/SpO₂/temperature; `laboratory` for glucose/Hb/K⁺/creatinine; `survey` for pain score (candidate) |

Candidate LOINC codes (all **UNVERIFIED**, verify before use): weight `29463-7`, heart rate
`8867-4`, SpO₂ by pulse oximetry `59408-5`, systolic BP `8480-6`, diastolic BP `8462-4`,
body temperature `8310-5`, glucose `2339-0`, haemoglobin `718-7`, pain severity `72514-3`.

The current mapper uses `2708-6` ("Oxygen saturation in Arterial blood") for the two SpO₂
labels — that is the blood-gas observable, not pulse oximetry, so a downstream system will
read a finger-probe reading as an arterial sample. See §6, defect 4. Note that collapsing
`"SpO2 on 1 L oxygen"` and `"SpO2 after walking (2 L oxygen)"` onto one code is the *right*
direction; the loss is that the oxygen delivery condition is not recorded anywhere.

**Naming warning from the seed itself:** labels such as `"SpO2 on 1 L oxygen"` and
`"SpO2 after walking (2 L oxygen)"` are *conditions of measurement*, not different
observables. They must share one LOINC code with the oxygen delivery recorded in
`Observation.component` / `method` / a device reference — otherwise a query for "SpO₂" sees
two unrelated series. This is the same class of problem the retriever has with
"steroid"/"prednisolone" (see `RAG_CAG_ARCHITECTURE.md` §3): the fix belongs in the
document, not in the query.

### 4.6 `EncounterSummary` → `Encounter`

| CareSpeak | FHIR | Example |
|---|---|---|
| `kind: "in-person"` | `class` | `AMB` (ambulatory) — candidate |
| `kind: "web-voice-call"` / `"telephony"` | `class` | `VR` (virtual) — candidate, **UNVERIFIED** against the v3-ActCode value set |
| `kind: "message"` | **not an Encounter** | a message is a `Communication`; mapping it to an Encounter inflates contact counts |
| `at` | `period.start` (+ `period.end` if duration known) | |
| `by: "Dr. Rao"` | `participant[0].individual.display` | |
| `summary: "Discharged after heart-failure exacerbation…"` | `Encounter.text` (Narrative) and/or a linked `DocumentReference` | **R4 `Encounter` has no free-text `note` element** — confirm against the R4 definition before building. Putting the summary in `reasonCode.text` would be semantically wrong. |
| — | `status: "finished"` | historical entries |

### 4.7 `carePlan` (string) → `CarePlan`

`carePlan` is one prose sentence, e.g.
*"Daily weight, fluid balance, medication adherence and symptom check for 14 days after
discharge."* That is four activities in one string.

```json
{
  "resourceType": "CarePlan",
  "id": "cp-pt-0001",
  "status": "active",
  "intent": "plan",
  "title": "Post-discharge heart-failure follow-up",
  "description": "Daily weight, fluid balance, medication adherence and symptom check for 14 days after discharge.",
  "subject": { "reference": "Patient/pt-0001" },
  "period": { "start": "2026-11-15" },
  "activity": [
    { "detail": { "status": "scheduled", "description": "Daily weight" } },
    { "detail": { "status": "scheduled", "description": "Fluid balance" } }
  ],
  "meta": { "tag": [{ "system": "https://carespeak.example/tags", "code": "synthetic" }] }
}
```

The activity split is **manual curation**, not NLP. Do not ship an automatic sentence
splitter and call the result structured data.

Also note the period: the seed stores the plan text only, with no start/end. `"for 14 days
after discharge"` is prose inside the string; deriving `period.end` from it is an inference.
Either leave `period` absent or add explicit fields to the source model.

### 4.8 `PatientMessage` → `Communication`

| CareSpeak | FHIR | Example |
|---|---|---|
| `text` | `payload[0].contentString` | `Remember to weigh yourself before breakfast.` |
| `createdAt` | `sent` | |
| `createdBy: "Nurse Demo"` | `sender.display` | a `Practitioner` reference is better once identities exist |
| `patientId` | `subject` + `recipient[0]` | `Reference(Patient/pt-0001)` |
| `channel: "web-voice-demo"` | `medium` / `category` | no standard code for this channel; use a local CodeableConcept and say so |
| `readAt` | **no element** | `Communication` has no read receipt; a `Provenance` or app-side field is required |
| — | `status: "completed"` | |

### 4.9 Reports and transcripts

`CareReport` → `DocumentReference` (or `Composition` if a structured clinical document is
wanted). Its `sections` map naturally onto `Composition.section[]`, but each section is a
mix of `record`/`patient`/`ai` provenance (`CareReportFact.provenance`), and
`sourceFlags.aiGenerated` must survive the export. A `DocumentReference` with a binary
attachment loses that structure; `Composition` preserves it. Neither is required for this
mapping plan — flagged as future work.

`CareTranscriptEntry[]` is conversational text, not clinical structure. Export as one
`DocumentReference` per session; do **not** emit one `Communication` per utterance.

---

## 5. Example bundle (abbreviated)

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "meta": { "tag": [{ "system": "https://carespeak.example/tags", "code": "synthetic" }] },
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "pt-0001",
        "meta": { "tag": [{ "system": "https://carespeak.example/tags", "code": "synthetic" }] },
        "identifier": [
          { "system": "https://carespeak.example/identifiers/patient", "value": "pt_0001" },
          { "type": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "MR" }] },
            "system": "https://carespeak.example/identifiers/extension", "value": "1001" }
        ],
        "active": true,
        "name": [{ "text": "Anita Sharma", "use": "official" }],
        "gender": "female",
        "communication": [{ "language": { "coding": [{ "system": "urn:ietf:bcp:47", "code": "en" }] }, "preferred": true }]
      }
    },
    {
      "resource": {
        "resourceType": "Condition",
        "id": "cond-pt-0001-c1",
        "meta": { "tag": [{ "system": "https://carespeak.example/tags", "code": "synthetic" }] },
        "clinicalStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active" }] },
        "verificationStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "confirmed" }] },
        "code": { "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10", "code": "I50.9", "display": "Heart failure (NYHA II)" }], "text": "Heart failure (NYHA II)" },
        "subject": { "reference": "Patient/pt-0001" },
        "onsetDateTime": "2021-04-10"
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "id": "obs-pt-0001-o3",
        "meta": { "tag": [
          { "system": "https://carespeak.example/tags", "code": "synthetic" },
          { "system": "https://carespeak.example/tags", "code": "provenance-record" }
        ] },
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs" }] }],
        "code": { "coding": [{ "system": "http://loinc.org", "code": "29463-7", "display": "Body weight" }] },
        "subject": { "reference": "Patient/pt-0001" },
        "effectiveDateTime": "2026-11-23T09:00:00Z",
        "valueQuantity": { "value": 74.1, "unit": "kg", "system": "http://unitsofmeasure.org", "code": "kg" }
      }
    }
  ]
}
```

Note what is deliberately **absent**: `birthDate` (only an age is known), any SNOMED/RxNorm
coding not present in the source, and any `period.end` inferred from prose.

---

## 6. Review of the current mapper (`src/lib/care/fhir.ts`)

The mapper is a good start: pure, offline, no dependencies, honest header, synthetic tagging
for the Patient, `DocumentReference` for free-text records, and an explicit "only codes we
are confident about" table instead of fabricated codings. `tests/care-fhir.test.ts` passes
8/8.

But the tests assert *the mapper's own output*, not **FHIR conformance**, so they pass while
several resources are not valid R4 or say something clinically false. These are the defects
worth fixing before anyone calls this "FHIR support":

| # | Severity | What the code does | Why it matters | Fix |
|---|---|---|---|---|
| 1 | **Blocking** | `id: patient.id` → `"pt_0001"`; children → `"pt_0001-c1"` | Underscore is outside the R4 `id` regex `[A-Za-z0-9\-\.]{1,64}`. A strict validator rejects the whole bundle. | Slugify to `pt-0001`; preserve the original in `identifier.value` (§3.2). |
| 2 | **High (clinical meaning)** | `STATUS_MAP: { history: "resolved" }` | A past-medical-history condition is not a resolved condition. Also `clinicalStatus.coding[0]` has **no `system`**, so the binding cannot be interpreted. | `history` → `inactive` + source-preserving extension; always emit `system: http://terminology.hl7.org/CodeSystem/condition-clinical`; add `verificationStatus`. |
| 3 | **High (clinical meaning)** | `criticality: severe → "high"`, `moderate → "low"`, else `unable-to-assess` | `criticality` is about the *potential for a life-threatening reaction*, not reaction severity. `moderate → low` is arbitrary. The real `reaction.severity` is never emitted, so severity is lost and a guess is promoted into its place. | Emit `reaction[0].severity: mild\|moderate\|severe`; set `criticality: "unable-to-assess"` unless a clinician recorded it. |
| 4 | **High (terminology)** | SpO₂ labels → LOINC `2708-6` ("Oxygen saturation in Arterial blood") | Finger-probe readings would be read as arterial blood gas results. Also no `category`, and `valueQuantity` has `unit` but no UCUM `system`/`code`. | Use `59408-5` for pulse oximetry, `2708-6` only for ABG; add `category: vital-signs` and UCUM `system`/`code`. |
| 5 | **Blocking** | `CarePlan` without `intent` | `CarePlan.intent` is **1..1 required** in R4. The resource is invalid as emitted. | Add `intent: "plan"` plus `title`; optionally split activities (manual curation only). |
| 6 | **Blocking** | `DocumentReference` without `content` | `DocumentReference.content` is **1..* required**; `status: "current"` alone is not a document. The comment "content lives elsewhere" means no consumer can resolve it. | Add `content[0].attachment` (URL or inline base64 text), or drop the resource and keep records app-side. |
| 7 | **High (safety)** | `synthetic` tag only on `Patient` (and on `DocumentReference` if `record.synthetic`) | A `Condition` or `Observation` extracted from a synthetic bundle carries no marker and is indistinguishable from real clinical data — the exact failure this project says it wants to prevent. The `Bundle` itself is untagged. | Tag **every** resource and the Bundle (§3.2 rule). |
| 8 | Medium (semantics) | `medicationCodeableConcept.text = "Furosemide 40 mg"` and `dosage.text` repeats it | Dose inside the drug name breaks name matching downstream and duplicates data in one resource. | `medicationCodeableConcept.text = "Furosemide"`; dose/route/frequency in `dosage`. |
| 9 | Medium (conformance) | `fullUrl: "Patient/pt-0001"` (relative) | R4 expects `Bundle.entry.fullUrl` to be an absolute URI. Relative references happen to work with lenient parsers. | Build `urn:uuid:` or `https://…/Patient/pt-0001`. |
| 10 | Low | `communication[0].language.text = "en"` | `text` is a human display; `"en"` is a BCP‑47 code. | `coding: [{system: "urn:ietf:bcp:47", code: "en"}]`. |
| 11 | Low | `Encounter` has no `class`; `kind: "message"` becomes an Encounter | Contact type is lost, and a message inflates encounter counts. US Core requires `Encounter.class`. | Map `in-person → AMB`, `web-voice-call/telephony → VR`; keep `message` as `Communication` only. |

**Do not interpret 8/8 passing as conformance.** The cheapest way to make that distinction
real is step 2 in §8: feed the generated bundles to the HAPI FHIR validator in CI and let it
fail the build. Everything above is visible today by reading the code; the validator would
have caught 1, 5, 6 and 9 mechanically.

---

## 7. Validation, terminology and security — what "real" would require

This is the checklist that separates the mapping plan from an integration.

| Requirement | Status today | What it would take |
|---|---|---|
| Profile validation | **Not done** | Validate bundles with the HAPI FHIR validator (Java CLI) in CI. Not installed here — **UNVERIFIED**. |
| Terminology binding | **Not done** | ICD‑10 system declaration; LOINC/UCUM/SNOMED licensing and a terminology server or curated subset |
| Identifiers | **Not done** | MPI / MRN issuer agreement with the receiving organisation; current IDs are local demo strings |
| Auth & consent | **Not done** | SMART on FHIR (SMART App Launch) or backend OAuth2; patient consent capture and revocation |
| Audit | Partial app-side (`CareAuditEntry`, `appendAudit`) | Emit `AuditEvent`; retain per local policy; make cache hits auditable (see RAG doc §7) |
| Provenance | Typed in the app (`Provenance = "record" \| "patient" \| "ai"`) | Emit FHIR `Provenance` so AI-generated content stays distinguishable downstream |
| De-identification | Not implemented | If any bundle leaves the trust boundary, de-identify (Safe Harbor / expert determination) — synthetic data is the only data that may leave as-is, and only labelled |
| Data residency / DPDP / GDPR | Referenced in docs, not implemented | Deployment decision; FHIR server region must match |
| Vendor compliance claims (SOC2, HIPAA) | **UNVERIFIED** | Medplum markets these; they are vendor claims. Get the report and a signed agreement before sending PHI. |

---

## 8. Recommended plan

| Step | Deliverable | Gate |
|---|---|---|
| 1 | Harden `src/lib/care/fhir.ts`: defects 1–9 in §6 (§6 items 10–11 optional) | `npm test` green; no new dependency |
| 2 | `tests/fixtures/fhir/*.json` + HAPI validator run (offline, CI job) | Zero validation errors on the seed patients |
| 3 | Extend `tests/care-fhir.test.ts` to assert *constraints*, not output: valid `id` charset, required elements (`CarePlan.intent`, `DocumentReference.content`), absolute `fullUrl`, synthetic tag on every resource | The current 8 tests would fail on at least 4 of these — that is the point |
| 4 | Document the losses: `age`, `room`, `history` status, free-text substance, un-coded units, oxygen delivery condition | Appendix in this file |
| 5 | Only on a real pilot: Medplum project + SMART auth + `AuditEvent` + terminology | Signed DPA/BAA, named clinical owner |

**Hard rules**

1. Never present a generated bundle as evidence of an EHR integration.
2. Never send synthetic demo data to a production or partner FHIR endpoint.
3. Never infer `birthDate`, `criticality`, LOINC codes or drug codes from free text and
   present the result as recorded fact.
4. Never export session join tokens, `joinTokenHash`, `participantTokenHash`, `joinCode` or
   `nurseId` — `CareSessionView` already omits them; the exporter must too.
5. Keep the `synthetic` tag on every resource, in every transform, forever.

---

## Sources

- Source read in this working tree: `src/lib/care/types.ts`,
  `src/lib/care/seedPatients.ts`, `src/lib/care/store.ts` (`CareKeys`),
  `src/lib/care/portalBrain.ts` (audit + message paths),
  `src/lib/care/fhir.ts` (existing mapper), `tests/care-fhir.test.ts`.
- Measured locally: `npx vitest run tests/care-fhir.test.ts` → 8/8 pass. That suite checks
  mapper output, not R4 conformance; §6 lists what it does not catch.
- FHIR R4 element/status/value-set names are cited from the R4 specification as
  professional knowledge; they were **not** re-fetched in this session. Anything marked
  candidate or UNVERIFIED (LOINC codes, UCUM `mm[Hg]`, `VR` encounter class, absence of a
  `note` element on `Encounter`, `id` regex) must be confirmed against the R4 text or a
  validator before implementation.
- Repository metadata: GitHub REST API `GET /repos/hapifhir/hapi-fhir` and
  `GET /repos/medplum/medplum`, fetched 2026-11-24.

Sources verified via GitHub API on 2026-11-24