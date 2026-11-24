/**
 * Demo content for the Web Voice Call — Demo.
 *
 * A freshly deployed site would otherwise look empty, which is a poor demo. This
 * module seeds a small amount of realistic, clearly-synthetic history the first
 * time the store is used: two completed sessions (one escalated, one reviewed),
 * grounded reports, a follow-up task and messages for patients.
 *
 * It is idempotent (guarded by a store flag), skipped in tests, and can be turned
 * off entirely with CARE_SEED_DEMO=false. It never invents clinical facts: the
 * reports are built by the same `buildReport` used at runtime, from the seeded
 * transcripts and the synthetic records.
 */
import { getDriver, CareKeys as K } from "./store";
import { SYNTHETIC_PATIENTS } from "./seedPatients";
import { hashToken, isoNow, newId, newToken } from "./crypto";
import { buildReport } from "./report";
import type {
  CareEvent,
  CareEventType,
  CareReport,
  CareSession,
  CareTask,
  CareTranscriptEntry,
  PatientMessage,
  PatientRecord,
} from "./types";

let inFlight: Promise<void> | null = null;
let recordsInFlight: Promise<void> | null = null;

/** Bump when DEMO_RECORDS changes so existing stores receive the new documents. */
const RECORDS_SEED_VERSION = 3;

export function ensureDemoSeed(): Promise<void> {
  // Never let demo seeding break a real request.
  if (!inFlight) inFlight = run().catch(() => undefined);
  return inFlight;
}

/**
 * Seeds the synthetic *clinical records* that give the history-aware assistant
 * something substantial to read. Kept separate from the session seed so an
 * existing deployment can receive the newer dataset without duplicating demo
 * sessions.
 *
 * Idempotent: each record has a stable id, and the guard is only written after
 * the pass completes. Patients the nurse deleted are skipped (including their
 * records), so demo content is never resurrected.
 */
export function ensurePatientRecordSeed(): Promise<void> {
  if (!recordsInFlight) recordsInFlight = seedRecords().catch(() => undefined);
  return recordsInFlight;
}

async function seedRecords(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if ((process.env.CARE_SEED_DEMO ?? "").toLowerCase() === "false") return;

  const d = await getDriver();
  const guard = (await d.getDoc(K.recordsSeed)) as { version?: number; seeded?: number } | null;
  if (guard && Number(guard.version ?? 0) >= RECORDS_SEED_VERSION) return;

  const existingPatients = new Set<string>();
  for (const p of SYNTHETIC_PATIENTS) {
    if (await d.getDoc(K.patientDeleted(p.id))) continue;
    if (await d.getDoc(K.patient(p.id))) existingPatients.add(p.id);
  }

  // Patient seeding has not run yet. Retry on the next call rather than
  // writing an empty guard that would skip the records forever.
  if (!existingPatients.size) {
    if (await d.getDoc(K.patientSeeded)) {
      await d.setDoc(K.recordsSeed, {
        at: isoNow(),
        version: RECORDS_SEED_VERSION,
        seeded: 0,
        note: "no synthetic patients remain",
      });
    }
    return;
  }

  let indexed: string[] = [];
  try {
    indexed = ((await d.getList(K.recordIndex)) as unknown[]).filter(
      (x): x is string => typeof x === "string"
    );
  } catch {
    const raw = await d.getDoc(K.recordIndex);
    if (Array.isArray(raw)) indexed = raw.filter((x): x is string => typeof x === "string");
  }
  const indexSet = new Set(indexed);

  let seeded = 0;
  for (const seed of DEMO_RECORDS) {
    if (!existingPatients.has(seed.patientId)) continue;
    if (await d.getDoc(K.record(seed.id))) continue;

    const text = seed.text.trim();
    const record: PatientRecord = {
      id: seed.id,
      patientId: seed.patientId,
      title: seed.title,
      source: seed.source,
      text,
      chars: text.length,
      createdAt: daysAgo(seed.daysAgo, seed.hour ?? 9, 0),
      createdBy: "Demo seed",
      synthetic: true,
    };
    await d.setDoc(K.record(record.id), record);
    if (!indexSet.has(record.id)) {
      await d.appendList(K.recordIndex, record.id, 1000);
      indexSet.add(record.id);
    }
    seeded += 1;
  }

  await d.setDoc(K.recordsSeed, { at: isoNow(), version: RECORDS_SEED_VERSION, seeded });
  if (seeded > 0) {
    await d.appendList(
      K.audit,
      {
        id: newId("aud"),
        at: isoNow(),
        actorRole: "system",
        action: "care.demo_records_seeded",
        detail: { records: seeded, patients: existingPatients.size },
      },
      5000
    );
  }
}

interface DemoRecordSeed {
  id: string;
  patientId: string;
  title: string;
  source: string;
  daysAgo: number;
  hour?: number;
  text: string;
}

