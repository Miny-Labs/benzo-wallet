/**
 * Contact detail — tap a contact to see and edit their address/handle and browse
 * the payment history with them (the activity feed filtered to this person). The
 * editor works for both address/receive-code contacts and `@handle` ones via the
 * local-first contacts store.
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Clock, Send as SendIcon, Trash2 } from "lucide-react";
import { useWallet } from "../lib/store";
import { mergeContacts, normAddress, removeLocalContact, upsertLocalContact } from "../lib/contacts";
import { Screen, Stagger } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { Avatar, Button, Card, EmptyState, Input, useToast } from "../ui/primitives";
import { ActivityItem } from "../ui/ActivityItem";

/** Compact, human label for a handle/address/receive-code. */
function handleLabel(handle: string): string {
  if (handle.startsWith("bzr_")) return `${handle.slice(0, 10)}…${handle.slice(-8)}`;
  if (handle.length > 24) return `${handle.slice(0, 8)}…${handle.slice(-8)}`;
  return handle;
}

/** Accept an EVM address, a `bzr_` receive code, or an `@handle`. */
function isValidContactHandle(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (normAddress(t)) return true;
  return /^@?[a-z0-9_]{2,30}$/i.test(t);
}

/** Bare handles gain their `@`; addresses / receive codes stay verbatim. */
function normalizeSavedHandle(raw: string): string {
  const t = raw.trim();
  if (normAddress(t)) return t;
  if (t.startsWith("@")) return t;
  return `@${t.replace(/^@/, "")}`;
}

export function ContactDetail() {
  const nav = useNavigate();
  const toast = useToast();
  const { handle: handleParam = "" } = useParams();
  const { contacts: bff, history, hidden } = useWallet();
  const [version, bump] = useState(0);

  const contact = useMemo(
    () => mergeContacts(bff).find((c) => c.handle === handleParam),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bff, handleParam, version],
  );

  const [name, setName] = useState(() => contact?.name ?? "");
  const [handle, setHandle] = useState(() => contact?.handle ?? "");

  const rows = useMemo(
    () => (contact ? history.filter((r) => r.name.toLowerCase() === contact.name.toLowerCase()) : []),
    [history, contact],
  );

  const validHandle = isValidContactHandle(handle);
  const dirty =
    !!contact && (name.trim() !== contact.name || normalizeSavedHandle(handle) !== contact.handle);

  function save() {
    if (!contact || !validHandle) return;
    const nextHandle = normalizeSavedHandle(handle);
    const nextName = name.trim() || contact.name;
    upsertLocalContact(contact.handle, nextHandle, nextName);
    toast({ title: "Contact updated.", tone: "success" });
    if (nextHandle !== contact.handle) {
      nav(`/contacts/${encodeURIComponent(nextHandle)}`, { replace: true });
    } else {
      bump((v) => v + 1);
    }
  }

  function remove() {
    if (!contact) return;
    removeLocalContact(contact.handle);
    toast({ title: "Contact removed." });
    nav("/contacts", { replace: true });
  }

  if (!contact) {
    return (
      <Screen>
        <ScreenHeader title="Contact" />
        <div className="px-8 py-20 text-center" data-testid="contact-detail-missing">
          <div className="text-[14px] text-muted">This contact isn't saved on this device.</div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => nav("/contacts")}>
            Back to contacts
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={contact.name} />
      <Stagger className="space-y-4 px-5 pb-10 pt-1" data-testid="contact-detail">
        <Stagger.Item index={0}>
          <Card className="flex items-center gap-3 p-4">
            <Avatar name={contact.name} tone={contact.tone} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-semibold">{contact.name}</div>
              <div className="truncate text-[13px] text-muted">{handleLabel(contact.handle)}</div>
            </div>
            <Button size="sm" onClick={() => nav(`/send?to=${encodeURIComponent(contact.handle)}`)} data-testid="contact-detail-pay">
              <SendIcon size={15} /> Pay
            </Button>
          </Card>
        </Stagger.Item>

        <Stagger.Item index={1}>
          <Card className="space-y-3 p-4" data-testid="contact-detail-edit">
            <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Details</div>
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="contact-detail-name" />
            <Input
              label="Address, Receive Code, or @handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              data-testid="contact-detail-handle"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              error={handle && !validHandle ? "Enter a valid address, receive code, or @handle." : undefined}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={!validHandle || !dirty} data-testid="contact-detail-save">
                Save changes
              </Button>
              <Button variant="ghost" size="sm" className="text-danger" onClick={remove} data-testid="contact-detail-remove">
                <Trash2 size={15} /> Remove
              </Button>
            </div>
          </Card>
        </Stagger.Item>

        <Stagger.Item index={2}>
          <div>
            <div className="px-1 pb-1 text-[12px] font-bold uppercase tracking-[0.05em] text-muted">
              Payments with {contact.name}
            </div>
            {rows.length === 0 ? (
              <Card>
                <EmptyState icon={<Clock size={26} />} title="No payments yet" hint={`Money you send or receive with ${contact.name} shows up here.`} />
              </Card>
            ) : (
              <Card className="px-4" data-testid="contact-detail-history">
                {rows.map((row, i) => (
                  <ActivityItem key={row.id} row={row} hidden={hidden} last={i === rows.length - 1} />
                ))}
              </Card>
            )}
          </div>
        </Stagger.Item>
      </Stagger>
    </Screen>
  );
}
