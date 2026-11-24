/**
 * FHIR R4 mapping for CareSpeak charts — MAPPING ONLY.
 *
 * This module converts the app's `ClinicalPatient` (and optional free-text
 * records) into a FHIR R4 `Bundle` of `collection` type. It is a pure, offline
 * transform: it does NOT run a FHIR server, does NOT call HAPI/Medplum, and
 * does NOT imply any clinical integration. Its purpose is to (a) give a single
 * place where the chart shape and the FHIR shape are reconciled, and (b) make
 * that reconciliation testable.
 *
 * HONESTY NOTES
 * - The seeded charts are synthetic (`ClinicalPatient.synthetic`). Every derived
 *   resource carries a `https://carespeak.app/data-provenance` tag so a
 *   synthetic record can never be read as a real one.
 * - Only codes we are confident about are attached (heart rate, temperature,
 *   pulse-oximetry SpO2, weight, respiratory rate, systolic/diastolic BP).
 *   Every other observation and every free-text field carries `code.text` /
 *   a namespaced extension, with no fabricated coding. See
 *   `research/HEALTHCARE_INTEROPERABILITY.md`.
 */
import type { ClinicalPatient, PatientRecord } from "./types";

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}
export interface FhirCodeableConcept {
  text?: string;
  coding?: FhirCoding[];
}
export interface FhirReference {
  reference?: string;
  display?: string;
}
export interface FhirExtension {
  url: string;
  valueString?: string;
  valueInteger?: number;
}
export interface FhirBundleEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}
export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  entry: FhirBundleEntry[];
}

const LOINC = "http://loinc.org";
const CS_EXT = "https://carespeak.app/fhir/StructureDefinition";
const CS_PROVENANCE = "https://carespeak.app/data-provenance";

/**
 * A FHIR `id` must match `[A-Za-z0-9\-\.]{1,64}` — underscores and other
 * characters are invalid. Seed ids look like `pt_0001`, so ids are always run
 * through this before they are emitted.
 */
function fid(...parts: Array<string | number>): string {
  return parts
    .map((p) => String(p))
    .join("-")
    .replace(/[^A-Za-z0-9\-.]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

/**
 * Only the codes we are confident about; anything else stays text-only.
 * Keys are the lowercased observation labels actually present in the seed data.
 * SpO2 uses 59408-5 ("Oxygen saturation in Arterial blood by Pulse oximetry"),
 * not 2708-6, which describes a blood-gas measurement.
 */
const LOINC_BY_LABEL: Record<string, { code: string; display: string }> = {
  "heart rate": { code: "8867-4", display: "Heart rate" },
  pulse: { code: "8867-4", display: "Heart rate" },
  temperature: { code: "8310-5", display: "Body temperature" },
  "oxygen saturation": { code: "59408-5", display: "Oxygen saturation by pulse oximetry" },
  "spo2 on 1 l oxygen": { code: "59408-5", display: "Oxygen saturation by pulse oximetry" },
  "spo2 after walking (2 l oxygen)": {
    code: "59408-5",
    display: "Oxygen saturation by pulse oximetry",
  },
  weight: { code: "29463-7", display: "Body weight" },
  "respiratory rate": { code: "9279-1", display: "Respiratory rate" },
  "systolic bp": { code: "8480-6", display: "Systolic blood pressure" },
  "diastolic bp": { code: "8462-4", display: "Diastolic blood pressure" },
};

const STATUS_MAP: Record<string, string> = {
  active: "active",
  resolved: "resolved",
  // A "history" entry is not an active problem; FHIR's nearest term is inactive.
  history: "inactive",
};

function ext(name: string, value: string | number): FhirExtension {
  return typeof value === "number"
    ? { url: `${CS_EXT}/${name}`, valueInteger: value }
    : { url: `${CS_EXT}/${name}`, valueString: value };
}

function codingForLabel(label: string): FhirCoding[] | undefined {
  const hit = LOINC_BY_LABEL[normalizeLabel(label)];
  return hit ? [{ system: LOINC, code: hit.code, display: hit.display }] : undefined;
}

/**
 * Chart labels are written by humans and mix Unicode: the seed data uses
 * "SpO₂" (U+2082 SUBSCRIPT TWO), an import might use "SpO2". Normalise
 * subscript digits to ASCII, lowercase and collapse whitespace so one key
 * matches both.
 */
function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\u2080-\u2089]/g, (c) => String(c.codePointAt(0)! - 0x2080))
    .replace(/\s+/g, " ");
}

