"use client";

/**
 * Send Test Mail modal - standalone overlay (open / onClose driven).
 *
 * Loads the list of provisioned domains for the given mail server, lets the
 * operator pick which domain to send AS, and POSTs to
 * `mail/admin/:serverId/test-email`. The backend ensures (creates if
 * missing) an `openship@<fromDomain>` mailbox and authenticates as that
 * identity — so SMTP AUTH user == MAIL FROM and Postfix's
 * `reject_sender_login_mismatch` policy is satisfied. Subject and body
 * are hardcoded server-side; this form only collects recipient + sender
 * domain.
 *
 * Visual model: matches `welcome-modal.tsx` (fixed-position overlay with
 * its own backdrop) since the prop contract is open/onClose rather than
 * the `useModal`-driven `customContent` pattern used by the tab forms.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, X, CheckCircle2, ExternalLink } from "lucide-react";
import {
  getApiErrorMessage,
  mailAdminApi,
  type AdminDomain,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/components/i18n-provider";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The mail server we're testing against. */
  serverId: string;
}

// Same regex used by welcome-modal.tsx for consistency with the rest of the
// mail-admin surface.
const EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Map the recipient's domain to a webmail deep link so the success
 * state can offer a one-click "open inbox" jump. Unknown providers
 * return null — UI falls back to just the Close button.
 *
 * Per-provider URLs are the canonical inbox entry; on mobile they
 * deep-link into the installed app (Gmail/Outlook honor their own
 * intent filters when invoked via these https origins).
 */
type InboxLabelKey =
  | "openGmail"
  | "openOutlook"
  | "openYahoo"
  | "openIcloud"
  | "openProton"
  | "openAol";

function recipientInboxLink(
  email: string,
): { labelKey: InboxLabelKey; href: string } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { labelKey: "openGmail", href: "https://mail.google.com/mail/u/0/#inbox" };
  }
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com"
  ) {
    return { labelKey: "openOutlook", href: "https://outlook.live.com/mail/0/inbox" };
  }
  if (domain.startsWith("yahoo.")) {
    return { labelKey: "openYahoo", href: "https://mail.yahoo.com/" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { labelKey: "openIcloud", href: "https://www.icloud.com/mail" };
  }
  if (domain === "proton.me" || domain === "protonmail.com" || domain === "pm.me") {
    return { labelKey: "openProton", href: "https://mail.proton.me/u/0/inbox" };
  }
  if (domain === "aol.com") {
    return { labelKey: "openAol", href: "https://mail.aol.com/" };
  }
  return null;
}

interface SendResult {
  to: string;
  from: string;
  messageId: string;
  smtpResponse: string;
}

