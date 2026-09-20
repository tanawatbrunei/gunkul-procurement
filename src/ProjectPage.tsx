import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, setDoc, arrayUnion,
} from "firebase/firestore";
import { db } from "./firebase";
import * as XLSX from "xlsx";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  IconBuildingFactory2, IconSearch, IconPlus, IconPencil, IconTrash, IconX, IconFileSpreadsheet,
} from "@tabler/icons-react";
import { Reveal, Section } from "./components/PageKit";
import ProjectFarm from "./components/ProjectFarm";

function formatNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v);
}

export const CONTRACT_TYPE_OPTIONS = ["EPC", "PPA", "PEAESCO", "-"] as const;
export type ContractType = (typeof CONTRACT_TYPE_OPTIONS)[number];

export const ROOF_TYPE_OPTIONS = [
  "Rooftop", "Carport", "Farm", "Floating", "Reinforcement", "Reroof", "Civil", "อื่นๆ",
] as const;

export const STATUS_OPTIONS = [
  "ไม่ระบุ", "Awarded", "Kick Off แล้ว", "ยังไม่ Kick Off", "Bidding Subcon", "อื่นๆ",
] as const;
export type ProjectStatus = (typeof STATUS_OPTIONS)[number];

export const COLOR_STATUS_OPTIONS = ["Done", "Cancelled", "Hold", "On going"] as const;
export type ColorStatus = (typeof COLOR_STATUS_OPTIONS)[number];

export const COLOR_STATUS_HEX: Record<ColorStatus, string> = {
  Done: "#3fa34d",
  Cancelled: "#d64545",
  Hold: "#3a8fd6",
  "On going": "#9aa3ad",
};

export const TOC_OPTIONS = ["Not yet", "WIP", "Done"] as const;
export type TocStatus = (typeof TOC_OPTIONS)[number];

/* Canonical brand lists used for new entries; existing free-text values entered before
   this list existed are normalized for chart grouping via BRAND_NORMALIZE below. */
export const PV_BRAND_BASE = [
  "JA Solar", "Jinko", "Longi", "Trina", "AKCOM", "Aiko", "Huasun", "Rizen", "Sharp", "JA Solar & Trina", "-",
];
export const INVERTER_BRAND_BASE = ["Huawei", "ABB", "SMA", "SolarEdge", "Sungrow", "-"];
export const BESS_BRAND_BASE = ["Huawei", "Sungrow", "-"];

export type CustomOptionKey = "pv" | "inverter" | "bess" | "powerClass" | "inverterModel" | "optimizer" | "bessSize" | "om";

export const POWER_CLASS_BASE = ["540W", "545W", "550W", "555", "580", "610", "620", "630", "640", "710", "715", "720"];
export const INVERTER_MODEL_BASE = ["50KTL", "100KTL", "100K", "150KTL", "SE90K", "SE100K", "330KTL"];
export const OPTIMIZER_BASE = ["P1300", "P1100", "S1400", "S1200", "-"];
export const BESS_SIZE_BASE = ["241", "257"];
export const OM_BASE = ["4 ปี ปีละ 3 ครั้ง"];

const PV_BRAND_NORMALIZE: Record<string, string> = {
  "JA": "JA Solar", "JA SOLAR": "JA Solar", "JA Solar": "JA Solar",
  "JINKO": "Jinko", "Jinko": "Jinko",
  "JA & Trina": "JA Solar & Trina",
  "Aiko \n(Light Weight)": "Aiko", "Aiko": "Aiko",
};
const INVERTER_BRAND_NORMALIZE: Record<string, string> = {
  "Huawei": "Huawei", "HUawei": "Huawei",
  "Solar EDGE": "SolarEdge", "Solar Edge": "SolarEdge", "SolarEDGE": "SolarEdge", "SolarEdge": "SolarEdge",
};
export const normalizePvBrand = (brand: string) => PV_BRAND_NORMALIZE[brand] ?? brand;
export const normalizeInverterBrand = (brand: string) => INVERTER_BRAND_NORMALIZE[brand] ?? brand;

export interface ProjectPhase {
  name: string;
  roofType: string;
  capacityKwp: number | null;
  meterCount: number | null;
  location: string;
  contractPrice: number | string | null;
  subconAwardAmount: number | string | null;
  subconName: string;
  pvBrand: string;
  powerClass: string;
  inverterBrand: string;
  inverterModel: string;
  kickoffDate: string;
}

export interface ProjectSeed {
  jobNo: number | null;
  name: string;
  roofType: string;
  contractType: ContractType;
  capacityKwp: number | null;
  roofCount: number | null;
  meterCount: number | null;
  connectionPoint: string;
  safetyLevel: string;
  workmanship: string;
  counterparty: string;
  location: string;
  contractPrice: number | string | null;
  subconAwardAmount: number | string | null;
  materialThbWatt: number | null;
  labourThbWatt: number | null;
  subconName: string;
  awardDate: string;
  pvBrand: string;
  powerClass: string;
  inverterBrand: string;
  inverterModel: string;
  optimizer: string;
  bessBrand: string;
  bessSize: string;
  om: string;
  kickoffDate: string;
  puPic: string;
  pmPic: string;
  engPic: string;
  status: ProjectStatus;
  colorStatus: ColorStatus;
  toc: TocStatus;
  boi: string;
  note: string;
  estimateSiteMob: string;
  forecastSiteMob1: string;
  forecastSiteMob2: string;
  phases: ProjectPhase[];
}