function syntheticTag(patient: ClinicalPatient): Array<Record<string, unknown>> {
  if (!patient.synthetic) return [];
  return [
    {
      system: CS_PROVENANCE,
      code: "synthetic",
      display: "Synthetic demo data — not a real patient",
    },
  ];
}

/** Attaches the synthetic tag (when applicable) to any derived resource. */
function withMeta(
  patient: ClinicalPatient,
  resource: Record<string, unknown>
): Record<string, unknown> {
  const tag = syntheticTag(patient);
  if (tag.length === 0) return resource;
  const existing = (resource.meta as Record<string, unknown> | undefined) ?? {};
  return { ...resource, meta: { ...existing, tag } };
}

export function toFhirPatient(patient: ClinicalPatient): Record<string, unknown> {
  const nameParts = patient.displayName.trim().split(/\s+/);
  const extensions: FhirExtension[] = [];
  if (patient.age != null) extensions.push(ext("chart-age-years", patient.age));
  if (patient.room) extensions.push(ext("chart-room", patient.room));
  if (patient.primaryConcern) extensions.push(ext("chart-primary-concern", patient.primaryConcern));

  return withMeta(patient, {
    resourceType: "Patient",
    id: fid(patient.id),
    active: true,
    identifier: [{ system: "https://carespeak.app/patient-extension", value: patient.extension }],
    name: [
      {
        text: patient.displayName,
        family: nameParts.length > 1 ? nameParts.slice(-1)[0] : undefined,
        given: nameParts.length > 1 ? nameParts.slice(0, -1) : nameParts,
      },
    ],
    ...(patient.sex ? { gender: patient.sex } : {}),
    ...(patient.language
      ? { communication: [{ language: { text: patient.language }, preferred: true }] }
      : {}),
    ...(extensions.length ? { extension: extensions } : {}),
  });
}

export function toFhirCondition(
  patient: ClinicalPatient,
  c: ClinicalPatient["conditions"][number]
): Record<string, unknown> {
  return withMeta(patient, {
    resourceType: "Condition",
    id: fid(patient.id, c.id),
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    code: {
      text: c.name,
      ...(c.code
        ? { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: c.code, display: c.name }] }
        : {}),
    },
    clinicalStatus: { coding: [{ code: STATUS_MAP[c.status] ?? "active" }] },
    ...(c.since ? { onsetDateTime: c.since } : {}),
    ...(c.note ? { note: [{ text: c.note }] } : {}),
  });
}

export function toFhirMedicationStatement(
  patient: ClinicalPatient,
  m: ClinicalPatient["medications"][number]
): Record<string, unknown> {
  return withMeta(patient, {
    resourceType: "MedicationStatement",
    id: fid(patient.id, m.id),
    status: m.status === "stopped" ? "stopped" : "active",
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    medicationCodeableConcept: { text: [m.name, m.dose].filter(Boolean).join(" ") },
    ...(m.dose || m.route || m.frequency
      ? { dosage: [{ text: [m.dose, m.route, m.frequency].filter(Boolean).join(", ") }] }
      : {}),
    ...(m.since ? { effectiveDateTime: m.since } : {}),
    ...(m.note ? { note: [{ text: m.note }] } : {}),
  });
}

export function toFhirAllergyIntolerance(
  patient: ClinicalPatient,
  a: ClinicalPatient["allergies"][number]
): Record<string, unknown> {
  return withMeta(patient, {
    resourceType: "AllergyIntolerance",
    id: fid(patient.id, a.id),
    patient: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    code: { text: a.substance },
    ...(a.reaction ? { reaction: [{ manifestation: [{ text: a.reaction }] }] } : {}),
    // criticality describes the potential for serious harm, which is not the
    // same as reaction severity. We approximate it from `severity` here and flag
    // that as a review item in research/HEALTHCARE_INTEROPERABILITY.md.
    criticality:
      a.severity === "severe" ? "high" : a.severity === "moderate" ? "low" : "unable-to-assess",
  });
}

