"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { HeartPulse, Activity, Wifi, Battery, Clock, AlertTriangle } from "lucide-react";
import { DeviceVitals } from "@/types";

interface Esp32VitalsCardProps {
  vitals: DeviceVitals | null;
  deviceName?: string;
}

export default function Esp32VitalsCard({ vitals, deviceName = "ESP32 Wearable" }: Esp32VitalsCardProps) {
  const stale = vitals ? Date.now() - vitals.receivedAt > 30000 : true;
  const online = !!vitals && !stale;
  // The wearable reports contact explicitly. Never show a reading after the
  // finger is lifted, and never show values while the device is offline.
  const fingerOn = vitals
    ? vitals.finger === true ||
      (vitals.finger !== false && (vitals.heartRate != null || vitals.spo2 != null))
    : false;
  const liveFinger = online && fingerOn;
  const hr = liveFinger ? vitals?.heartRate : undefined;
  const spo2 = liveFinger ? vitals?.spo2 : undefined;

  const rssiQuality = (rssi: number | undefined) => {
    if (rssi == null) return { label: "—", color: "text-[#9ca3af]" };
    if (rssi > -50) return { label: "Excellent", color: "text-[#22a67e]" };
    if (rssi > -65) return { label: "Good", color: "text-[#22a67e]" };
    if (rssi > -75) return { label: "Fair", color: "text-[#e8993e]" };
    return { label: "Weak", color: "text-[#d94a4a]" };
  };

  const rssi = rssiQuality(vitals?.rssi);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#1f1f1f] flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-[#c63a22]" />
          ESP32 Wearable Vitals
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              online ? "bg-[#22a67e] animate-pulse" : "bg-[#d94a4a]"
            }`}
          />
          <span className={`text-[10px] font-medium ${online ? "text-[#22a67e]" : "text-[#d94a4a]"}`}>
            {online ? "LIVE" : vitals ? "OFFLINE" : "WAITING"}
          </span>
        </div>
      </div>

      {!vitals ? (
        <div className="flex items-center justify-center h-32 text-[#6e6e6e] text-sm">
          Waiting for ESP32 data...
        </div>
      ) : (
        <>
          {/* Main vitals grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`rounded-xl p-4 text-center ${hr != null ? "bg-[#fef2f2]" : "bg-[#f5f5f5]"}`}>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1">Heart Rate</p>
              <p className={`text-3xl font-extrabold ${hr != null ? "text-[#d94a4a]" : "text-[#9ca3af]"}`}>
                {hr != null ? Math.round(hr) : "—"}
              </p>
              <p className="text-[10px] text-[#9ca3af] mt-1">BPM</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${spo2 != null ? "bg-[#eff6ff]" : "bg-[#f5f5f5]"}`}>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1">SpO₂</p>
              <p className={`text-3xl font-extrabold ${spo2 != null ? "text-[#3b82f6]" : "text-[#9ca3af]"}`}>
                {spo2 != null ? Math.round(spo2) : "—"}
              </p>
              <p className="text-[10px] text-[#9ca3af] mt-1">%</p>
            </div>
          </div>

          {/* Secondary info */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg bg-[#f9f7f5] p-2 text-center">
              <Wifi className={`w-3.5 h-3.5 mx-auto mb-1 ${rssi.color}`} />
              <p className={`text-xs font-bold ${rssi.color}`}>{vitals.rssi ?? "—"}</p>
              <p className="text-[9px] text-[#9ca3af]">{rssi.label}</p>
            </div>
            <div className="rounded-lg bg-[#f9f7f5] p-2 text-center">
              <Battery className="w-3.5 h-3.5 mx-auto mb-1 text-[#22a67e]" />
              <p className="text-xs font-bold text-[#22a67e]">
                {vitals.batteryPct != null ? `${Math.round(vitals.batteryPct)}%` : "—"}
              </p>
              <p className="text-[9px] text-[#9ca3af]">Battery</p>
            </div>
            <div className="rounded-lg bg-[#f9f7f5] p-2 text-center">
              <Clock className="w-3.5 h-3.5 mx-auto mb-1 text-[#e8993e]" />
              <p className="text-xs font-bold text-[#e8993e]">
                {new Date(vitals.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              <p className="text-[9px] text-[#9ca3af]">Last update</p>
            </div>
          </div>

          {/* Status line */}
          <div className="flex items-center justify-between text-[10px] text-[#9ca3af]">
            <span>{vitals.deviceId}</span>
            <span>
              {stale
                ? "⚠ No data for " + Math.round((Date.now() - vitals.receivedAt) / 1000) + "s"
                : liveFinger
                ? "Finger detected"
                : "No finger — place on sensor"}
            </span>
          </div>

          {!liveFinger && online && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="mt-3 p-2 rounded-lg bg-[#fffbeb] border border-[#fde68a] flex items-center gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#e8993e] shrink-0" />
              <span className="text-xs text-[#e8993e]">
                Place finger on the MAX30102 sensor (black window side) and hold still
              </span>
            </motion.div>
          )}
        </>
      )}
    </motion.div>
  );
}
