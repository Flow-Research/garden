"use client";

import { useState } from "react";
import { Search, CheckCircle2, Loader2, MailCheck, AlertCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import ServerSelector, { type ServerOption } from "@/components/shared/ServerSelector";
import { mailApi, getApiErrorMessage } from "@/lib/api";
import { useI18n, interpolate } from "@/components/i18n-provider";

interface ScanResult {
  serverId: string;
  iredmailInstalled: boolean;
  hasState: boolean;
  domain: string | null;
  installComplete: boolean;
  webmailPresent: boolean;
  adoptable: boolean;
}

/**
 * "Adopt existing mail server" — for the disaster-recovery case where the
 * orchestrator (desktop) was lost but the mail server still runs on a VPS.
 * Pick a server → scan (read-only: detects iRedMail + reads the on-server
 * state file) → adopt (repopulates the dashboard's record). No reinstall.
 */
export function AdoptMailModal({
  isOpen,
  onClose,
  onAdopted,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdopted: (serverId: string) => void;
}) {
  const { t } = useI18n();
  const [server, setServer] = useState<ServerOption | null>(null);
  const [scanning, setScanning] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setServer(null);
    setResult(null);
    setError(null);
    onClose();
  };

  const pickServer = (s: ServerOption | null) => {
    setServer(s);
    setResult(null);
    setError(null);
  };

  const handleScan = async () => {
    if (!server) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await mailApi.scan(server.id);
      setResult(res);
      if (!res.adoptable) {
        setError(t.emails.adopt.noInstall);
      }
    } catch (e) {
      setError(getApiErrorMessage(e, t.emails.adopt.scanFailed));
    } finally {
      setScanning(false);
    }
  };

  const handleAdopt = async () => {
    if (!server || !result?.adoptable) return;
    setAdopting(true);
    setError(null);
    try {
      const res = await mailApi.adopt(server.id);
      onAdopted(res.serverId);
      close();
    } catch (e) {
      setError(getApiErrorMessage(e, t.emails.adopt.adoptFailed));
    } finally {
      setAdopting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={t.emails.adopt.title}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t.emails.adopt.intro}
        </p>

        <ServerSelector value={server?.id ?? null} onSelect={pickServer} compact />

        <button
          type="button"
          onClick={handleScan}
          disabled={!server || scanning || adopting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {scanning ? t.emails.adopt.scanning : t.emails.adopt.scan}
        </button>

        {result?.adoptable && (
          <div className="rounded-xl border border-success-border bg-success-bg p-4 text-sm text-foreground space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-success">
              <CheckCircle2 className="size-4" /> {t.emails.adopt.detected}
            </div>
            <p>
              {t.emails.adopt.domainLabel}{" "}
              <span className="font-semibold">{result.domain ?? t.emails.adopt.unknown}</span>
            </p>
            <p className="text-muted-foreground">
              {interpolate(t.emails.adopt.stats, {
                iredmail: result.iredmailInstalled ? t.emails.adopt.yes : t.emails.adopt.no,
                install: result.installComplete ? t.emails.adopt.complete : t.emails.adopt.inProgress,
                webmail: result.webmailPresent ? t.emails.adopt.present : t.emails.adopt.notDeployed,
              })}
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {t.emails.adopt.cancel}
          </button>
          <button
            type="button"
            onClick={handleAdopt}
            disabled={!result?.adoptable || adopting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adopting ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
            {t.emails.adopt.adopt}
          </button>
        </div>
      </div>
    </Modal>
  );
}
