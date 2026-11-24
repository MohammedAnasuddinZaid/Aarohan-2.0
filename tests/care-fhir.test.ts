import { describe, expect, it } from "vitest";
import { buildFhirBundle, toFhirObservation, toFhirPatient } from "@/lib/care/fhir";
import { getSeedPatient } from "@/lib/care/seedPatients";
import type { PatientRecord } from "@/lib/care/types";

describe("FHIR R4 mapping (mapping only, not a server)", () => {
  const anita = getSeedPatient("pt_0001")!; // heart failure + furosemide + penicillin allergy
  const meera = getSeedPatient("pt_0005")!; // COPD + SpO2 + heart rate

  it("builds a collection Bundle with the expected resource types", () => {
    const bundle = buildFhirBundle(anita);
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    const types = new Set(bundle.entry.map((e) => e.resource.resourceType));
    for (const t of [
      "Patient",
      "Condition",
      "MedicationStatement",
      "AllergyIntolerance",
      "Observation",
      "Encounter",
    ]) {
      expect(types.has(t), `missing ${t}`).toBe(true);
    }
  });

  it("tags synthetic patients so they can never be read as real", () => {
    const patient = toFhirPatient(anita) as { meta?: { tag?: Array<{ code?: string }> } };
    expect(patient.meta?.tag?.some((t) => t.code === "synthetic")).toBe(true);
  });

  it("maps a medication with its dose and route text", () => {
    const bundle = buildFhirBundle(anita);
    const meds = bundle.entry.filter((e) => e.resource.resourceType === "MedicationStatement");
    const furosemide = meds.find((m) =>
      JSON.stringify(m.resource.medicationCodeableConcept).toLowerCase().includes("furosemide")
    );
    expect(furosemide).toBeTruthy();
    expect(JSON.stringify(furosemide!.resource)).toContain("40 mg");
  });

  it("attaches a well-known LOINC code to a heart-rate observation", () => {
    const hr = meera.observations.find((o) => o.label.toLowerCase() === "heart rate")!;
    const obs = toFhirObservation(meera, hr) as {
      code: { text: string; coding?: Array<{ system?: string; code?: string }> };
    };
    expect(obs.code.text).toBe("Heart rate");
    expect(obs.code.coding?.[0]).toMatchObject({ system: "http://loinc.org", code: "8867-4" });
  });

  it("does not fabricate a code for an observation it does not know", () => {
    const obs = toFhirObservation(meera, {
      id: "x",
      label: "Some unlisted measure",
      value: 5,
      unit: "u",
      at: new Date().toISOString(),
      provenance: "record",
    }) as { code: { coding?: unknown } };
    expect(obs.code.coding).toBeUndefined();
  });

  it("preserves observation provenance in a namespaced extension", () => {
    const aiObs = toFhirObservation(meera, {
      id: "ai1",
      label: "Heart rate",
      value: 150,
      at: new Date().toISOString(),
      provenance: "ai",
    });
    expect(JSON.stringify(aiObs)).toContain("reading-provenance");
    expect(JSON.stringify(aiObs)).toContain('"valueString":"ai"');
  });

  it("every entry has a FHIR-valid id and a matching fullUrl", () => {
    const bundle = buildFhirBundle(anita);
    // FHIR id: [A-Za-z0-9\-\.]{1,64} — underscores are invalid.
    const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;
    for (const { fullUrl, resource } of bundle.entry) {
      expect(typeof resource.id, `${resource.resourceType} has no id`).toBe("string");
      expect(FHIR_ID.test(resource.id as string), `invalid id ${String(resource.id)}`).toBe(true);
      expect(fullUrl).toBe(`${resource.resourceType}/${resource.id}`);
    }
  });

  it("codes pulse-oximetry SpO2 with 59408-5, not the blood-gas code", () => {
    const spo2 = meera.observations.find((o) => o.label.includes("SpO"))!;
    const obs = toFhirObservation(meera, spo2) as {
      code: { coding?: Array<{ code?: string }> };
    };
    expect(obs.code.coding?.[0]?.code).toBe("59408-5");
  });

  it("maps a seeded systolic reading (label 'Systolic BP') to LOINC 8480-6", () => {
    const vikram = getSeedPatient("pt_0002")!;
    const sys = vikram.observations.find((o) => o.label === "Systolic BP")!;
    const obs = toFhirObservation(vikram, sys) as { code: { coding?: Array<{ code?: string }> } };
    expect(obs.code.coding?.[0]?.code).toBe("8480-6");
  });

  it("tags every derived resource of a synthetic patient, not just the Patient", () => {
    const bundle = buildFhirBundle(anita);
    for (const { resource } of bundle.entry) {
      const meta = resource.meta as { tag?: Array<{ code?: string }> } | undefined;
      expect(
        meta?.tag?.some((t) => t.code === "synthetic"),
        `${resource.resourceType} is missing the synthetic tag`
      ).toBe(true);
    }
  });

  it("references use the sanitized patient id", () => {
    const bundle = buildFhirBundle(anita);
    const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")!;
    const condition = bundle.entry.find((e) => e.resource.resourceType === "Condition")!;
    const subject = condition.resource.subject as { reference?: string };
    expect(subject.reference).toBe(`Patient/${patient.resource.id}`);
    expect(patient.resource.id).not.toContain("_");
  });

  it("turns free-text records into DocumentReference stubs", () => {
    const record: PatientRecord = {
      id: "rec1",
      patientId: anita.id,
      title: "Discharge summary",
      source: "Transfer note",
      text: "Patient discharged on a diuretic.",
      chars: 36,
      createdAt: new Date().toISOString(),
      synthetic: true,
    };
    const bundle = buildFhirBundle(anita, [record]);
    const doc = bundle.entry.find((e) => e.resource.resourceType === "DocumentReference");
    expect(doc).toBeTruthy();
    expect(JSON.stringify(doc!.resource)).toContain("Discharge summary");
  });
});