export function SendTestMailModal({ open, onClose, serverId }: Props) {
  const [recipient, setRecipient] = useState("");
  const [senderDomain, setSenderDomain] = useState("");
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToast();
  const { t } = useI18n();

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setRecipient("");
    setSenderDomain("");
    setError(null);
    setResult(null);
    setSending(false);
  }, [open]);

  // Fetch domains when the modal opens. Active domains only — the test would
  // fail at SMTP auth otherwise.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingDomains(true);
    setError(null);
    mailAdminApi.domains
      .list(serverId)
      .then((res) => {
        if (cancelled) return;
        const active = res.domains.filter((d) => d.active);
        setDomains(active);
        // Default to the first active domain (which, since vmail.domain is
        // ORDER BY'd by domain server-side, lands on the alphabetically-first
        // provisioned domain — good enough as a default given Props only
        // carries serverId).
        if (active.length > 0) setSenderDomain(active[0].domain);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiErrorMessage(err, t.emailsAdmin.sendTest.loadDomainsFailed));
      })
      .finally(() => {
        if (!cancelled) setLoadingDomains(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, serverId]);

  // Autofocus the recipient input once the modal renders, mirroring
  // welcome-modal.
  useEffect(() => {
    if (!open || result) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(id);
  }, [open, result]);

  const trimmedRecipient = recipient.trim().toLowerCase();
  const recipientValid = EMAIL_RE.test(trimmedRecipient);
  const canSubmit =
    !sending && recipientValid && senderDomain.length > 0 && !loadingDomains;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSending(true);
    try {
      const res = await mailAdminApi.testEmail.send(
        serverId,
        trimmedRecipient,
        senderDomain,
      );
      setResult(res);
      showToast(
        t.emailsAdmin.sendTest.sentToast,
        "success",
        t.emailsAdmin.sendTest.toastTitle,
      );
    } catch (err) {
      const message = getApiErrorMessage(err, t.emailsAdmin.sendTest.sendFailed);
      setError(message);
      showToast(message, "error", t.emailsAdmin.sendTest.toastTitle);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="relative w-full max-w-[480px] bg-card rounded-2xl border border-border shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
        <button
          onClick={onClose}
          disabled={sending}
          aria-label={t.emailsAdmin.sendTest.close}
          className="absolute top-4 end-4 p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>

        {result ? (
          <SentStage result={result} onClose={onClose} />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-7 pt-8 pb-6">
              <h2
                className="text-[22px] font-semibold text-foreground leading-[1.2]"
                style={{ letterSpacing: "-0.4px" }}
              >
                {t.emailsAdmin.sendTest.title}
              </h2>
              <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">
                {t.emailsAdmin.sendTest.sendsFromBefore}
                <span className="font-mono text-[12.5px] text-foreground">
                  openship@{senderDomain || "…"}
                </span>
                {t.emailsAdmin.sendTest.sendsFromAfter}
              </p>
            </div>

            <div className="h-px bg-border" />

            <div className="px-7 py-6 space-y-5">
              <div>
                <label
                  htmlFor="test-mail-to"
                  className="block text-[13px] font-medium text-foreground mb-1.5"
                >
                  {t.emailsAdmin.sendTest.sendToLabel}
                </label>
                <input
                  ref={inputRef}
                  id="test-mail-to"
                  type="email"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="you@example.com"
                  disabled={sending}
                  autoComplete="email"
                  spellCheck={false}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="test-mail-from"
                  className="block text-[13px] font-medium text-foreground mb-1.5"
                >
                  {t.emailsAdmin.sendTest.fromDomainLabel}
                </label>
                <select
                  id="test-mail-from"
                  value={senderDomain}
                  onChange={(e) => setSenderDomain(e.target.value)}
                  disabled={sending || loadingDomains || domains.length === 0}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors disabled:opacity-60"
                >
                  {loadingDomains && <option value="">{t.emailsAdmin.sendTest.loadingDomains}</option>}
                  {!loadingDomains && domains.length === 0 && (
                    <option value="">{t.emailsAdmin.sendTest.noActiveDomains}</option>
                  )}
                  {domains.map((d) => (
                    <option key={d.domain} value={d.domain}>
                      {d.domain}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">
                  {t.emailsAdmin.sendTest.fromHint}
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sending}
                  className="px-4 py-2 text-[13.5px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {t.emailsAdmin.sendTest.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13.5px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending && (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
                  )}
                  {sending ? t.emailsAdmin.sendTest.sending : t.emailsAdmin.sendTest.sendTest}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SentStage({
  result,
  onClose,
}: {
  result: SendResult;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="px-7 pt-8 pb-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
            <CheckCircle2 className="size-5" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-[20px] font-semibold text-foreground leading-[1.2]"
              style={{ letterSpacing: "-0.3px" }}
            >
              {t.emailsAdmin.sendTest.sentTitle}
            </h2>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
              {t.emailsAdmin.sendTest.sentCheckBefore}
              <span className="font-mono text-[12.5px] text-foreground break-all">
                {result.to}
              </span>
              {t.emailsAdmin.sendTest.sentCheckMiddle}
              <span className="font-mono text-[12.5px] text-foreground break-all">
                {result.from}
              </span>
              {t.emailsAdmin.sendTest.sentCheckAfter}
            </p>
            <p className="mt-2 text-[11.5px] text-muted-foreground/80 font-mono break-all">
              {result.smtpResponse}
            </p>
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="px-7 py-5 flex justify-end gap-2">
        {(() => {
          const inbox = recipientInboxLink(result.to);
          if (!inbox) return null;
          return (
            <a
              href={inbox.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13.5px] font-semibold rounded-lg border border-border text-foreground hover:bg-muted/40 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              {t.emailsAdmin.sendTest[inbox.labelKey]}
            </a>
          );
        })()}
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13.5px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t.emailsAdmin.sendTest.close}
        </button>
      </div>
    </div>
  );
}
