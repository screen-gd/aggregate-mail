import { inboxTabs, type InboxTab } from "../../shared/inbox-tabs";
import { SlidingNav } from "../ui/SlidingNav";
import { tabIcons } from "./format";

/** Inbox categories use a picker when the complete tab strip cannot fit. */
export function InboxTabs({ tab, unread, onTab, compact = false }: {
  tab: InboxTab;
  unread: Map<InboxTab, number>;
  onTab: (tab: InboxTab) => void;
  compact?: boolean;
}) {
  if (compact) return (
    <select className="inbox-category-picker" aria-label="Inbox category" value={tab}
      onChange={event => onTab(event.target.value as InboxTab)}>
      {inboxTabs.map(({ id, label }) => {
        const count = unread.get(id) ?? 0;
        return <option key={id} value={id}>{label}{count > 0 ? ` (${count} unread)` : ""}</option>;
      })}
    </select>
  );
  return (
    <SlidingNav axis="x" activeKey={tab} label="Inbox categories" className="inbox-tabs">
      {inboxTabs.map(({ id, label }) => {
        const Icon = tabIcons[id];
        const count = unread.get(id) ?? 0;
        return (
          <button key={id} className={tab === id ? "active" : undefined} title={label}
            aria-current={tab === id ? "page" : undefined} onClick={() => onTab(id)}>
            <Icon color="currentColor" size={15} />
            <span className="tab-label">{label}</span>
            {count > 0 && <span className="tab-count" aria-label={`${count} unread`}>{count}</span>}
          </button>
        );
      })}
    </SlidingNav>
  );
}
