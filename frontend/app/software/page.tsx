import { Download, MonitorSmartphone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getSoftware } from "@/lib/content";

export default async function SoftwarePage() {
  const software = await getSoftware();
  return <><SiteHeader /><main className="catalog-page shell"><header><p className="eyebrow">Approved resources</p><h1>Software catalogue</h1><p>Installation resources approved for IIC students and staff.</p></header>{software.length ? <div className="software-list">{software.map((item) => <article key={item.id}><span className="software-icon"><MonitorSmartphone aria-hidden="true" /></span><div><h2>{item.name}{item.version && <small>{item.version}</small>}</h2><p>{item.description}</p><div className="catalog-meta"><span>{item.platforms.join(" · ")}</span><span>{item.audience}</span></div>{item.licence_notes && <p className="licence-note">{item.licence_notes}</p>}</div>{item.download_url ? <a className="primary-button" href={item.download_url} target="_blank" rel="noopener noreferrer"><Download aria-hidden="true" /> Open download</a> : <span className="status-chip draft">Link pending</span>}</article>)}</div> : <div className="catalog-empty"><MonitorSmartphone aria-hidden="true" /><h2>No software published yet</h2><p>Active, approved resources will appear here.</p></div>}</main></>;
}
