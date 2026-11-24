import { describe, expect, it } from "vitest";
import {
  getSeedPatient,
  SYNTHETIC_PATIENTS,
  SYNTHETIC_ADDITION_IDS,
} from "@/lib/care/seedPatients";
import { DEMO_RECORDS } from "@/lib/care/seedDemo";
import { buildChartQuestions, chartQuestionStrings } from "@/lib/care/demoQuestions";
import { buildPatientPassages, retrievePassages } from "@/lib/care/retrieval";

/** The scenarios added in this pass, each a "present-the-data" demo patient. */
const NEW_PATIENT_IDS = [
  "pt_0015",
  "pt_0016",
  "pt_0017",
  "pt_0018",
  "pt_0019",
  "pt_0020",
  "pt_0021",
  "pt_0022",
];

describe("expanded demo dataset", () => {
  it("adds eight new deep patients to the existing fourteen", () => {
    expect(SYNTHETIC_PATIENTS.length).toBeGreaterThanOrEqual(22);
    for (const id of NEW_PATIENT_IDS) {
      expect(getSeedPatient(id), id).toBeTruthy();
    }
  });

  it("flags every new patient for reconciliation into existing stores", () => {
    for (const id of NEW_PATIENT_IDS) {
      expect(SYNTHETIC_ADDITION_IDS.has(id), `${id} must be an addition id`).toBe(true);
    }
  });

  it("gives every new patient a full chart and at least two documents", () => {
    for (const id of NEW_PATIENT_IDS) {
      const p = getSeedPatient(id)!;
      expect(p.synthetic, id).toBe(true);
      expect(p.conditions.length, `${id} conditions`).toBeGreaterThanOrEqual(2);
      expect(p.medications.length, `${id} medications`).toBeGreaterThanOrEqual(2);
      expect(p.observations.length, `${id} observations`).toBeGreaterThanOrEqual(3);
      expect(p.encounters.length, `${id} encounters`).toBeGreaterThanOrEqual(2);
      expect(Boolean(p.carePlan), `${id} care plan`).toBe(true);
      expect(
        DEMO_RECORDS.filter((r) => r.patientId === id).length,
        `${id} seeded documents`
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the added record documents unique and well-formed", () => {
    const ids = DEMO_RECORDS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const patientIds = new Set(SYNTHETIC_PATIENTS.map((p) => p.id));
    for (const r of DEMO_RECORDS) {
      expect(patientIds.has(r.patientId), r.id).toBe(true);
      expect(r.text.trim().length, r.id).toBeGreaterThan(120);
    }
  });
});

describe("chart-grounded questions", () => {
  it("asks about every allergy, medicine, plan and the newest readings", () => {
    const sunita = getSeedPatient("pt_0018")!; // has a morphine allergy
    const questions = buildChartQuestions(sunita);
    expect(questions.length).toBeGreaterThan(4);
    expect(questions.some((q) => q.basis === "allergy")).toBe(true);
    expect(questions.some((q) => q.basis === "careplan")).toBe(true);
    expect(questions.some((q) => q.basis === "medications:summary")).toBe(true);
    expect(questions.some((q) => q.basis.startsWith("observation:"))).toBe(true);
    // Every question is unique.
    const texts = questions.map((q) => q.question);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("does not invent an allergy question when the chart records none", () => {
    const kavita = getSeedPatient("pt_0022")!; // no recorded allergies
    const questions = buildChartQuestions(kavita);
    expect(questions.some((q) => q.basis === "allergy")).toBe(false);
    expect(questions.length).toBeGreaterThan(3);
  });

  it("only bases questions on fields that exist in the chart", () => {
    for (const id of NEW_PATIENT_IDS) {
      const p = getSeedPatient(id)!;
      for (const q of buildChartQuestions(p)) {
        const [field, key] = q.basis.split(":");
        if (field === "observation") {
          expect(p.observations.some((o) => o.label === key), `${id} ${key}`).toBe(true);
        } else if (field === "condition") {
          expect(p.conditions.some((c) => c.name === key), `${id} ${key}`).toBe(true);
        } else if (field === "medication") {
          expect(p.medications.some((m) => m.name === key), `${id} ${key}`).toBe(true);
        }
      }
    }
  });

  it("names the patient and stays bounded", () => {
    const priya = getSeedPatient("pt_0016")!;
    const questions = chartQuestionStrings(priya, { recordTitles: ["Daily platelet and haematocrit log"] });
    expect(questions.length).toBeGreaterThan(4);
    // Every question names the patient except the document-summary one.
    expect(questions.filter((q) => q.includes("Priya")).length).toBeGreaterThan(3);
    expect(questions.some((q) => q.includes("Daily platelet"))).toBe(true);
  });

  it("produces a question the retrieval engine can actually ground", () => {
    const priya = getSeedPatient("pt_0016")!;
    const passages = buildPatientPassages(priya);
    const question = chartQuestionStrings(priya).find((q) => q.includes("Platelet"))!;
    expect(question).toBeTruthy();
    const result = retrievePassages(question, passages);
    expect(result.strong).toBe(true);
    expect(result.passages.some((p) => p.text.toLowerCase().includes("platelet"))).toBe(true);
  });

  it("grounds a fresh chart question for every new patient", () => {
    for (const id of NEW_PATIENT_IDS) {
      const p = getSeedPatient(id)!;
      const passages = buildPatientPassages(p);
      const question = chartQuestionStrings(p)[0];
      const result = retrievePassages(question, passages);
      expect(result.passages.length, `${id}: ${question}`).toBeGreaterThan(0);
    }
  });
});
