export type Service = {
  id: number;
  name: string;
  slug: string;
  summary: string;
  audience: "public" | "student" | "staff" | "all";
  icon: string;
};

export const fallbackServices: Service[] = [
  { id: 1, name: "College account recovery", slug: "account-recovery", summary: "Recover access to your IIC college account safely.", audience: "public", icon: "key-round" },
  { id: 2, name: "Laptop & device support", slug: "device-support", summary: "Get help diagnosing laptop, software, and device problems.", audience: "all", icon: "laptop" },
  { id: 3, name: "ID card replacement", slug: "id-card-replacement", summary: "Report a lost or damaged college ID card.", audience: "all", icon: "badge" },
  { id: 4, name: "Wi-Fi issue", slug: "wifi-issue", summary: "Report weak signal, connection failures, or campus Wi-Fi problems.", audience: "all", icon: "wifi" },
  { id: 5, name: "CCTV review request", slug: "cctv-review", summary: "Request an authorized review for a campus incident.", audience: "staff", icon: "camera" },
  { id: 6, name: "General IT support", slug: "general-support", summary: "Ask for help with classroom equipment, printing, or software.", audience: "all", icon: "life-buoy" },
];

export async function getServices(): Promise<Service[]> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";
  try {
    const response = await fetch(`${baseUrl}/services/`, { cache: "no-store" });
    if (!response.ok) return fallbackServices;
    return response.json();
  } catch {
    return fallbackServices;
  }
}
