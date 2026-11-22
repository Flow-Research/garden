import {
	type HostEnrollment,
	type HostRequest,
	type HostRequestUnsigned,
	hostEnrollmentSchema,
	hostRequestSchema,
	hostRequestUnsignedSchema,
} from "./host-contract.ts";

/** A request is fresh for one minute. Durable nonce consumption still happens in the receiver transaction. */
export const HOST_REQUEST_WINDOW_MS = 60_000;

const encode = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
const decode = (value: string): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));

/** Only validated, ordered control fields enter signatures. Unknown fields are rejected. */
export const hostRequestPreimage = (value: unknown): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(JSON.stringify(hostRequestUnsignedSchema.parse(value)));

export const signHostRequest = async (
	value: HostRequestUnsigned,
	privateKey: Parameters<typeof crypto.subtle.sign>[1],
): Promise<HostRequest> => {
	const unsigned = hostRequestUnsignedSchema.parse(value);
	const signature = await crypto.subtle.sign("Ed25519", privateKey, hostRequestPreimage(unsigned));
	return hostRequestSchema.parse({ ...unsigned, signature: encode(new Uint8Array(signature)) });
};

export type HostRequestVerification =
	| { readonly status: "verified"; readonly request: HostRequest; readonly enrollment: HostEnrollment }
	| { readonly status: "refused"; readonly reason: "malformed" | "scope" | "clock" | "stale" | "signature" };

/** Verifies host possession and scope. Membership, revocation and nonce replay require current receiver state. */
export const verifyHostRequest = async (
	input: unknown,
	enrollmentInput: unknown,
	now: number,
): Promise<HostRequestVerification> => {
	const parsed = hostRequestSchema.safeParse(input);
	const enrolled = hostEnrollmentSchema.safeParse(enrollmentInput);
	if (!parsed.success || !enrolled.success) return { status: "refused", reason: "malformed" };
	const request = parsed.data;
	const enrollment = enrolled.data;
	if (
		request.hostId !== enrollment.hostId ||
		request.workspaceId !== enrollment.workspaceId ||
		request.keyGeneration !== enrollment.keyGeneration
	)
		return { status: "refused", reason: "scope" };
	if (!Number.isSafeInteger(now) || now < 0 || request.signedAt > now) return { status: "refused", reason: "clock" };
	if (now - request.signedAt > HOST_REQUEST_WINDOW_MS) return { status: "refused", reason: "stale" };
	if (
		request.body.operation === "event" &&
		(request.body.event.hostId !== request.hostId || request.body.event.workspaceId !== request.workspaceId)
	)
		return { status: "refused", reason: "scope" };
	if (
		request.body.operation === "intervention" &&
		(request.body.intervention.hostId !== request.hostId ||
			request.body.intervention.workspaceId !== request.workspaceId)
	)
		return { status: "refused", reason: "scope" };
	const publicBytes = decode(enrollment.publicKey);
	const signatureBytes = decode(request.signature);
	if (
		publicBytes.length !== 32 ||
		signatureBytes.length !== 64 ||
		encode(publicBytes) !== enrollment.publicKey ||
		encode(signatureBytes) !== request.signature
	)
		return { status: "refused", reason: "malformed" };
	const { signature: _signature, ...unsigned } = request;
	const valid = await crypto.subtle
		.importKey("raw", publicBytes, "Ed25519", false, ["verify"])
		.then((key) => crypto.subtle.verify("Ed25519", key, signatureBytes, hostRequestPreimage(unsigned)))
		.then(
			(result) => result,
			() => false,
		);
	return valid ? { status: "verified", request, enrollment } : { status: "refused", reason: "signature" };
};