/** Stable synthetic documents — deliberately verbose so deep questions work. */
export const DEMO_RECORDS: DemoRecordSeed[] = [
  {
    id: "rec_seed_pt_0001_discharge",
    patientId: "pt_0001",
    title: "Discharge summary — heart failure",
    source: "Hospital discharge",
    daysAgo: 9,
    text: `Admitted with acute decompensated heart failure. Weight on admission 76.8 kg, 74.9 kg at discharge after intravenous diuresis.
Medication on discharge: furosemide 40 mg oral once daily (new), ramipril 5 mg once daily continued, metformin 500 mg twice daily and atorvastatin 20 mg at night unchanged.
Plan: fluid restriction 1.5 L per day, daily morning weight, low-salt diet, repeat electrolytes and renal function in one week.
Safety advice given: seek review for weight gain of more than 2 kg in three days, new orthopnoea, resting breathlessness or worsening ankle swelling.
Allergy: penicillin — rash and facial swelling. Contrast dye — nausea and hives.
Follow-up: community nursing check-in and GP review within seven days.`,
  },
  {
    id: "rec_seed_pt_0001_weights",
    patientId: "pt_0001",
    title: "Home monitoring log — week 1",
    source: "Patient-reported",
    daysAgo: 2,
    text: `Morning weights: 71.2 kg on day 1, 72.4 kg on day 4, 74.1 kg on day 7.
Ankle swelling noticed from day 5. Needed two pillows to sleep on day 6. No chest pain and no fever.
Furosemide was missed on day 3 because the prescription ran out; restarted on day 4 after the pharmacy supplied it.
Appetite reduced. Patient reports feeling more tired than usual and becoming breathless walking to the kitchen.`,
  },
  {
    id: "rec_seed_pt_0001_gp",
    patientId: "pt_0001",
    title: "GP telephone note",
    source: "Primary care",
    daysAgo: 1,
    hour: 16,
    text: `GP spoke to the patient after the nurse flagged a two-kilogram weight gain and new orthopnoea.
Plan: same-day clinical review, check electrolytes and renal function, and consider increasing diuretic dose only after examination.
Patient advised to continue daily weights and to call the care line if breathlessness worsens at rest.`,
  },
  {
    id: "rec_seed_pt_0002_bp_review",
    patientId: "pt_0002",
    title: "Hypertension review — medication titration",
    source: "Clinic letter",
    daysAgo: 30,
    text: `Home blood-pressure average over two weeks was 148/92 mmHg despite amlodipine 10 mg daily.
Hydrochlorothiazide 12.5 mg daily added. Check urea and electrolytes in two weeks. Continue rosuvastatin 10 mg at night.
Recorded allergy: sulfa antibiotics cause itching. Hydrochlorothiazide has been tolerated; no rash reported.
Advice: reduce salt intake, continue home readings twice daily, and send the log before the next review.`,
  },
  {
    id: "rec_seed_pt_0002_bp_log",
    patientId: "pt_0002",
    title: "Home blood-pressure log",
    source: "Patient-reported",
    daysAgo: 5,
    text: `Morning readings: 142/88, 146/90, 138/86, 136/84, 140/86 mmHg.
Evening readings: 138/84, 134/82, 136/80 mmHg.
No dizziness, no headaches, no chest pain. Medication adherence reported as good.
Patient has been walking 30 minutes most days and has reduced added salt.`,
  },
  {
    id: "rec_seed_pt_0003_diabetes",
    patientId: "pt_0003",
    title: "Diabetes clinic letter",
    source: "Clinic letter",
    daysAgo: 20,
    text: `HbA1c 8.9% (above the agreed target). Fasting glucose has been between 9 and 12 mmol/L at home.
Current treatment: gliclazide 80 mg daily and metformin 1 g twice daily. Calcium and vitamin D continued for osteoporosis.
Reports dizziness on standing, with a documented orthostatic drop of 20/10 mmHg. Advised to rise slowly, maintain hydration and check a capillary glucose during episodes.
Review medication timing and consider whether gliclazide is contributing to the dizziness.`,
  },
  {
    id: "rec_seed_pt_0003_falls",
    patientId: "pt_0003",
    title: "Falls risk assessment",
    source: "Community nursing",
    daysAgo: 7,
    text: `Falls risk assessed as high after a near-fall in the bathroom.
Findings: dizziness on standing, osteoporosis, poor night lighting and no grab rail beside the shower.
Actions: occupational therapy referral, grab rail installation, review footwear, keep the phone within reach, check capillary glucose during dizzy episodes, and ask the GP to review medication timing.
Patient lives alone and has a daughter who calls twice daily.`,
  },
  {
    id: "rec_seed_pt_0004_asthma",
    patientId: "pt_0004",
    title: "Asthma annual review",
    source: "Clinic letter",
    daysAgo: 60,
    text: `Asthma control test score 20. Peak flow 380–410 L/min against a personal best of 450 L/min.
Night-time symptoms about once a week. Reliever used around twice a week. Inhaler technique checked and good.
Continue budesonide/formoterol 160/4.5 µg twice daily and salbutamol as needed. Cetirizine continued for allergic rhinitis.
Action plan updated. Advise a review if reliever use increases, night symptoms occur more than twice a week, or peak flow falls below 320 L/min.`,
  },
  {
    id: "rec_seed_pt_0004_pharmacy",
    patientId: "pt_0004",
    title: "Pharmacy medication review",
    source: "Pharmacy",
    daysAgo: 14,
    text: `Medication adherence reported as good. No oral steroid courses in the last twelve months.
Salbutamol use approximately twice a week. Budesonide/formoterol continued. Cetirizine taken daily during the pollen season.
Discussed dust-mite measures and avoiding known triggers. Patient knows to seek urgent help for reliever use that does not settle symptoms.`,
  },
  {
    id: "rec_seed_pt_0005_discharge",
    patientId: "pt_0005",
    title: "Discharge summary — COPD exacerbation",
    source: "Hospital discharge",
    daysAgo: 5,
    text: `Admitted with an infective COPD exacerbation. Treated with nebulised bronchodilators, intravenous hydrocortisone and a five-day antibiotic course.
Discharged on prednisolone 30 mg daily with a five-day taper, tiotropium 18 µg daily, salbutamol 100 µg as needed and amlodipine 5 mg daily.
Home oxygen at 1 L/min via nasal cannula, with the target saturation range documented by the respiratory team as 88–92%.
Plan: complete the steroid taper, check saturation on room air twice daily, and refer to pulmonary rehabilitation.
Safety advice: call the care line for worsening breathlessness at rest, new confusion, fever or saturation below the documented range.`,
  },
  {
    id: "rec_seed_pt_0005_resp",
    patientId: "pt_0005",
    title: "Respiratory therapy note",
    source: "Respiratory therapist",
    daysAgo: 2,
    text: `Saturation 91% on 1 L/min at rest and 94% on 2 L/min after walking 30 metres. Respiratory rate 22, heart rate 96, temperature 37.2 °C.
Used pursed-lip breathing and rested twice during the walk. Describes anxiety about reducing the oxygen.
Inhaler technique reviewed. Continue the prednisolone taper. Refer to pulmonary rehabilitation when the course is complete.
No ankle swelling. Weight 54.0 kg, stable.`,
  },
  {
    id: "rec_seed_pt_0005_home",
    patientId: "pt_0005",
    title: "Community nursing home visit",
    source: "Community nursing",
    daysAgo: 1,
    hour: 15,
    text: `Home visit completed. Saturation 92% on 1 L/min at rest. Respiratory rate 20. Temperature 37.1 °C.
Appetite poor but drinking adequately. Sleeping in a recliner because lying flat feels uncomfortable.
No ankle swelling. Weight 54.0 kg. Prednisolone taper on track. Patient asked for written instructions about the oxygen wean.`,
  },
  {
    id: "rec_seed_pt_0006_operative",
    patientId: "pt_0006",
    title: "Operative note — laparoscopic appendectomy",
    source: "Hospital discharge",
    daysAgo: 8,
    text: `Laparoscopic appendectomy for acute appendicitis. Appendix was inflamed but not perforated. Procedure uncomplicated.
Discharged on day two with paracetamol 1 g up to four times daily as needed and written wound-care instructions.
Advice: keep the wounds dry for 48 hours, avoid lifting more than 5 kg for two weeks, and seek review for fever, spreading redness or purulent discharge.
No known drug allergies.`,
  },
  {
    id: "rec_seed_pt_0006_wound",
    patientId: "pt_0006",
    title: "Community nurse wound review",
    source: "Community nursing",
    daysAgo: 2,
    text: `Wound edges approximated. A one-centimetre area of mild erythema at the inferior port site, with no discharge and no induration.
Temperature 37.8 °C. Pain 4/10 on movement. Started amoxicillin-clavulanate 625 mg three times daily for five days.
Erythema marked with a pen and photographed for comparison. Review arranged in two days. Advised to seek urgent review if redness spreads, fever rises or pain worsens.`,
  },
  {
    id: "rec_seed_pt_0006_phone",
    patientId: "pt_0006",
    title: "Telephone follow-up — day 3 of antibiotics",
    source: "Telephone note",
    daysAgo: 1,
    hour: 11,
    text: `Temperature 37.2 °C, pain 2/10 at rest and 4/10 on movement. Erythema not spreading. No vomiting and appetite improving.
Taking amoxicillin-clavulanate as prescribed. Reports mild loose stools but is drinking well.
Continue the antibiotic course, keep the wound clean and dry, and attend the arranged wound review.`,
  },
  {
    id: "rec_seed_pt_0007_discharge",
    patientId: "pt_0007",
    title: "Discharge summary — left hip hemiarthroplasty",
    source: "Hospital discharge",
    daysAgo: 8,
    text: `Admitted after a mechanical fall at home. Left femoral neck fracture, treated with a left hemiarthroplasty under spinal anaesthesia. No postoperative dislocation or wound infection.
Post-operative haemoglobin 98 g/L, stable. Blood pressure 118/72 mmHg, heart rate 78 bpm in atrial fibrillation.
Medication on discharge: apixaban 5 mg twice daily continued, bisoprolol 2.5 mg daily, calcium and vitamin D, paracetamol as needed, lactulose for constipation. Codeine was avoided because it causes confusion and severe constipation.
Mobility: frame and one assistant. Falls advice given: sit on the edge of the bed for a minute before standing, use the call bell, and keep the walking frame within reach.
Follow-up: physiotherapy, district nurse wound check and fracture liaison service.`,
  },
  {
    id: "rec_seed_pt_0007_therapy",
    patientId: "pt_0007",
    title: "Physiotherapy and falls assessment",
    source: "Physiotherapy",
    daysAgo: 2,
    text: `Patient reports intermittent unsteadiness, particularly first thing in the morning and after sitting for a long time. No loss of consciousness and no fall since admission.
Lying blood pressure 126/74, standing at one minute 112/68 — a fall of 14 mmHg systolic with mild dizziness.
Mobilised 18 steps with a frame and one assistant. Right hip wound intact, dry and not tender.
Plan: continue supervised transfers, check postural blood pressure before morning mobilisation, ensure the call bell is in reach, and review sedating medicines. Apixaban increases bruising risk, so the room was cleared of trip hazards.`,
  },
  {
    id: "rec_seed_pt_0008_nephrology",
    patientId: "pt_0008",
    title: "Nephrology review — CKD stage 4",
    source: "Clinic letter",
    daysAgo: 18,
    text: `Creatinine 285 µmol/L, eGFR 21 mL/min/1.73m², potassium 5.4 mmol/L, bicarbonate 19 mmol/L. Urate 0.52 mmol/L.
Blood pressure 152/88 mmHg. Weight 82.0 kg with no peripheral oedema.
Metformin reduced to 500 mg once daily. Amlodipine continued. Sodium bicarbonate started for mild metabolic acidosis. Allopurinol remains at 100 mg daily because of renal impairment, with a plan to titrate slowly.
Discussed a low-potassium, renal-friendly diet and fluid advice. Strongly advised to avoid ibuprofen and other NSAIDs because of the previous acute kidney injury.
Repeat bloods in two weeks and review after the current gout flare.`,
  },
  {
    id: "rec_seed_pt_0008_gout",
    patientId: "pt_0008",
    title: "Telephone note — acute gout flare",
    source: "Telephone note",
    daysAgo: 3,
    text: `Right first metatarsophalangeal joint painful, swollen and red for two days. Unable to wear a shoe. No fever or shivering.
Colchicine 500 µg twice daily started for the flare, with a planned short course. Allopurinol continued rather than stopped. Ibuprofen must not be used because of CKD stage 4 and the previous NSAID-related kidney injury.
Advised rest, ice, elevation and adequate fluids within his renal fluid plan. Safety-netted for spreading redness, fever, confusion or reduced urine output. Nephrology informed.`,
  },
  {
    id: "rec_seed_pt_0009_maternity",
    patientId: "pt_0009",
    title: "Maternity discharge summary — pre-eclampsia",
    source: "Hospital discharge",
    daysAgo: 10,
    text: `Emergency caesarean section at 37 weeks for severe pre-eclampsia. A healthy baby was delivered; mother and baby both well.
Blood pressure remained elevated after delivery, so labetalol 200 mg twice daily was started. Postnatal enoxaparin 40 mg subcutaneously daily for six weeks because of increased thrombosis risk.
Urine protein:creatinine ratio 32 mg/mmol and haemoglobin 104 g/L on discharge.
Safety advice: seek urgent review for severe headache, visual flashes, epigastric or right-upper-quadrant pain, breathlessness, reduced urine output or a blood pressure above 160/110.
Follow-up: community midwife, GP blood-pressure review and a postnatal mental-health check. Breastfeeding is established and labetalol is considered compatible.`,
  },
  {
    id: "rec_seed_pt_0009_bp",
    patientId: "pt_0009",
    title: "Postnatal blood-pressure and wound log",
    source: "Patient-reported",
    daysAgo: 2,
    text: `Home blood pressure readings: 152/96 on day one, 146/94 on day two, 142/90 on day three and 138/88 on day four, each taken after five minutes seated with the cuff on the left arm.
Mild frontal headache on day two, settled with paracetamol and rest. No visual disturbance, no epigastric pain and no breathlessness.
Caesarean wound red at the right edge on day three; practice nurse reviewed, swab taken and oral antibiotics started. Wound now less tender with no discharge.
Sleeping in short blocks because of night feeds. Appetite improving and drinking well.`,
  },
  {
    id: "rec_seed_pt_0010_tia",
    patientId: "pt_0010",
    title: "Discharge summary — transient ischaemic attack",
    source: "Hospital discharge",
    daysAgo: 19,
    text: `Presented with sudden left-arm weakness and slurred speech that resolved within 40 minutes. CT brain showed no haemorrhage or acute infarct. Carotid imaging normal.
Known atrial fibrillation. CHA₂DS₂-VASc score 4, so anticoagulation was indicated. Warfarin started with a target INR of 2.0–3.0; the patient declined a direct oral anticoagulant because of cost.
Aspirin was avoided because of a previous wheeze and facial flushing reaction.
Medication: warfarin at 18:00, bisoprolol 5 mg daily, atorvastatin 40 mg at night and ramipril 5 mg daily.
Safety advice: report black stool, blood in urine, unusual bruising, severe headache or any new weakness or speech change.`,
  },
  {
    id: "rec_seed_pt_0010_inr",
    patientId: "pt_0010",
    title: "Anticoagulation clinic letter — INR review",
    source: "Clinic letter",
    daysAgo: 6,
    text: `INR 3.1, above the target range of 2.0–3.0. No bleeding reported. Warfarin reduced from 5 mg to 4 mg daily for three days, then 4 mg on alternate days with 5 mg on the other days; repeat INR in one week.
Current medicines reviewed: no new antibiotics, no NSAIDs and no herbal supplements. Alcohol intake modest.
The patient reports gum bleeding when brushing and a small forearm bruise after knocking his arm. Advised to use a soft toothbrush and report any black stool, blood in the urine or prolonged nosebleed.
Next INR check arranged. Target remains 2.0–3.0.`,
  },
  {
    id: "rec_seed_pt_0011_rheumatology",
    patientId: "pt_0011",
    title: "Rheumatology review — methotrexate monitoring",
    source: "Clinic letter",
    daysAgo: 25,
    text: `Seropositive rheumatoid arthritis with moderate disease activity. Morning stiffness about 45 minutes, symmetrical small-joint swelling and fatigue.
Bloods: CRP 28 mg/L, ESR 42 mm/h, haemoglobin 108 g/L, white cell count and liver enzymes within range. Renal function stable.
Methotrexate 15 mg once weekly continued, with folic acid 5 mg on a different day. Hydroxychloroquine and prednisolone 5 mg daily continued. Alendronic acid weekly for steroid-related osteoporosis.
Advised that methotrexate is immunosuppressive: report fever, cough, breathlessness or a sore throat promptly, and hold the weekly dose during a significant infection until reviewed. Avoid live vaccines.`,
  },
  {
    id: "rec_seed_pt_0011_triage",
    patientId: "pt_0011",
    title: "Telephone triage — cough and low-grade fever",
    source: "Telephone note",
    daysAgo: 2,
    text: `Two days of dry cough, fatigue and a temperature of 37.9 °C. No breathlessness at rest, no chest pain and no haemoptysis. Oxygen saturation 97% on room air.
On methotrexate 15 mg weekly, prednisolone 5 mg daily and hydroxychloroquine. The next methotrexate dose was withheld pending review.
Advised paracetamol, fluids and rest. Safety-netted for increasing breathlessness, fever above 38.5 °C, confusion or a productive cough with green sputum.
Rheumatology and the GP both informed. Same-day clinical review arranged because of immunosuppression.`,
  },
  {
    id: "rec_seed_pt_0012_diabetes",
    patientId: "pt_0012",
    title: "Paediatric diabetes discharge plan",
    source: "Hospital discharge",
    daysAgo: 9,
    text: `Eight-year-old boy admitted in diabetic ketoacidosis with glucose 28 mmol/L, blood ketones 4.2 mmol/L and pH 7.18. Treated with intravenous fluids and an insulin infusion, then transitioned to subcutaneous insulin.
Discharge regimen: insulin glargine 8 units at bedtime and insulin lispro 4 units with meals, adjusted for carbohydrate intake and correction doses. Glucagon 0.5 mg intramuscular for severe hypoglycaemia, with kits at home and at school.
Parent has been taught glucose and ketone monitoring, injection technique, sick-day rules and hypoglycaemia recognition. HbA1c at diagnosis was 11.2%.
School care plan agreed. Diabetes educator review in one week and paediatric clinic in four weeks.`,
  },
  {
    id: "rec_seed_pt_0012_home",
    patientId: "pt_0012",
    title: "Home glucose and ketone log",
    source: "Patient-reported",
    daysAgo: 2,
    text: `Bedtime blood glucose 14.2 mmol/L with blood ketones 0.8 mmol/L. Earlier readings: 11.6 before dinner and 9.8 at lunchtime.
No vomiting, abdominal pain or deep breathing. Drinking well and passing urine normally. Parent gave the correction dose according to the discharge plan and encouraged water.
Repeat glucose and ketones after two hours: glucose 11.4 mmol/L, ketones 0.4 mmol/L.
Message sent to the diabetes team. Parent advised to check ketones four-hourly while unwell and to seek urgent help for ketones above 1.5 mmol/L, vomiting, drowsiness or fast breathing.`,
  },
  {
    id: "rec_seed_pt_0013_stroke",
    patientId: "pt_0013",
    title: "Stroke unit discharge summary",
    source: "Hospital discharge",
    daysAgo: 8,
    text: `Left middle cerebral artery infarct presenting with right-sided weakness and mild expressive aphasia. Arrived outside the thrombolysis window; managed on the stroke unit with antiplatelet therapy and rehabilitation.
Known atrial fibrillation. Clopidogrel 75 mg daily started after imaging; atorvastatin 80 mg at night and metoprolol 25 mg twice daily continued.
Swallow assessment showed aspiration risk with thin fluids, so a soft diet and thickened fluids were recommended. NIHSS 4 at discharge.
Blood pressure 148/86 mmHg, heart rate 76 bpm, oxygen saturation 96% on room air.
Plan: continue physiotherapy, occupational therapy and speech therapy; repeat swallow assessment; screen for low mood; and review secondary prevention.`,
  },
  {
    id: "rec_seed_pt_0013_salt",
    patientId: "pt_0013",
    title: "Speech and language therapy note",
    source: "Speech and language therapy",
    daysAgo: 6,
    text: `Modified barium swallow showed delayed swallow trigger and mild aspiration with thin liquids. Recommended thickened fluids at level 2 and a soft, moist diet. No hard, crumbly or mixed-consistency foods.
Patient can follow one-step instructions and uses yes/no reliably. Expressive language is effortful but improving; word-finding difficulties remain.
Carer advised to sit the patient upright at 90 degrees, keep conversation quiet during meals and stop if coughing or a wet voice develops.
Review in one week and consider upgrading the diet if the repeat assessment is safe.`,
  },
  {
    id: "rec_seed_pt_0014_sepsis",
    patientId: "pt_0014",
    title: "Sepsis admission and discharge summary",
    source: "Hospital discharge",
    daysAgo: 6,
    text: `Admitted with fever 39.1 °C, confusion, hypotension 92/58 mmHg and a raised white cell count from a urinary source. Sepsis bundle completed within one hour: blood cultures, lactate, intravenous fluids and antibiotics.
Penicillin allergy documented as rash and lip swelling, so cefuroxime was used instead. Catheter replaced and urine sent for culture.
Renal function improved with fluids. Glucose remained between 8 and 11 mmol/L on reduced metformin.
Discharge plan: complete seven days of intravenous antibiotics through the hospital-at-home team, monitor temperature and urine output, continue tamsulosin, and arrange a trial without catheter after treatment.`,
  },
  {
    id: "rec_seed_pt_0014_catheter",
    patientId: "pt_0014",
    title: "Catheter care and observation plan",
    source: "Community nursing",
    daysAgo: 1,
    text: `Indwelling urinary catheter draining clear yellow urine, 40 mL/hour over the last four hours. No suprapubic pain, no leakage and the bag is below bladder level.
Temperature 36.9 °C, blood pressure 108/64 mmHg, heart rate 92 bpm, respiratory rate 18/min. White cell count down to 11.2 ×10⁹/L. Blood glucose 9.1 mmol/L.
Catheter care: wash daily with water, keep the bag off the floor, empty when two-thirds full and secure the tubing to prevent traction.
Safety advice: report fever, shivering, confusion, lower abdominal pain, reduced urine output or cloudy, offensive urine. Trial without catheter planned after the antibiotic course.`,
  },
  {
    id: "rec_seed_pt_0015_stent",
    patientId: "pt_0015",
    title: "Discharge summary — heart attack with a coronary stent",
    source: "Hospital discharge",
    daysAgo: 6,
    hour: 20,
    text: `Admitted with central chest pain and sweating. ECG showed an ST-elevation heart attack and the troponin rose from 890 to 310 ng/L over twelve hours. Emergency angiography found a blocked left anterior descending artery, treated with a drug-eluting stent within ninety minutes of arrival.
Discharge medicines: aspirin 75 mg once daily and ticagrelor 90 mg twice daily (dual antiplatelet therapy for twelve months — must not be stopped without cardiology advice), atorvastatin 80 mg at night, metoprolol 50 mg twice daily and ramipril 5 mg once daily. Metformin 500 mg twice daily continued for diabetes.
Echocardiogram: left ventricular ejection fraction 48%. Blood pressure 118/74 mmHg and heart rate 62 bpm on discharge.
Advice given: report chest pain, breathlessness, fainting or unusual bleeding and bruising. No heavy lifting for six weeks; attend cardiac rehabilitation.`,
  },
  {
    id: "rec_seed_pt_0015_rehab",
    patientId: "pt_0015",
    title: "Cardiac rehabilitation plan",
    source: "Cardiac rehabilitation",
    daysAgo: 3,
    hour: 11,
    text: `First rehabilitation session. Walked 400 metres without chest pain and stopped at a moderate level of effort.
Plan: build up to 30 minutes of walking most days, continue the home exercise sheet, and attend supervised sessions twice a week. Aim to stay completely off cigarettes, which he has done since the heart attack.
Medicines reviewed: no missed doses of aspirin or ticagrelor. Discussed that ticagrelor can cause easy bruising and that any bleeding should be reported.
Safety advice: stop and rest if chest pain, breathlessness or dizziness develops and call for help if it does not settle.`,
  },
  {
    id: "rec_seed_pt_0016_admission",
    patientId: "pt_0016",
    title: "Admission note — dengue fever with warning signs",
    source: "Hospital admission",
    daysAgo: 5,
    hour: 21,
    text: `Day 3 of fever with severe body aches, a red rash and a metallic taste. Dengue NS1 antigen positive. Platelet count 180 ×109/L and haematocrit 42% on admission.
Started oral fluids and paracetamol only. Ibuprofen, aspirin and other anti-inflammatory painkillers must be avoided because they increase the risk of bleeding.
Monitoring plan: platelet count, haematocrit and blood pressure twice daily, and strict attention to warning signs — abdominal pain, persistent vomiting, bleeding gums or nose, black stools, cold clammy skin or drowsiness.
Fluid balance charted and urine output maintained.`,
  },
  {
    id: "rec_seed_pt_0016_platelets",
    patientId: "pt_0016",
    title: "Daily platelet and haematocrit log",
    source: "Hospital monitoring",
    daysAgo: 1,
    hour: 8,
    text: `Platelet count falling: 180 ×109/L, then 95, then 42. Haematocrit rising: 42%, 46%, 48%. A rising haematocrit with a falling platelet count suggests plasma leakage and the critical phase of dengue.
Temperature 39.1 °C on day 3, 38.2 °C on day 4 and 37.4 °C today. Blood pressure 104/68 mmHg with a narrow pulse pressure.
Patient reported gum bleeding when brushing her teeth and mild abdominal pain. The doctor was informed; close observation continued, with intravenous fluids considered if the blood pressure falls or urine output drops.`,
  },
  {
    id: "rec_seed_pt_0017_start",
    patientId: "pt_0017",
    title: "Tuberculosis treatment initiation note",
    source: "Tuberculosis clinic",
    daysAgo: 62,
    hour: 10,
    text: `Sputum tested positive for tuberculosis and sensitive to all first-line drugs. Started on four medicines once daily: isoniazid 300 mg, rifampicin 600 mg, pyrazinamide 1500 mg and ethambutol 800 mg, with pyridoxine 25 mg to prevent nerve damage.
Baseline weight 48.0 kg and HbA1c 9.8%. Liver tests were normal before starting.
Counselled to take the tablets at the same time every day without missing doses, to avoid alcohol, and that rifampicin turns urine and tears orange. Warned that rifampicin reduces the effect of many other medicines, including some contraceptives.
Plan: monthly weight and liver tests, and a sputum check at two months.`,
  },
  {
    id: "rec_seed_pt_0017_review",
    patientId: "pt_0017",
    title: "Two-month tuberculosis review",
    source: "Tuberculosis clinic",
    daysAgo: 2,
    hour: 11,
    text: `Two months of treatment completed. Weight up from 48.0 kg to 52.0 kg. Sputum now negative for tuberculosis. ALT 41 U/L, a mild rise from a baseline of 28, with no jaundice or vomiting — continue treatment with monthly liver monitoring.
HbA1c improved to 8.4%, so the diabetes is helping rather than hindering recovery. Discussed continuing treatment to complete six months and the importance of not stopping early.
Report straight away: yellow eyes or skin, dark urine, vomiting, a rash or worsening breathlessness.`,
  },
  {
    id: "rec_seed_pt_0018_plan",
    patientId: "pt_0018",
    title: "Medical oncology plan — adjuvant chemotherapy",
    source: "Oncology",
    daysAgo: 40,
    hour: 9,
    text: `Breast cancer treated with surgery; now receiving adjuvant chemotherapy with epirubicin and cyclophosphamide every twenty-one days for six cycles. Currently on cycle 3.
Because chemotherapy lowers the white-cell count she is at risk of serious infection. Temperature should be checked twice daily, and a temperature of 38 °C or above, or feeling suddenly unwell, is an emergency — call straight away.
Anti-sickness medicine ondansetron 8 mg twice daily as needed. A filgrastim injection is given for five days after each cycle to help the white cells recover.
After chemotherapy, endocrine therapy (tamoxifen) will be discussed, with advice to report leg swelling, calf pain or unusual vaginal bleeding.`,
  },
  {
    id: "rec_seed_pt_0018_neutropenia",
    patientId: "pt_0018",
    title: "Day-10 post-chemotherapy telephone assessment",
    source: "Oncology day unit",
    daysAgo: 2,
    hour: 14,
    text: `Day 10 after cycle 3 — the point in the cycle when the white-cell count is lowest. White cell count 1.1 ×109/L and absolute neutrophil count 0.6 ×109/L (neutropenia). Haemoglobin 102 g/L.
Reports tiredness and a mild sore throat but no fever and no shivering. Temperature 37.2 °C.
Advice: check the temperature every four hours, avoid crowded places and people with infections, and treat a temperature of 38 °C or above, shivering, or feeling very unwell as an emergency needing immediate assessment.
Filgrastim course completed. Return to the day unit if any fever develops.`,
  },
  {
    id: "rec_seed_pt_0019_neuro",
    patientId: "pt_0019",
    title: "Neurology review — Parkinson's disease",
    source: "Neurology",
    daysAgo: 20,
    hour: 10,
    text: `Parkinson's disease with wearing-off: stiffness and slowness return before the next levodopa dose. Levodopa/carbidopa 100/25 mg is taken four times a day at 07:00, 11:00, 15:00 and 19:00 — the doses must be given on time and never delayed.
Amantadine 100 mg twice daily was added to smooth the response. Rasagiline 1 mg daily continued.
Metoclopramide and some other anti-sickness medicines must be avoided because they can worsen Parkinson's movements; domperidone is the preferred choice if an anti-sickness medicine is needed.
Discussed falls prevention and the importance of not stopping medicines suddenly.`,
  },
  {
    id: "rec_seed_pt_0019_swallow",
    patientId: "pt_0019",
    title: "Swallowing and falls assessment",
    source: "Therapy team",
    daysAgo: 3,
    hour: 13,
    text: `Swallow assessment showed a mildly delayed swallow with no aspiration, but meals take a long time. Recommended a soft, moist diet, sitting upright at ninety degrees, small mouthfuls and no talking while eating. Stop if coughing or a wet voice develops.
Blood pressure lying 138/82 mmHg, standing 106/66 mmHg — a drop on standing that explains the dizziness and the two near-falls at night.
Weight has fallen from 62.0 kg to 59.5 kg, likely from difficulty eating. Plan: dietician referral, a night light beside the bed, and to sit on the edge of the bed for a minute before standing.
The call bell will be kept within reach.`,
  },
  {
    id: "rec_seed_pt_0020_antenatal",
    patientId: "pt_0020",
    title: "Antenatal clinic note — gestational diabetes",
    source: "Antenatal clinic",
    daysAgo: 14,
    hour: 11,
    text: `Thirty weeks pregnant, first pregnancy. Glucose readings were above target on diet alone, so insulin was started: insulin aspart with meals adjusted by carbohydrate intake, and insulin detemir 10 units at bedtime.
Aspirin 75 mg once daily continues to reduce the risk of pre-eclampsia and was started after twelve weeks. Folic acid 5 mg and iron tablets continued.
Discussed the diabetes diet, regular meals, hand hygiene before injections and how to recognise and treat a low blood sugar. Blood pressure and urine protein to be checked at every visit.
Red flags to report immediately: severe headache, blurred vision, upper abdominal pain, swelling of the face or hands, or reduced baby movements.`,
  },
  {
    id: "rec_seed_pt_0020_glucose",
    patientId: "pt_0020",
    title: "Home glucose and blood-pressure log",
    source: "Patient-reported",
    daysAgo: 1,
    hour: 20,
    text: `Fasting glucose 4.8 mmol/L and glucose after breakfast 8.6 mmol/L — within the pregnancy targets. No low-sugar episodes.
Blood pressure 124/78 mmHg and urine protein negative at the last visit.
Baby moving normally every day. Weight 68.0 kg. No headache, no visual changes and no swelling of the hands or face.
Continuing insulin with meals and at bedtime, the diabetes diet, aspirin and iron. Asked about the plan for delivery and when to come to hospital.`,
  },
  {
    id: "rec_seed_pt_0021_wheeze",
    patientId: "pt_0021",
    title: "Paediatric assessment — wheeze and asthma action plan",
    source: "Paediatric clinic",
    daysAgo: 5,
    hour: 15,
    text: `Four-year-old with a wheezy episode after a cold. Oxygen saturation 94% on air, breathing rate 28 per minute and mild chest recession. Given salbutamol through a spacer with a good response, and a three-day course of prednisolone 20 mg once daily.
Diagnosis: childhood asthma with a viral trigger. Started a preventer inhaler (beclometasone 50 μg two puffs twice daily) and a reliever (salbutamol) to use with a spacer.
Also a known peanut allergy: the adrenaline auto-injector 0.15 mg must be available and used for any severe reaction with breathing difficulty or facial swelling.
Written action plan given. Dial 112 for breathing difficulty at rest, blue lips, drowsiness or a severe allergic reaction.`,
  },
  {
    id: "rec_seed_pt_0021_followup",
    patientId: "pt_0021",
    title: "Telephone follow-up — day 5 of steroids",
    source: "Paediatric follow-up",
    daysAgo: 1,
    hour: 16,
    text: `Wheeze improving. Oxygen saturation 97% on air, breathing rate 22 per minute and no chest recession. Sleeping through the night without coughing.
The prednisolone course is nearly finished; continue the preventer inhaler twice daily and use the spacer. The reliever was used twice in the last two days.
Parents are confident using the spacer and the action plan, and know to give the adrenaline auto-injector and call 112 for a severe allergic reaction.
Review in the paediatric clinic in four weeks if symptoms settle.`,
  },
  {
    id: "rec_seed_pt_0022_anaemia",
    patientId: "pt_0022",
    title: "Discharge summary — severe iron deficiency anaemia",
    source: "Hospital discharge",
    daysAgo: 10,
    hour: 12,
    text: `Admitted with breathlessness, tiredness and a fast heart rate. Haemoglobin 62 g/L, ferritin 4 ng/mL and a raised platelet count of 420 ×109/L — severe iron deficiency anaemia. Heavy periods and uterine fibroids are the likely source of the blood loss.
Given a single intravenous dose of ferric carboxymaltose 1000 mg, started on ferrous sulfate tablets and folic acid, and tranexamic acid 500 mg to take during heavy days of the period.
Advice: report breathlessness at rest, chest pain, palpitations or heavy bleeding. Repeat the blood count after treatment and attend the gynaecology clinic for the heavy periods.
A blood transfusion was not required as she stayed stable.`,
  },
  {
    id: "rec_seed_pt_0022_review",
    patientId: "pt_0022",
    title: "Follow-up note after intravenous iron",
    source: "Clinic",
    daysAgo: 1,
    hour: 10,
    text: `Feeling much better with far less breathlessness. Haemoglobin has risen from 62 g/L to 95 g/L and ferritin from 4 to 120 ng/mL after the intravenous iron. Heart rate now 82 bpm.
Continuing ferrous sulfate tablets, folic acid, and tranexamic acid during heavy days. No black stools and no heavy bleeding reported this cycle.
A gynaecology referral was sent to assess the fibroids and heavy periods, which are the underlying cause. Repeat the blood count in four weeks and report any return of breathlessness, chest pain or palpitations.`,
  },
];

