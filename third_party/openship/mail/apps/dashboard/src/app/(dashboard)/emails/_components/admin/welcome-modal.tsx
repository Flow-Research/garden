"use client";

/**
 * Post-install celebration modal - restrained, monochrome, no gradients,
 * no halos, no status pills, no eyebrow tags. Trust the typography.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │  Your mail server is live.           │   ← left-aligned headline
 *   │  oblien.com is accepting mail.       │   ← supporting sentence
 *   ├──────────────────────────────────────┤   ← hairline
 *   │  Send a test to                      │
 *   │  [input]                             │
 *   │                          Skip · Send │
 *   └──────────────────────────────────────┘
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { mailAdminApi } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

interface WelcomeModalProps {
  serverId: string;
  /**
   * Domain to send the welcome test FROM. The server authenticates as
   * `postmaster@<domain>` using the credential it stored when this domain
   * was provisioned (install postmaster lives in `state.secrets`; additional
   * domains live in `state.additionalDomains[domain].postmasterPassword`).
   * Surfaced as copy in the headline / "sent from" line.
   */
  domain: string;
  onClose: () => void;
}

type Stage = "intro" | "sent";

const EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function WelcomeModal({ serverId, domain, onClose }: WelcomeModalProps) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("intro");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (stage === "intro") {
      const id = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(id);
    }
  }, [stage]);

  const handleSend = async () => {
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) {
      setError(t.emailsAdmin.welcome.invalidEmail);
      return;
    }
    setError(null);
    setSending(true);
    try {
      await mailAdminApi.testEmail.send(serverId, v, domain);
      setStage("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.emailsAdmin.welcome.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sending) handleSend();
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[460px] bg-card rounded-2xl border border-border shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
        <button
          onClick={onClose}
          aria-label={t.emailsAdmin.welcome.dismiss}
          className="absolute top-4 end-4 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>

        {stage === "intro" ? (
          <IntroStage
            domain={domain}
            email={email}
            onEmailChange={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            error={error}
            sending={sending}
            inputRef={inputRef}
            onSubmit={onSubmit}
            onSkip={onClose}
          />
        ) : (
          <SentStage email={email} domain={domain} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ─── Intro stage ─────────────────────────────────────────────────────────────

function IntroStage({
  domain,
  email,
  onEmailChange,
  error,
  sending,
  inputRef,
  onSubmit,
  onSkip,
}: {
  domain: string;
  email: string;
  onEmailChange: (v: string) => void;
  error: string | null;
  sending: boolean;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onSubmit: (e: React.FormEvent) => void;
  onSkip: () => void;
}) {
  const { t } = useI18n();
  return (
    <form onSubmit={onSubmit}>
      <div className="px-7 pt-8 pb-6">
        <h2
          className="text-[24px] font-semibold text-foreground leading-[1.15]"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t.emailsAdmin.welcome.liveTitle}
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground leading-relaxed">
          <span className="font-mono text-[13.5px] text-foreground">{domain}</span>
          {t.emailsAdmin.welcome.liveDescAfter}
        </p>
      </div>

      <div className="h-px bg-border" />

      <div className="px-7 py-6">
        <label
          htmlFor="welcome-test-email"
          className="block text-[13px] font-medium text-foreground mb-2"
        >
          {t.emailsAdmin.welcome.sendToLabel}
        </label>
        <input
          ref={inputRef}
          id="welcome-test-email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="you@example.com"
          disabled={sending}
          autoComplete="email"
          spellCheck={false}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors disabled:opacity-60"
        />
        {error && (
          <p className="mt-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-1 mt-5">
          <button
            type="button"
            onClick={onSkip}
            disabled={sending}
            className="px-3 py-2 text-[13.5px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t.emailsAdmin.welcome.skip}
          </button>
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13.5px] font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            {sending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />}
            {sending ? t.emailsAdmin.welcome.sending : t.emailsAdmin.welcome.sendTest}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Sent stage ──────────────────────────────────────────────────────────────

function SentStage({
  email,
  domain,
  onClose,
}: {
  email: string;
  domain: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="px-7 pt-8 pb-6">
        <h2
          className="text-[24px] font-semibold text-foreground leading-[1.15]"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t.emailsAdmin.welcome.sentTitle}
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground leading-relaxed">
          {t.emailsAdmin.welcome.sentBefore}
          <span className="font-mono text-[13.5px] text-foreground">
            postmaster@{domain}
          </span>
          {t.emailsAdmin.welcome.sentMiddle}
          <span className="font-mono text-[13.5px] text-foreground">{email}</span>
          {t.emailsAdmin.welcome.sentAfter}
        </p>
      </div>

      <div className="h-px bg-border" />

      <div className="px-7 py-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13.5px] font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          {t.emailsAdmin.welcome.gotIt}
        </button>
      </div>
    </div>
  );
}