export interface Project extends ProjectSeed {
  id: string;
}

const EMPTY_PHASE: ProjectPhase = {
  name: "", roofType: "Rooftop", capacityKwp: null, meterCount: null, location: "",
  contractPrice: null, subconAwardAmount: null, subconName: "", pvBrand: "",
  powerClass: "", inverterBrand: "", inverterModel: "", kickoffDate: "",
};

const EMPTY_PROJECT: ProjectSeed = {
  jobNo: null, name: "", roofType: "Rooftop", contractType: "EPC", capacityKwp: null,
  roofCount: null, meterCount: null, connectionPoint: "", safetyLevel: "", workmanship: "",
  counterparty: "", location: "", contractPrice: null, subconAwardAmount: null,
  materialThbWatt: null, labourThbWatt: null, subconName: "", awardDate: "", pvBrand: "",
  powerClass: "", inverterBrand: "", inverterModel: "", optimizer: "", bessBrand: "",
  bessSize: "", om: "", kickoffDate: "", puPic: "", pmPic: "", engPic: "", status: "ไม่ระบุ",
  colorStatus: "On going", toc: "Not yet", boi: "", note: "", estimateSiteMob: "", forecastSiteMob1: "",
  forecastSiteMob2: "", phases: [],
};

const SOFT_PALETTE = ["#7CA6D8", "#8FCBAE", "#F2B6A0", "#D6B8E0", "#F4D58D", "#9AD0D6", "#C9B7A0", "#A8B8D8"];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      padding: "var(--sp-4)", transition: "box-shadow 0.2s ease, transform 0.2s ease",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <h4 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{title}</h4>
      {children}
    </div>
  );
}

// Percentage drawn INSIDE each donut slice — category names live in the legend
// below, so labels never overflow the card and get clipped. Very thin slices
// (<5%) are left unlabelled to avoid cramped text.
const PIE_LABEL = (e: {
  cx?: number; cy?: number; midAngle?: number;
  innerRadius?: number; outerRadius?: number; percent?: number;
}) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = e;
  if (cx == null || cy == null || midAngle == null || innerRadius == null
    || outerRadius == null || !percent || percent < 0.05) return null;
  const RAD = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) / 2;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={700}
      textAnchor="middle" dominantBaseline="central">
      {Math.round(percent * 100)}%
    </text>
  );
};