async function run(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if ((process.env.CARE_SEED_DEMO ?? "").toLowerCase() === "false") return;

  const d = await getDriver();
  if (await d.getDoc(K.seed)) return;
  await d.setDoc(K.seed, { at: isoNow(), version: 1, status: "in-progress" });
  try {
    await seedContent(d);
    await d.setDoc(K.seed, { at: isoNow(), version: 1, status: "complete" });
  } catch (err) {
    // Allow a retry on the next request rather than leaving the guard behind.
    await d.del(K.seed).catch(() => undefined);
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedContent(d: any): Promise<void> {
  const nurse = { nurseId: "nurse_1", nurseName: process.env.CARE_NURSE_NAME || "Nurse Demo" };

  // --- one reviewed, escalated heart-failure check-in ----------------------
  const anita = SYNTHETIC_PATIENTS[0];
  const anitaStart = daysAgo(2, 10, 15);
  const anitaEntries: Array<Omit<CareTranscriptEntry, "id" | "sessionId" | "seq" | "at">> = [
    { role: "agent", text: "Hello Anita, this is your CareSpeak care assistant. How have you been feeling since our last check-in?" },
    { role: "patient", text: "I've been more tired this week and my ankles look a bit puffy." },
    { role: "agent", text: "Thank you for telling me. Have you noticed any weight gain, or do you need extra pillows to sleep at night?" },
    { role: "patient", text: "I gained about two kilos and I need an extra pillow at night." },
    { role: "agent", text: "I'm flagging that for your nurse today — fluid build-up can matter with heart failure. Please keep your feet up and weigh yourself each morning." },
  ];
  const anitaReport = await seedSession({
    patientId: anita.id,
    participantName: anita.displayName,
    nurse,
    startIso: anitaStart,
    durationMs: 9 * 60_000,
    escalated: true,
    escalation: "Patient reported rapid weight gain and ankle swelling with orthopnoea.",
    entries: anitaEntries,
    review: { by: nurse.nurseName, note: "Reviewed; GP informed about likely fluid overload." },
  });

  // --- one open (unreviewed) dizzy / near-fall check-in --------------------
  const lakshmi = SYNTHETIC_PATIENTS[2];
  const lakshmiStart = daysAgo(1, 9, 40);
  const lakshmiEntries: Array<Omit<CareTranscriptEntry, "id" | "sessionId" | "seq" | "at">> = [
    { role: "agent", text: "Hello Lakshmi, this is your CareSpeak care assistant. How have you been since we last spoke?" },
    { role: "patient", text: "I felt dizzy when I stood up this morning and I nearly fell in the bathroom." },
    { role: "agent", text: "I'm concerned about the dizziness and the near-fall. I am alerting your nurse now. If you feel unwell again, please sit down and call for help." },
  ];
  await seedSession({
    patientId: lakshmi.id,
    participantName: lakshmi.displayName,
    nurse,
    startIso: lakshmiStart,
    durationMs: 5 * 60_000,
    escalated: true,
    escalation: "Patient reported dizziness on standing and a near-fall.",
    entries: lakshmiEntries,
    review: null,
  });

  // --- follow-up work + messages -------------------------------------------
  const tasks: CareTask[] = [
    {
      id: newId("task"),
      patientId: anita.id,
      title: "Call Anita back about weight gain and ankle swelling",
      status: "open",
      createdAt: isoNow(),
      createdBy: nurse.nurseName,
    },
    {
      id: newId("task"),
      patientId: lakshmi.id,
      title: "Review dizziness and falls risk with the clinical team",
      status: "open",
      createdAt: isoNow(),
      createdBy: nurse.nurseName,
    },
  ];
  for (const t of tasks) await d.appendList(K.tasks, t, 2000);

  const messages: PatientMessage[] = [
    {
      id: newId("msg"),
      patientId: anita.id,
      patientName: anita.displayName,
      text: "Please weigh yourself every morning this week and note any ankle swelling. Your nurse will call you back today.",
      createdAt: isoNow(),
      createdBy: nurse.nurseName,
      channel: "web-voice-demo",
    },
    {
      id: newId("msg"),
      patientId: SYNTHETIC_PATIENTS[3].id,
      patientName: SYNTHETIC_PATIENTS[3].displayName,
      text: "Remember to use your reliever inhaler as prescribed and keep your peak-flow readings for our next call.",
      createdAt: isoNow(),
      createdBy: nurse.nurseName,
      channel: "web-voice-demo",
    },
  ];
  for (const m of messages) await d.appendList(K.messages, m, 2000);

  await d.appendList(
    K.audit,
    {
      id: newId("aud"),
      at: isoNow(),
      actorRole: "system",
      action: "care.demo_seeded",
      detail: { sessions: 2, reports: anitaReport ? 2 : 1, tasks: tasks.length, messages: messages.length },
    },
    5000
  );
}

// ---------------------------------------------------------------------------

async function seedSession(args: {
  patientId: string;
  participantName: string;
  nurse: { nurseId: string; nurseName: string };
  startIso: string;
  durationMs: number;
  escalated: boolean;
  escalation?: string;
  entries: Array<Omit<CareTranscriptEntry, "id" | "sessionId" | "seq" | "at">>;
  review: { by: string; note: string } | null;
}): Promise<CareReport | null> {
  const d = await getDriver();
  const start = Date.parse(args.startIso);
  const end = start + args.durationMs;

  const session: CareSession = {
    id: newId("wc"),
    mode: "web-voice-demo",
    patientId: args.patientId,
    nurseId: args.nurse.nurseId,
    nurseName: args.nurse.nurseName,
    status: "ended",
    createdAt: new Date(start).toISOString(),
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    durationMs: args.durationMs,
    joinTokenHash: hashToken(newToken()),
    joinCode: String(100000 + Math.floor(Math.random() * 900000)),
    joinExpiresAt: new Date(start + 30 * 60_000).toISOString(),
    joinedAt: new Date(start + 60_000).toISOString(),
    participantName: args.participantName,
    endReason: "nurse_ended",
    escalated: args.escalated,
    seq: 0,
  };

  let seq = 0;
  const transcript: CareTranscriptEntry[] = args.entries.map((e, i) => ({
    ...e,
    id: newId("tt"),
    sessionId: session.id,
    seq: ++seq,
    at: new Date(start + 60_000 + i * 45_000).toISOString(),
    engine: e.role === "agent" ? "rule-based-care-engine" : "patient device (Web Speech)",
  }));

  const events: CareEvent[] = [];
  const pushEvent = (type: CareEventType, actor: CareEvent["actor"], at: number, detail?: Record<string, unknown>) => {
    events.push({ seq: ++seq, at: new Date(at).toISOString(), type, actor, detail });
  };
  pushEvent("session.created", "nurse", start, { patientId: args.patientId, seeded: true });
  pushEvent("session.joined", "patient", start + 60_000, { name: args.participantName });
  if (args.escalated) pushEvent("escalation.created", "system", end - 90_000, { reason: args.escalation, seeded: true });
  pushEvent("session.ended", "nurse", end, { reason: "nurse_ended" });

  const patient = SYNTHETIC_PATIENTS.find((p) => p.id === args.patientId) ?? null;
  const report = buildReport({
    sessionId: session.id,
    patientId: args.patientId,
    patient,
    entries: transcript,
    durationMs: args.durationMs,
  });

  if (args.review) {
    report.status = "approved";
    report.reviewedAt = new Date(end + 20 * 60_000).toISOString();
    report.reviewedBy = args.review.by;
    report.reviewNote = args.review.note;
    report.sourceFlags.reviewed = true;
    pushEvent("report.generated", "agent", end + 60_000, { reportId: report.id, seeded: true });
    pushEvent("report.reviewed", "nurse", end + 20 * 60_000, { reportId: report.id, by: args.review.by });
  } else {
    pushEvent("report.generated", "agent", end + 60_000, { reportId: report.id, seeded: true });
  }

  session.reportId = report.id;
  session.seq = seq;

  await d.setDoc(K.session(session.id), session);
  const index = ((await d.getDoc(K.sessionIndex)) as string[] | null) ?? [];
  if (!index.includes(session.id)) index.push(session.id);
  await d.setDoc(K.sessionIndex, index.slice(-500));

  for (const e of events) await d.appendList(K.events(session.id), e, 2000);
  for (const t of transcript) await d.appendList(K.transcript(session.id), t, 4000);

  await d.setDoc(K.report(report.id), report);
  const reportIndex = ((await d.getDoc(K.reportIndex)) as string[] | null) ?? [];
  if (!reportIndex.includes(report.id)) reportIndex.push(report.id);
  await d.setDoc(K.reportIndex, reportIndex.slice(-1000));

  return report;
}

function daysAgo(n: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}