export function toFhirObservation(
  patient: ClinicalPatient,
  o: ClinicalPatient["observations"][number]
): Record<string, unknown> {
  const codings = codingForLabel(o.label);
  const numeric = typeof o.value === "number";
  const extensions: FhirExtension[] = [];
  // Provenance is preserved so an AI/patient-supplied reading is never
  // presented as a clinician-recorded one.
  if (o.provenance) extensions.push(ext("reading-provenance", o.provenance));

  return withMeta(patient, {
    resourceType: "Observation",
    id: fid(patient.id, o.id),
    status: "final",
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    code: { text: o.label, ...(codings ? { coding: codings } : {}) },
    ...(o.at ? { effectiveDateTime: o.at } : {}),
    ...(numeric
      ? { valueQuantity: { value: o.value, unit: o.unit } }
      : { valueString: [o.value, o.unit].filter(Boolean).join(" ") }),
    ...(extensions.length ? { extension: extensions } : {}),
  });
}

export function toFhirEncounter(
  patient: ClinicalPatient,
  e: ClinicalPatient["encounters"][number]
): Record<string, unknown> {
  const extensions: FhirExtension[] = [];
  if (e.summary) extensions.push(ext("encounter-summary", e.summary));
  if (e.kind) extensions.push(ext("encounter-kind", e.kind));
  return withMeta(patient, {
    resourceType: "Encounter",
    id: fid(patient.id, e.id),
    status: "finished",
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    ...(e.at ? { period: { start: e.at } } : {}),
    ...(e.by ? { participant: [{ individual: { display: e.by } }] } : {}),
    ...(extensions.length ? { extension: extensions } : {}),
  });
}

export function toFhirCarePlan(patient: ClinicalPatient): Record<string, unknown> | null {
  if (!patient.carePlan) return null;
  return withMeta(patient, {
    resourceType: "CarePlan",
    id: fid(patient.id, "careplan"),
    status: "active",
    // `intent` is required for a meaningful CarePlan; "plan" is the general case.
    intent: "plan",
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    description: patient.carePlan,
  });
}

/**
 * Free-text records become `DocumentReference` stubs. `content` is required by
 * FHIR, so it carries a content-type only — the record text itself stays in the
 * app and is deliberately NOT copied into the bundle (no extra PHI surface).
 */
export function toFhirDocumentReference(
  patient: ClinicalPatient,
  record: PatientRecord
): Record<string, unknown> {
  return withMeta(patient, {
    resourceType: "DocumentReference",
    id: fid(patient.id, "doc", record.id),
    status: "current",
    subject: { reference: `Patient/${fid(patient.id)}`, display: patient.displayName },
    ...(record.source ? { type: { text: record.source } } : {}),
    description: record.title,
    content: [{ attachment: { contentType: "text/plain", title: record.title } }],
    ...(record.createdAt ? { date: record.createdAt } : {}),
  });
}

export function buildFhirBundle(
  patient: ClinicalPatient,
  records: PatientRecord[] = []
): FhirBundle {
  const resources: Array<Record<string, unknown>> = [
    toFhirPatient(patient),
    ...patient.conditions.map((c) => toFhirCondition(patient, c)),
    ...patient.medications.map((m) => toFhirMedicationStatement(patient, m)),
    ...patient.allergies.map((a) => toFhirAllergyIntolerance(patient, a)),
    ...patient.observations.map((o) => toFhirObservation(patient, o)),
    ...patient.encounters.map((e) => toFhirEncounter(patient, e)),
  ];
  const carePlan = toFhirCarePlan(patient);
  if (carePlan) resources.push(carePlan);
  for (const r of records) resources.push(toFhirDocumentReference(patient, r));

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => ({
      fullUrl: `${resource.resourceType}/${String(resource.id)}`,
      resource,
    })),
  };
}
