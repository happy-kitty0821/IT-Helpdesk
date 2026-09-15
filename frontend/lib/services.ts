// ── Field types ───────────────────────────────────────────────────────────

export type FieldType = 'text' | 'textarea' | 'select' | 'email' | 'phone' | 'checkbox' | 'file';

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help_text?: string;
  order?: number;
};

// ── Service type ──────────────────────────────────────────────────────────

export type Service = {
  id: number;
  name: string;
  slug: string;
  summary: string;
  audience: 'public' | 'student' | 'staff' | 'all';
  icon: string;
  form_schema: FieldDefinition[];
  stages: { key: string; label: string; description?: string; icon?: string }[];
};

// ── Fallback services ─────────────────────────────────────────────────────

export const fallbackServices: Service[] = [
  { id: 1, name: 'College account recovery', slug: 'account-recovery', summary: 'Recover access to your IIC college account safely.', audience: 'public', icon: 'key-round', form_schema: [], stages: [] },
  { id: 2, name: 'Laptop & device support', slug: 'device-support', summary: 'Get help diagnosing laptop, software, and device problems.', audience: 'all', icon: 'laptop', form_schema: [], stages: [] },
  { id: 3, name: 'ID card replacement', slug: 'id-card-replacement', summary: 'Report a lost or damaged college ID card.', audience: 'all', icon: 'badge', form_schema: [], stages: [] },
  { id: 4, name: 'Wi-Fi issue', slug: 'wifi-issue', summary: 'Report weak signal, connection failures, or campus Wi-Fi problems.', audience: 'all', icon: 'wifi', form_schema: [], stages: [] },
  { id: 5, name: 'CCTV review request', slug: 'cctv-review', summary: 'Request an authorized review for a campus incident.', audience: 'staff', icon: 'camera', form_schema: [], stages: [] },
  { id: 6, name: 'General IT support', slug: 'general-support', summary: 'Ask for help with classroom equipment, or software.', audience: 'all', icon: 'life-buoy', form_schema: [], stages: [] },
];

// ── Server-side fetcher ────────────────────────────────────────────────────

const serverBase = 'http://127.0.0.1:8000/api/v1';

function rewriteMediaUrls<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(rewriteMediaUrls) as unknown as T;
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('http://127.0.0.1:8000/media/')) {
      result[key] = value.replace('http://127.0.0.1:8000', '');
    } else {
      result[key] = rewriteMediaUrls(value);
    }
  }
  return result as T;
}

async function publicGet<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${serverBase}/${path}/`, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    return rewriteMediaUrls(data);
  } catch { return []; }
}

export const getServices = () => publicGet<Service>('services');
export const getSoftware = () => publicGet<{ id: number; name: string; slug: string; description: string; version: string; platforms: string[]; audience: string; licence_notes: string; download_url: string; guide: number | null; guide_title: string | null; status: string; updated_by_name: string | null; updated_at: string }>('software');
