import { z } from "zod";

/** Canonical portable schemas shared by the Garden server and the execution host. */
export const engineeringJobSchema = z.strictObject({
	schema: z.literal("harnessy.engineering.job.v1"),
	id: z.string().uuid(),
	objective: z.string().min(1).max(200),
	taskId: z.string().uuid(),
	taskRevision: z.string().regex(/^[a-f0-9]{64}$/),
	workspace: z.string().min(1).max(200),
	repository: z.enum(["harnessy-v2", "garden", "workstream"]),
	lane: z.enum(["native", "maintenance", "security", "correctness"]),
	sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
	evaluatorDigest: z.string().regex(/^[a-f0-9]{64}$/),
	workloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
	proofOnlyResume: z
		.strictObject({ previousAuthorityId: z.string().uuid(), expectedHeadSha: z.string().regex(/^[a-f0-9]{40}$/) })
		.optional(),
});

export const engineeringGrantSchema = z
	.strictObject({
		schema: z.literal("harnessy.engineering.grant.v1"),
		id: z.string().uuid(),
		operator: z.literal("julian"),
		jobDigest: z.string().regex(/^[a-f0-9]{64}$/),
		issuedAt: z.number().int().nonnegative(),
		expiresAt: z.number().int().positive(),
	})
	.refine((grant) => grant.expiresAt > grant.issuedAt, "Grant expiry must follow issuance");

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const hostContractVersion = "harnessy.execution-host.v1" as const;
export const hostRunStateSchema = z.enum([
	"reserved",
	"running",
	"verifying",
	"cancel_requested",
	"reconciling",
	"succeeded",
	"failed",
	"cancelled",
]);

export const hostEnrollmentSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	hostId: uuid,
	workspaceId: uuid,
	operatorId: uuid,
	publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	keyGeneration: z.number().int().positive().max(2_147_483_647),
	repositories: z
		.array(z.enum(["harnessy-v2", "garden", "workstream"]))
		.min(1)
		.max(3),
	agent: z.literal("claude-code"),
	capabilityDigest: sha256,
});

export const hostLaunchSchema = z
	.strictObject({
		contractVersion: z.literal(hostContractVersion),
		launchId: uuid,
		hostId: uuid,
		workspaceId: uuid,
		memberId: uuid,
		operatorId: uuid,
		capabilityDigest: sha256,
		job: engineeringJobSchema,
		grant: engineeringGrantSchema,
		requestDigest: sha256,
	})
	.refine((input) => input.workspaceId === input.job.workspace, "Job workspace differs from launch scope");

export const hostEventSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	hostId: uuid,
	workspaceId: uuid,
	launchId: uuid,
	runId: uuid,
	sequence: z.number().int().positive().safe(),
	at: z.number().int().nonnegative().safe(),
	state: hostRunStateSchema,
	reason: z.enum([
		"reserved",
		"launching",
		"worker_active",
		"verifying",
		"approval_required",
		"allowance_unavailable",
		"authority_expired",
		"authority_revoked",
		"cancellation_received",
		"termination_confirmed",
		"process_unknown",
		"verification_failed",
		"verified",
		"host_stopping",
	]),
	sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
	evidenceDigest: sha256.optional(),
});

export const hostInterventionSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	id: uuid,
	workspaceId: uuid,
	hostId: uuid,
	launchId: uuid,
	runId: uuid,
	grantId: uuid,
	sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
	taskRevision: sha256,
	kind: z.enum(["review", "input"]),
	reason: z.enum(["allowance_unavailable", "reconciliation_required"]),
	raisedAt: z.number().int().nonnegative().safe(),
	expiresAt: z.number().int().positive().safe(),
});

/** A person's answer can only resume or stop the exact run. It carries no job, grant or expiry extension. */
export const hostInterventionAnswerSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	answerId: uuid,
	interventionId: uuid,
	interventionDigest: sha256,
	workspaceId: uuid,
	hostId: uuid,
	operatorId: uuid,
	launchId: uuid,
	runId: uuid,
	grantId: uuid,
	sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
	taskRevision: sha256,
	decision: z.enum(["resume", "stop"]),
	answeredAt: z.number().int().nonnegative().safe(),
	expiresAt: z.number().int().positive().safe(),
});