const STICKY_WIDTHS = [60, 200];
const stickyLeft = (i: number) => STICKY_WIDTHS.slice(0, i).reduce((a, b) => a + b, 0);

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.65rem", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)", background: "var(--surface)",
  color: "var(--text)", fontSize: "var(--fs-sm)", fontFamily: "var(--font-sans)",
};
const labelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "0.25rem", display: "block",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function BrandSelect({
  label, value, onChange, baseOptions, customOptions, onAddCustom,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  baseOptions: string[];
  customOptions: string[];
  onAddCustom: (v: string) => void;
}) {
  const ADD_NEW = "__add_new__";
  const options = Array.from(new Set([...baseOptions, ...customOptions, ...(value ? [value] : [])]));
  return (
    <Field label={label}>
      <select
        style={inputStyle}
        value={value}
        onChange={(e) => {
          if (e.target.value === ADD_NEW) {
            const v = window.prompt(`เพิ่ม ${label} ใหม่:`);
            if (v && v.trim()) {
              onAddCustom(v.trim());
              onChange(v.trim());
            }
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">-</option>
        {options.filter((o) => o !== "-" && o !== "").map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={ADD_NEW}>+ เพิ่มเจ้าใหม่...</option>
      </select>
    </Field>
  );
}

function ProjectEditModal({
  project, onSave, onClose, customBrandOptions, onAddCustomBrand,
}: {
  project: Project | null;
  onSave: (data: ProjectSeed) => Promise<void>;
  onClose: () => void;
  customBrandOptions: Record<CustomOptionKey, string[]>;
  onAddCustomBrand: (type: CustomOptionKey, value: string) => Promise<void>;
}) {
  const [data, setData] = useState<ProjectSeed>(project ? { ...project } : { ...EMPTY_PROJECT });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProjectSeed>(key: K, value: ProjectSeed[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  const addPhase = () => set("phases", [...data.phases, { ...EMPTY_PHASE }]);
  const removePhase = (i: number) => set("phases", data.phases.filter((_, idx) => idx !== i));
  const setPhase = (i: number, key: keyof ProjectPhase, value: ProjectPhase[typeof key]) =>
    set("phases", data.phases.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));

  const handleSave = async () => {
    if (!data.name.trim()) return;
    setSaving(true);
    try {
      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--sp-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)", width: "min(880px, 100%)",
          maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--border)",
        }}>
          <h3 style={{ margin: 0 }}>{project ? "แก้ไขโครงการ" : "เพิ่มโครงการใหม่"}</h3>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}>
            <IconX size={20} />
          </button>
        </div>

        <div style={{ padding: "var(--sp-5)", display: "grid", gap: "var(--sp-4)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)" }}>
            <Field label="Job No."><input style={inputStyle} type="number" value={data.jobNo ?? ""} onChange={(e) => set("jobNo", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="ชื่อโครงการ *"><input style={inputStyle} value={data.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="ประเภทหลังคา">
              <select style={inputStyle} value={data.roofType} onChange={(e) => set("roofType", e.target.value)}>
                {ROOF_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="ประเภทสัญญา">
              <select style={inputStyle} value={data.contractType} onChange={(e) => set("contractType", e.target.value as ContractType)}>
                {CONTRACT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="กำลังผลิต (kWp)"><input style={inputStyle} type="number" value={data.capacityKwp ?? ""} onChange={(e) => set("capacityKwp", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="จำนวนหลังคา"><input style={inputStyle} type="number" value={data.roofCount ?? ""} onChange={(e) => set("roofCount", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="จำนวน Meter"><input style={inputStyle} type="number" value={data.meterCount ?? ""} onChange={(e) => set("meterCount", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="จุดเชื่อมต่อ"><input style={inputStyle} value={data.connectionPoint} onChange={(e) => set("connectionPoint", e.target.value)} /></Field>
            <Field label="Safety Level"><input style={inputStyle} value={data.safetyLevel} onChange={(e) => set("safetyLevel", e.target.value)} /></Field>
            <Field label="Workmanship"><input style={inputStyle} value={data.workmanship} onChange={(e) => set("workmanship", e.target.value)} /></Field>
            <Field label="คู่สัญญา"><input style={inputStyle} value={data.counterparty} onChange={(e) => set("counterparty", e.target.value)} /></Field>
            <Field label="Location"><input style={inputStyle} value={data.location} onChange={(e) => set("location", e.target.value)} /></Field>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
            <strong style={{ fontSize: "var(--fs-sm)" }}>การเงิน / Subcon</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
              <Field label="ราคาตามสัญญา"><input style={inputStyle} value={data.contractPrice ?? ""} onChange={(e) => set("contractPrice", e.target.value)} /></Field>
              <Field label="Award Subcon (บาท)"><input style={inputStyle} value={data.subconAwardAmount ?? ""} onChange={(e) => set("subconAwardAmount", e.target.value)} /></Field>
              <Field label="THB/Watt (Material)"><input style={inputStyle} type="number" value={data.materialThbWatt ?? ""} onChange={(e) => set("materialThbWatt", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="THB/Watt (Labour)"><input style={inputStyle} type="number" value={data.labourThbWatt ?? ""} onChange={(e) => set("labourThbWatt", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Subcon Name"><input style={inputStyle} value={data.subconName} onChange={(e) => set("subconName", e.target.value)} /></Field>
              <Field label="Award Date"><input style={inputStyle} type="date" value={data.awardDate} onChange={(e) => set("awardDate", e.target.value)} /></Field>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
            <strong style={{ fontSize: "var(--fs-sm)" }}>สเปคอุปกรณ์</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
              <BrandSelect label="PV Brand" value={data.pvBrand} onChange={(v) => set("pvBrand", v)} baseOptions={PV_BRAND_BASE} customOptions={customBrandOptions.pv} onAddCustom={(v) => onAddCustomBrand("pv", v)} />
              <BrandSelect label="Power Class" value={data.powerClass} onChange={(v) => set("powerClass", v)} baseOptions={POWER_CLASS_BASE} customOptions={customBrandOptions.powerClass} onAddCustom={(v) => onAddCustomBrand("powerClass", v)} />
              <BrandSelect label="Inverter Brand" value={data.inverterBrand} onChange={(v) => set("inverterBrand", v)} baseOptions={INVERTER_BRAND_BASE} customOptions={customBrandOptions.inverter} onAddCustom={(v) => onAddCustomBrand("inverter", v)} />
              <BrandSelect label="Inverter Model" value={data.inverterModel} onChange={(v) => set("inverterModel", v)} baseOptions={INVERTER_MODEL_BASE} customOptions={customBrandOptions.inverterModel} onAddCustom={(v) => onAddCustomBrand("inverterModel", v)} />
              <BrandSelect label="Optimizer" value={data.optimizer} onChange={(v) => set("optimizer", v)} baseOptions={OPTIMIZER_BASE} customOptions={customBrandOptions.optimizer} onAddCustom={(v) => onAddCustomBrand("optimizer", v)} />
              <BrandSelect label="BESS Brand" value={data.bessBrand} onChange={(v) => set("bessBrand", v)} baseOptions={BESS_BRAND_BASE} customOptions={customBrandOptions.bess} onAddCustom={(v) => onAddCustomBrand("bess", v)} />
              <BrandSelect label="BESS Size (kWh)" value={data.bessSize} onChange={(v) => set("bessSize", v)} baseOptions={BESS_SIZE_BASE} customOptions={customBrandOptions.bessSize} onAddCustom={(v) => onAddCustomBrand("bessSize", v)} />
              <BrandSelect label="OM" value={data.om} onChange={(v) => set("om", v)} baseOptions={OM_BASE} customOptions={customBrandOptions.om} onAddCustom={(v) => onAddCustomBrand("om", v)} />
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
            <strong style={{ fontSize: "var(--fs-sm)" }}>ติดตามสถานะ</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
              <Field label="Kick off Date"><input style={inputStyle} type="date" value={data.kickoffDate} onChange={(e) => set("kickoffDate", e.target.value)} /></Field>
              <Field label="PU PIC"><input style={inputStyle} value={data.puPic} onChange={(e) => set("puPic", e.target.value)} /></Field>
              <Field label="PM PIC"><input style={inputStyle} value={data.pmPic} onChange={(e) => set("pmPic", e.target.value)} /></Field>
              <Field label="ENG PIC"><input style={inputStyle} value={data.engPic} onChange={(e) => set("engPic", e.target.value)} /></Field>
              <Field label="Status">
                <select style={inputStyle} value={data.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
                  {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="สถานะสี (ตามไฮไลท์)">
                <select style={inputStyle} value={data.colorStatus} onChange={(e) => set("colorStatus", e.target.value as ColorStatus)}>
                  {COLOR_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="TOC">
                <select style={inputStyle} value={data.toc} onChange={(e) => set("toc", e.target.value as TocStatus)}>
                  {TOC_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Estimate Site Mob"><input style={inputStyle} value={data.estimateSiteMob} onChange={(e) => set("estimateSiteMob", e.target.value)} /></Field>
              <Field label="Forecast Site Mob 1"><input style={inputStyle} value={data.forecastSiteMob1} onChange={(e) => set("forecastSiteMob1", e.target.value)} /></Field>
              <Field label="Forecast Site Mob 2"><input style={inputStyle} value={data.forecastSiteMob2} onChange={(e) => set("forecastSiteMob2", e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: "var(--sp-3)" }}>
              <Field label="Note">
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={data.note} onChange={(e) => set("note", e.target.value)} />
              </Field>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>Phases (โครงการย่อยภายใต้ Job เดียวกัน)</strong>
              <button type="button" onClick={addPhase} style={{
                display: "flex", alignItems: "center", gap: "0.3rem", border: "1px solid var(--border-strong)",
                background: "var(--surface)", borderRadius: "var(--radius-sm)", padding: "0.35rem 0.65rem",
                cursor: "pointer", fontSize: "var(--fs-xs)",
              }}>
                <IconPlus size={14} /> เพิ่ม Phase
              </button>
            </div>
            {data.phases.map((p, i) => (
              <div key={i} style={{
                marginTop: "var(--sp-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                padding: "var(--sp-3)", display: "grid", gap: "var(--sp-2)",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              }}>
                <Field label="ชื่อ Phase"><input style={inputStyle} value={p.name} onChange={(e) => setPhase(i, "name", e.target.value)} /></Field>
                <Field label="ประเภทหลังคา">
                  <select style={inputStyle} value={p.roofType} onChange={(e) => setPhase(i, "roofType", e.target.value)}>
                    {ROOF_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="kWp"><input style={inputStyle} type="number" value={p.capacityKwp ?? ""} onChange={(e) => setPhase(i, "capacityKwp", e.target.value === "" ? null : Number(e.target.value))} /></Field>
                <Field label="Subcon"><input style={inputStyle} value={p.subconName} onChange={(e) => setPhase(i, "subconName", e.target.value)} /></Field>
                <Field label="Kick off Date"><input style={inputStyle} type="date" value={p.kickoffDate} onChange={(e) => setPhase(i, "kickoffDate", e.target.value)} /></Field>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button type="button" onClick={() => removePhase(i)} style={{
                    border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "var(--fs-xs)",
                  }}>
                    <IconTrash size={14} /> ลบ Phase
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end", gap: "var(--sp-2)",
          padding: "var(--sp-4) var(--sp-5)", borderTop: "1px solid var(--border)",
        }}>
          <button onClick={onClose} style={{
            border: "1px solid var(--border-strong)", background: "var(--surface)", borderRadius: "var(--radius-sm)",
            padding: "0.55rem 1.1rem", cursor: "pointer",
          }}>
            ยกเลิก
          </button>
          <button onClick={handleSave} disabled={saving || !data.name.trim()} style={{
            border: "none", background: "var(--primary)", color: "white", borderRadius: "var(--radius-sm)",
            padding: "0.55rem 1.1rem", cursor: "pointer", opacity: saving || !data.name.trim() ? 0.6 : 1,
          }}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterColor, setFilterColor] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "jobNo" | "kWp" | "status">("jobNo");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingCell, setEditingCell] = useState<{ projectId: string; field: keyof Project; value: string } | null>(null);
  const [customBrandOptions, setCustomBrandOptions] = useState<Record<CustomOptionKey, string[]>>({
    pv: [], inverter: [], bess: [], powerClass: [], inverterModel: [], optimizer: [], bessSize: [], om: [],
  });

  useEffect(() => {
    const ref = doc(db, "settings", "brandOptions");
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data();
      setCustomBrandOptions({
        pv: (d?.pv as string[]) ?? [],
        inverter: (d?.inverter as string[]) ?? [],
        bess: (d?.bess as string[]) ?? [],
        powerClass: (d?.powerClass as string[]) ?? [],
        inverterModel: (d?.inverterModel as string[]) ?? [],
        optimizer: (d?.optimizer as string[]) ?? [],
        bessSize: (d?.bessSize as string[]) ?? [],
        om: (d?.om as string[]) ?? [],
      });
    });
    return unsub;
  }, []);

  const addCustomBrand = async (type: CustomOptionKey, value: string) => {
    const v = value.trim();
    if (!v) return;
    await setDoc(doc(db, "settings", "brandOptions"), { [type]: arrayUnion(v) }, { merge: true });
  };

  useEffect(() => {
    const colRef = collection(db, "kickoffProjects");
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        setLoadError(null);
        setProjects(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ProjectSeed) })));
      },
      (err) => setLoadError(err.message)
    );
    return unsub;
  }, []);

  const saveProjectEdit = async (data: ProjectSeed) => {
    if (!editingProject) return;
    await updateDoc(doc(db, "kickoffProjects", editingProject.id), { ...data });
    setEditingProject(null);
  };
  const addNewProject = async (data: ProjectSeed) => {
    await addDoc(collection(db, "kickoffProjects"), data);
    setAddingProject(false);
  };
  const deleteProject = async (id: string) => {
    if (!window.confirm("ยืนยันการลบโครงการนี้?")) return;
    await deleteDoc(doc(db, "kickoffProjects", id));
  };

  const saveInlineEdit = async (projectId: string, field: keyof Project, value: any) => {
    try {
      await updateDoc(doc(db, "kickoffProjects", projectId), { [field]: value });
      setEditingCell(null);
    } catch (err) {
      console.error("Failed to save inline edit:", err);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = projects.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.counterparty.toLowerCase().includes(q)) return false;
      if (filterColor !== "all" && p.colorStatus !== filterColor) return false;
      if (filterType !== "all" && p.contractType !== filterType) return false;
      return true;
    });

    result.sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      if (sortBy === "jobNo") {
        aVal = a.jobNo ?? 999999;
        bVal = b.jobNo ?? 999999;
      } else if (sortBy === "name") {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else if (sortBy === "kWp") {
        aVal = a.capacityKwp ?? 0;
        bVal = b.capacityKwp ?? 0;
      } else {
        aVal = a.colorStatus;
        bVal = b.colorStatus;
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [projects, search, filterColor, filterType, sortBy, sortAsc]);

  const exportToExcel = () => {
    const data = filtered.map((p) => ({
      "Job": p.jobNo ?? "",
      "ชื่อโครงการ": p.name,
      "สถานะ": p.colorStatus,
      "TOC": p.toc,
      "ประเภทหลังคา": p.roofType,
      "ประเภทสัญญา": p.contractType,
      "kWp": p.capacityKwp ?? "",
      "คู่สัญญา": p.counterparty,
      "Location": p.location,
      "ราคาตามสัญญา": p.contractPrice ?? "",
      "Award Subcon": p.subconAwardAmount ?? "",
      "Material THB/W": p.materialThbWatt ?? "",
      "Labour THB/W": p.labourThbWatt ?? "",
      "Subcon Name": p.subconName,
      "Award Date": p.awardDate,
      "PV Brand": p.pvBrand,
      "Power Class": p.powerClass,
      "Inverter Brand": p.inverterBrand,
      "Inverter Model": p.inverterModel,
      "Optimizer": p.optimizer,
      "BESS Brand": p.bessBrand,
      "BESS Size": p.bessSize,
      "OM": p.om,
      "Kick off Date": p.kickoffDate,
      "PU PIC": p.puPic,
      "PM PIC": p.pmPic,
      "ENG PIC": p.engPic,
      "Remark": p.note,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    XLSX.writeFile(wb, "projects.xlsx");
  };

  const colorChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) counts[p.colorStatus] = (counts[p.colorStatus] ?? 0) + 1;
    return COLOR_STATUS_OPTIONS.map((c) => ({ name: c, value: counts[c] ?? 0 })).filter((d) => d.value > 0);
  }, [projects]);

  const typeChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) counts[p.contractType] = (counts[p.contractType] ?? 0) + 1;
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [projects]);

  const subconChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.subconName && p.subconName !== "-") counts[p.subconName] = (counts[p.subconName] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const TOP_N = 5;
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);
    const restTotal = rest.reduce((sum, d) => sum + d.value, 0);
    return restTotal > 0 ? [...top, { name: "อื่นๆ", value: restTotal }] : top;
  }, [projects]);

  const roofChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      const key = p.roofType || "ไม่ระบุ";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [projects]);

  const pvBrandChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.pvBrand) {
        const b = normalizePvBrand(p.pvBrand);
        counts[b] = (counts[b] ?? 0) + 1;
      }
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [projects]);

  const capacityChartData = useMemo(() => {
    const ranges: Record<string, number> = { "< 500 kWp": 0, "> 500 kWp": 0 };
    for (const p of projects) {
      if (p.capacityKwp) {
        if (p.capacityKwp < 500) ranges["< 500 kWp"]++;
        else ranges["> 500 kWp"]++;
      }
    }
    return Object.entries(ranges).map(([name, count]) => ({ name, count })).filter((d) => d.count > 0);
  }, [projects]);

  const inverterBrandChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.inverterBrand) {
        const b = normalizeInverterBrand(p.inverterBrand);
        counts[b] = (counts[b] ?? 0) + 1;
      }
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [projects]);

  const bessBrandChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.bessBrand) counts[p.bessBrand] = (counts[p.bessBrand] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [projects]);

  // Projects per year, counted by Kick off date year.
  const kickoffYearChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      const m = /^(\d{4})/.exec(p.kickoffDate || "");
      if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  // Installed capacity (MW) per PV brand = sum of each project's kWp / 1000.
  const pvBrandMwChartData = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const p of projects) {
      if (p.pvBrand && p.capacityKwp) {
        const b = normalizePvBrand(p.pvBrand);
        sums[b] = (sums[b] ?? 0) + p.capacityKwp;
      }
    }
    return Object.entries(sums)
      .map(([name, kwp]) => ({ name, mw: Math.round((kwp / 1000) * 10) / 10 }))
      .sort((a, b) => b.mw - a.mw)
      .slice(0, 8);
  }, [projects]);

  return (
    <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
      <Reveal>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "var(--sp-2)" }}>
          <IconBuildingFactory2 size={16} stroke={1.75} />
          Project
        </div>
        <h1 style={{ margin: "0 0 var(--sp-5)", color: "var(--text-strong)" }}>โครงการทั้งหมด</h1>
      </Reveal>

      {loadError && (
        <div style={{
          color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)", borderRadius: "var(--radius)",
          padding: "var(--sp-4)", fontSize: "var(--fs-sm)", marginBottom: "var(--sp-5)",
        }}>
          โหลดข้อมูลไม่สำเร็จ: {loadError}
        </div>
      )}

      <Reveal delay={80}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
          <ChartCard title="สัดส่วนสถานะ">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart margin={{ top: 8, bottom: 8 }}>
                <Pie
                  data={colorChartData} dataKey="value" nameKey="name"
                  innerRadius={52} outerRadius={88} paddingAngle={2} cornerRadius={4}
                  isAnimationActive animationDuration={600}
                  label={PIE_LABEL} labelLine={false} fontSize={11}
                >
                  {colorChartData.map((d) => (
                    <Cell key={d.name} fill={COLOR_STATUS_HEX[d.name as ColorStatus]} stroke="var(--surface)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="สัดส่วนประเภทสัญญา">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={typeChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip cursor={{ fill: "color-mix(in srgb, var(--primary) 8%, transparent)" }} />
                <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={600} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="สัดส่วนประเภทหลังคา">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={roofChartData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} interval={0} />
                <Tooltip cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                <Bar dataKey="count" fill="var(--accent)" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={600} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          {subconChartData.length > 0 && (
            <ChartCard title="สัดส่วน Subcon ที่ใช้งาน">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart margin={{ top: 8, bottom: 8 }}>
                  <Pie
                    data={subconChartData} dataKey="value" nameKey="name"
                    innerRadius={52} outerRadius={88} paddingAngle={2} cornerRadius={4}
                    isAnimationActive animationDuration={600}
                    label={PIE_LABEL} labelLine={false} fontSize={11}
                  >
                    {subconChartData.map((d, i) => (
                      <Cell key={d.name} fill={SOFT_PALETTE[i % SOFT_PALETTE.length]} stroke="var(--surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {pvBrandChartData.length > 0 && (
            <ChartCard title="สัดส่วน PV Brand">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={pvBrandChartData} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={75} />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, #5B9BD5 8%, transparent)" }} />
                  <Bar dataKey="count" fill="#5B9BD5" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {capacityChartData.length > 0 && (
            <ChartCard title="สัดส่วนขนาดโครงการ">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={capacityChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, #70AD47 8%, transparent)" }} />
                  <Bar dataKey="count" fill="#70AD47" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {inverterBrandChartData.length > 0 && (
            <ChartCard title="สัดส่วน Inverter Brand">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={inverterBrandChartData} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={75} />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, #FFC000 8%, transparent)" }} />
                  <Bar dataKey="count" fill="#FFC000" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {bessBrandChartData.length > 0 && (
            <ChartCard title="สัดส่วน BESS Brand">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={bessBrandChartData} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={75} />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, #A349A4 8%, transparent)" }} />
                  <Bar dataKey="count" fill="#A349A4" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {kickoffYearChartData.length > 0 && (
            <ChartCard title="จำนวนโครงการต่อปี (ตาม Kick off)">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={kickoffYearChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, var(--primary) 8%, transparent)" }} />
                  <Bar dataKey="count" name="โครงการ" fill="var(--primary)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {pvBrandMwChartData.length > 0 && (
            <ChartCard title="กำลังการผลิตต่อ PV Brand (MW)">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={pvBrandMwChartData} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" fontSize={11} unit=" MW" />
                  <YAxis type="category" dataKey="name" fontSize={10} width={75} />
                  <Tooltip formatter={(v) => [`${v} MW`, "กำลังผลิต"]} cursor={{ fill: "color-mix(in srgb, #5B9BD5 8%, transparent)" }} />
                  <Bar dataKey="mw" fill="#5B9BD5" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      </Reveal>

      <Section
        eyebrow="Project List"
        title="รายการโครงการ"
        right={
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button onClick={exportToExcel} style={{
              display: "flex", alignItems: "center", gap: "0.4rem", border: "1px solid var(--border-strong)",
              background: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius-sm)",
              padding: "0.5rem 0.9rem", cursor: "pointer", fontSize: "var(--fs-sm)",
            }}>
              <IconFileSpreadsheet size={16} /> Export Excel
            </button>
            <button onClick={() => setAddingProject(true)} style={{
              display: "flex", alignItems: "center", gap: "0.4rem", border: "none", background: "var(--primary)",
              color: "white", borderRadius: "var(--radius-sm)", padding: "0.5rem 0.9rem", cursor: "pointer", fontSize: "var(--fs-sm)",
            }}>
              <IconPlus size={16} /> เพิ่มโครงการ
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
          <div style={{ position: "relative", flex: "1 1 240px" }}>
            <IconSearch size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อโครงการ / คู่สัญญา"
              style={{ ...inputStyle, paddingLeft: "2rem" }}
            />
          </div>
          <select style={{ ...inputStyle, width: 160 }} value={filterColor} onChange={(e) => setFilterColor(e.target.value)}>
            <option value="all">สถานะทั้งหมด</option>
            {COLOR_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select style={{ ...inputStyle, width: 160 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">ประเภทสัญญาทั้งหมด</option>
            {CONTRACT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-8)", color: "var(--text-faint)" }}>
            {projects.length === 0 ? "ยังไม่มีโครงการ" : "ไม่พบโครงการที่ตรงกับการค้นหา"}
          </div>
        ) : (
          <div style={{ overflow: "auto", maxHeight: "min(70vh, 760px)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "var(--bg-elevated)", textAlign: "left", color: "var(--text-muted)" }}>
                  {([
                    { label: "Job", key: "jobNo" as const },
                    { label: "ชื่อโครงการ", key: "name" as const },
                    { label: "Status", key: undefined },
                    { label: "TOC", key: undefined },
                  ] as { label: string; key?: "jobNo" | "name" }[]).map(({ label, key }, i) => (
                    <th
                      key={label}
                      onClick={key ? () => { if (sortBy === key) setSortAsc(!sortAsc); else { setSortBy(key); setSortAsc(true); } } : undefined}
                      style={{
                        position: "sticky", top: 0, left: i < 2 ? stickyLeft(i) : "auto", zIndex: i < 2 ? 3 : 1, padding: "8px 10px",
                        minWidth: i < 2 ? STICKY_WIDTHS[i] : "auto", width: i < 2 ? STICKY_WIDTHS[i] : "auto",
                        borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)",
                        cursor: key ? "pointer" : "default", userSelect: "none",
                        fontWeight: (key && sortBy === key) ? 700 : 600, color: (key && sortBy === key) ? "var(--accent)" : "var(--text-strong)",
                      }}
                    >
                      {label} {key && sortBy === key && (sortAsc ? "↑" : "↓")}
                    </th>
                  ))}
                  {[
                    { label: "ประเภทหลังคา" },
                    { label: "ประเภทสัญญา" },
                    { label: "kWp" },
                    { label: "คู่สัญญา" },
                    { label: "Location" },
                    { label: "ราคาตามสัญญา" },
                    { label: "Award Subcon" },
                    { label: "Material THB/W" },
                    { label: "Labour THB/W" },
                    { label: "Subcon Name" },
                    { label: "Award Date" },
                    { label: "PV Brand" },
                    { label: "Power Class" },
                    { label: "Inverter Brand" },
                    { label: "Inverter Model" },
                    { label: "Optimizer" },
                    { label: "BESS Brand" },
                    { label: "BESS Size" },
                    { label: "OM" },
                    { label: "Kick off Date" },
                    { label: "PU PIC" },
                    { label: "PM PIC" },
                    { label: "ENG PIC" },
                    { label: "สถานะ" },
                    { label: "Remark" },
                    { label: "" },
                  ].map(({ label }, idx) => (
                    <th
                      key={label || `col${idx}`}
                      style={{
                        position: "sticky", top: 0, zIndex: 1, padding: "8px 10px",
                        borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)",
                        cursor: "default", userSelect: "none",
                        fontWeight: 600, color: "var(--text-strong)",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const stickyTd = (i: number): React.CSSProperties =>
                    i < STICKY_WIDTHS.length ? { position: "sticky", left: stickyLeft(i), zIndex: 1, background: "var(--surface)" } : {};
                  const isEditingStatus = editingCell?.projectId === p.id && editingCell.field === "colorStatus";
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, ...stickyTd(0) }}>{p.jobNo ?? "-"}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", ...stickyTd(1) }}>
                        <div>{p.name}</div>
                        {p.phases.length > 0 && (
                          <div style={{ fontSize: "10px", color: "var(--text-faint)" }}>+{p.phases.length} phase</div>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", cursor: "pointer" }} onClick={() => setEditingCell({ projectId: p.id, field: "colorStatus", value: p.colorStatus })}>
                        {isEditingStatus ? (
                          <select
                            autoFocus
                            value={editingCell.value}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v !== p.colorStatus) saveInlineEdit(p.id, "colorStatus", v as ColorStatus);
                              else setEditingCell(null);
                            }}
                            onBlur={() => setEditingCell(null)}
                            style={{ ...inputStyle, width: "auto", minWidth: "100px", padding: "2px 4px", fontSize: "11px" }}
                          >
                            {COLOR_STATUS_OPTIONS.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "0.35rem",
                            padding: "0.2rem 0.55rem", borderRadius: "999px", fontSize: "10px",
                            background: `color-mix(in srgb, ${COLOR_STATUS_HEX[p.colorStatus]} 16%, transparent)`,
                            color: COLOR_STATUS_HEX[p.colorStatus],
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR_STATUS_HEX[p.colorStatus] }} />
                            {p.colorStatus}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", cursor: "pointer" }} onClick={() => setEditingCell({ projectId: p.id, field: "toc", value: p.toc })}>
                        {editingCell?.projectId === p.id && editingCell.field === "toc" ? (
                          <select
                            autoFocus
                            value={editingCell.value}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v !== p.toc) saveInlineEdit(p.id, "toc", v as TocStatus);
                              else setEditingCell(null);
                            }}
                            onBlur={() => setEditingCell(null)}
                            style={{ ...inputStyle, width: "auto", minWidth: "84px", padding: "2px 4px", fontSize: "11px" }}
                          >
                            {TOC_OPTIONS.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{
                            display: "inline-flex", alignItems: "center", padding: "0.2rem 0.55rem",
                            borderRadius: "999px", fontSize: "10px",
                            background: p.toc === "Done" ? "color-mix(in srgb, var(--success) 16%, transparent)" : p.toc === "WIP" ? "color-mix(in srgb, var(--warning) 16%, transparent)" : "color-mix(in srgb, var(--danger) 16%, transparent)",
                            color: p.toc === "Done" ? "var(--success)" : p.toc === "WIP" ? "var(--warning)" : "var(--danger)",
                          }}>
                            {p.toc}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{p.roofType || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.contractType}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.capacityKwp ?? "-"}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{p.counterparty || "-"}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{p.location || "-"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatNumber(p.contractPrice)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatNumber(p.subconAwardAmount)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.materialThbWatt != null ? p.materialThbWatt.toFixed(2) : "-"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.labourThbWatt != null ? p.labourThbWatt.toFixed(2) : "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.subconName || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.awardDate || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.pvBrand || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.powerClass || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.inverterBrand || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.inverterModel || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.optimizer || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.bessBrand || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.bessSize || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.om || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.kickoffDate || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.puPic || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.pmPic || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.engPic || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>{p.status}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)" }}>{p.note || "-"}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <button onClick={() => setEditingProject(p)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", marginRight: "0.4rem" }}>
                          <IconPencil size={16} />
                        </button>
                        <button onClick={() => deleteProject(p.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--danger)" }}>
                          <IconTrash size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ProjectFarm />

      {editingProject && (
        <ProjectEditModal project={editingProject} onSave={saveProjectEdit} onClose={() => setEditingProject(null)} customBrandOptions={customBrandOptions} onAddCustomBrand={addCustomBrand} />
      )}
      {addingProject && (
        <ProjectEditModal project={null} onSave={addNewProject} onClose={() => setAddingProject(false)} customBrandOptions={customBrandOptions} onAddCustomBrand={addCustomBrand} />
      )}
    </div>
  );
}
