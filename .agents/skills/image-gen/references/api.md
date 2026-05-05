# Antigravity API Reference

## OAuth Flow

**Authorization:** PKCE flow via `https://accounts.google.com/o/oauth2/v2/auth`

**Token exchange/refresh:** `POST https://oauth2.googleapis.com/token`

**Callback:** `http://localhost:51121/oauth-callback`

See `scripts/auth.py` for the full implementation.

## Image Generation

**Endpoint:** `{base}/v1internal:generateContent`

**Base endpoints (tried in order):**
1. `https://daily-cloudcode-pa.sandbox.googleapis.com`
2. `https://autopush-cloudcode-pa.sandbox.googleapis.com`
3. `https://cloudcode-pa.googleapis.com`

**Method:** POST

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: {fingerprint.userAgent}
X-Goog-Api-Client: {fingerprint.apiClient}
X-Goog-QuotaUser: {fingerprint.quotaUser}
X-Client-Device-Id: {fingerprint.deviceId}
Client-Metadata: {JSON string of fingerprint.clientMetadata}
```

**Request Body:**
```json
{
  "project": "{project_id}",
  "model": "gemini-3-pro-image",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "{prompt}" }]
      }
    ],
    "generationConfig": {
      "candidateCount": 1,
      "imageConfig": {
        "aspectRatio": "1:1"
      }
    }
  },
  "userAgent": "antigravity",
  "requestId": "{uuid}"
}
```

**imageConfig options:**
- `aspectRatio`: `"1:1"`, `"16:9"`, `"4:3"`, `"9:16"`, `"3:4"`

**Response:** Image data in `response.candidates[0].content.parts[].inlineData` as base64 with mimeType.

**MIME types:** `image/jpeg` (.jpg), `image/png` (.png), `image/webp` (.webp), `image/gif` (.gif)

## Credential Storage

**Location:** `~/.config/antigravity/accounts.json`

Accounts file uses v3 format with `accounts` array, `activeIndex`, and per-account `fingerprint` objects. See `scripts/auth.py` for the schema.