export const hostDeclineReasonSchema = z.enum([
	"allowance_unavailable",
	"isolation_unavailable",
	"source_unavailable",
	"admission_paused",
	"operator_cancelled",
]);

export const hostRequestUnsignedSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	hostId: uuid,
	workspaceId: uuid,
	keyGeneration: z.number().int().positive().max(2_147_483_647),
	nonce: uuid,
	signedAt: z.number().int().nonnegative().safe(),
	body: z.discriminatedUnion("operation", [
		z.strictObject({ operation: z.literal("pull"), afterSequence: z.number().int().nonnegative().safe() }),
		z.strictObject({ operation: z.literal("event"), event: hostEventSchema }),
		z.strictObject({ operation: z.literal("authority"), launchId: uuid, grantId: uuid }),
		z.strictObject({
			operation: z.literal("decline"),
			launchId: uuid,
			requestDigest: sha256,
			declineId: uuid,
			reason: hostDeclineReasonSchema,
		}),
		z.strictObject({ operation: z.literal("acknowledge"), launchId: uuid, requestDigest: sha256, runId: uuid }),
		z.strictObject({ operation: z.literal("intervention"), intervention: hostInterventionSchema }),
	]),
});

export const hostRequestSchema = hostRequestUnsignedSchema.extend({
	signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const hostCancelSchema = z.strictObject({
	contractVersion: z.literal(hostContractVersion),
	commandId: uuid,
	workspaceId: uuid,
	hostId: uuid,
	launchId: uuid,
	runId: uuid,
	grantId: uuid,
	sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
	expiresAt: z.number().int().positive().safe(),
});

export type HostEnrollment = z.infer<typeof hostEnrollmentSchema>;
export type HostLaunch = z.infer<typeof hostLaunchSchema>;
export type HostEvent = z.infer<typeof hostEventSchema>;
export type HostIntervention = z.infer<typeof hostInterventionSchema>;
export type HostInterventionAnswer = z.infer<typeof hostInterventionAnswerSchema>;
export type HostRequest = z.infer<typeof hostRequestSchema>;
export type HostRequestUnsigned = z.infer<typeof hostRequestUnsignedSchema>;

/** Host replies cross the same validation boundary as incoming commands. */
export const hostOutcomeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("declined"),
		launchId: uuid,
		requestDigest: sha256,
		declineId: uuid,
		reason: hostDeclineReasonSchema,
		termination: z.literal("not-started"),
	}),
	z.strictObject({
		kind: z.literal("commands"),
		commands: z
			.array(
				z.discriminatedUnion("kind", [
					z.strictObject({ kind: z.literal("launch"), launch: hostLaunchSchema }),
					z.strictObject({ kind: z.literal("cancel"), command: hostCancelSchema }),
					z.strictObject({ kind: z.literal("answer"), answer: hostInterventionAnswerSchema }),
				]),
			)
			.max(21),
	}),
	z.strictObject({ kind: z.literal("acknowledged"), launchId: uuid, runId: uuid }),
	z.strictObject({ kind: z.literal("event_recorded"), launchId: uuid, sequence: z.number().int().positive().safe() }),
	z.strictObject({ kind: z.literal("intervention_recorded"), launchId: uuid, interventionId: uuid }),
	z.strictObject({
		kind: z.literal("authority_current"),
		launchId: uuid,
		grantId: uuid,
		expiresAt: z.number().int().positive().safe(),
	}),
	z.strictObject({
		kind: z.literal("authority_refused"),
		reason: z.enum([
			"expired_or_revoked",
			"capability_changed",
			"cancellation_requested",
			"terminal",
			"capacity_missing",
		]),
	}),
]);

const deliveryStatusSchema = z.enum(["pending", "acknowledged", "revoked"]);
const terminationSchema = z.enum(["not-started", "host-confirmed", "unconfirmed"]);

export const launchReceiptSchema = z.strictObject({
	kind: z.literal("launch_receipt"),
	launch: hostLaunchSchema,
	deliveryStatus: deliveryStatusSchema,
	runId: uuid.nullable(),
	termination: terminationSchema,
});

export const hostSummarySchema = z.strictObject({
	hostId: uuid,
	workspaceId: uuid,
	agent: hostEnrollmentSchema.shape.agent,
	repositories: hostEnrollmentSchema.shape.repositories,
	capabilityDigest: sha256,
	keyGeneration: hostEnrollmentSchema.shape.keyGeneration,
	status: z.enum(["enrolled", "revoked"]),
	lastSeenAt: z.number().int().nonnegative().safe().nullable(),
});

export const hostDirectorySchema = z
	.strictObject({
		kind: z.literal("hosts"),
		workspaceId: uuid,
		observedAt: z.number().int().nonnegative().safe(),
		hosts: z.array(hostSummarySchema).max(100),
		nextHostId: uuid.nullable(),
	})
	.refine(
		(value) => value.hosts.every((host) => host.workspaceId === value.workspaceId),
		"Host directory workspace differs",
	);

export const hostSnapshotSchema = z
	.strictObject({
		kind: z.literal("snapshot"),
		workspaceId: uuid,
		launchId: uuid,
		hostId: uuid,
		runId: uuid.nullable(),
		job: engineeringJobSchema,
		host: hostSummarySchema,
		deliveryStatus: deliveryStatusSchema,
		lastSequence: z.number().int().nonnegative().safe(),
		cancellation: z.enum(["none", "requested"]),
		termination: terminationSchema,
		nextCursor: z.number().int().nonnegative().safe(),
		hasMore: z.boolean(),
		latestEvent: hostEventSchema.nullable(),
		events: z.array(hostEventSchema).max(200),
	})
	.superRefine((value, context) => {
		const scoped = (event: HostEvent) =>
			event.workspaceId === value.workspaceId &&
			event.hostId === value.hostId &&
			event.launchId === value.launchId &&
			event.runId === value.runId &&
			event.sourceRevision === value.job.sourceRevision;
		if (
			value.job.workspace !== value.workspaceId ||
			value.host.workspaceId !== value.workspaceId ||
			value.host.hostId !== value.hostId ||
			value.nextCursor > value.lastSequence ||
			value.hasMore !== value.nextCursor < value.lastSequence ||
			(value.lastSequence === 0 ? value.latestEvent !== null : value.latestEvent?.sequence !== value.lastSequence) ||
			(value.latestEvent !== null && !scoped(value.latestEvent)) ||
			value.events.some(
				(event, index) =>
					!scoped(event) || (index > 0 && event.sequence !== (value.events[index - 1]?.sequence ?? -1) + 1),
			) ||
			(value.events.length > 0 && value.events.at(-1)?.sequence !== value.nextCursor)
		) {
			context.addIssue({ code: "custom", message: "Snapshot scope or cursor is inconsistent" });
		}
	});

export const hostCancellationOutcomeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("cancellation_received"),
		commandId: uuid,
		launchId: uuid,
		termination: z.literal("unconfirmed"),
	}),
	z.strictObject({
		kind: z.literal("cancelled_before_dispatch"),
		commandId: uuid,
		launchId: uuid,
		termination: z.literal("not-started"),
	}),
	z.strictObject({ kind: z.literal("already_terminal"), launchId: uuid }),
]);

export type HostOutcome = z.infer<typeof hostOutcomeSchema>;
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>;
export type LaunchReceipt = z.infer<typeof launchReceiptSchema>;
export type HostSummary = z.infer<typeof hostSummarySchema>;
export type HostDirectory = z.infer<typeof hostDirectorySchema>;
export type HostCancellationOutcome = z.infer<typeof hostCancellationOutcomeSchema>;
