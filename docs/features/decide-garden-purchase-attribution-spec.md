# Decide × Garden purchase and attribution integration

**Status:** Draft for joint review

**Commercial source:** Decide × Garden Commercial Partnership Term Sheet

**Owners:** Garden Engineering and Decide Engineering

## 1. Purpose

This document defines how Garden starts a Decide purchase, how Decide collects
payment through Stripe, and how both systems link the payment back to Garden.

The integration must support two commission routes:

1. **Garden-referred customer:** Garden refers a new Decide customer. Eligible
   payments qualify for 24 months after the first qualifying payment.
2. **Garden-originated transaction:** A new or existing Decide customer starts
   a qualifying purchase through Garden. That purchase qualifies for
   commission.

One payment earns one commission, even when both routes apply.

## 2. Scope

This specification covers:

- customer referrals;
- credit purchases and paid subscriptions;
- subscription renewals, upgrades, and team seat additions;
- refunds, chargebacks, and failed payments; and
- monthly commission reconciliation.

This specification does not let Garden collect or hold customer funds. It does
not give Garden access to Decide's Stripe secret key or customer card details.

## 3. System ownership

| System | Owns |
| --- | --- |
| Garden | Customer approval, referral and purchase events, Garden attribution records, and reconciliation |
| Decide | Products, prices, customer and team billing accounts, Stripe Checkout Sessions, credits, refunds, and billing support |
| Stripe | Payment collection, payment methods, invoices, subscriptions, and payment events |

Decide's MCP connection gives Garden access to Decide tools. It does not give
Garden permission to make a paid purchase.

## 4. Integration boundary

The purchase flow is separate from Decide tool execution:

```text
Garden user or agent
  -> Garden purchase approval
  -> Garden purchase event
  -> Decide partner API
  -> Stripe Checkout
  -> Decide Stripe webhook
  -> signed Decide payment event
  -> Garden attribution ledger
```

Decide creates every Stripe Checkout Session. Garden only requests a session
and opens the URL returned by Decide.

## 5. Main flows

### 5.1 New customer referral

1. Garden creates a referral event and opens Decide's approved referral flow.
2. Decide creates the customer account and records Garden as the partner.
3. The customer makes a first qualifying payment within 90 days.
4. Decide sends the payment and referral details to Garden.
5. Garden records the start and end of the 24-month referral period.

### 5.2 Garden-originated purchase

1. A user or agent selects a Decide product.
2. Garden shows the product, amount, currency, and billing type.
3. The customer approves the purchase.
4. Garden stores the approval and creates a purchase event.
5. Garden asks Decide to create a Stripe Checkout Session.
6. Decide returns the Checkout Session ID and URL.
7. Garden opens the URL and the customer pays through Stripe.
8. Stripe reports the result to Decide.
9. Decide sends a signed payment event to Garden.
10. Garden links the Decide payment to its purchase event.

### 5.3 Agent-started purchase

An agent may suggest a purchase or open the approval screen. It may not create
a paid Checkout Session until Garden has a valid customer approval.

At launch:

- one-time credit purchases require approval for each purchase;
- subscriptions require clear approval of the recurring price in Stripe
  Checkout; and
- automatic top-ups are not supported.

### 5.4 Refund or chargeback

1. Stripe reports the refund or chargeback to Decide.
2. Decide sends Garden an event that names the original transaction.
3. Garden records an adjustment against the original commission entry.
4. The adjustment cannot exceed the commission earned on the affected amount.

## 6. Identifiers

Each system keeps its own IDs. Both systems store the link between them.

| Identifier | Created by | Purpose |
| --- | --- | --- |
| `garden_partner_id` | Decide | Identifies Garden as the commercial partner |
| `garden_referral_event_id` | Garden | Identifies one referral attempt |
| `garden_authorization_id` | Garden | Identifies one customer approval |
| `garden_purchase_event_id` | Garden | Identifies one purchase started in Garden |
| `decide_customer_id` | Decide | Identifies the Decide customer |
| `decide_team_id` | Decide | Identifies the Decide billing team, when applicable |
| `decide_transaction_id` | Decide | Canonical ID for one collected payment |
| `decide_invoice_id` | Decide | Identifies an invoice, when applicable |
| `decide_subscription_id` | Decide | Identifies a subscription, when applicable |
| `stripe_checkout_session_id` | Stripe | Identifies the Stripe Checkout Session |

Decide must state whether its transaction, invoice, and subscription IDs are
Stripe IDs or Decide-owned IDs. The chosen IDs must remain stable in statements
and payment events.

## 7. Garden records

### 7.1 Purchase authorization

Garden stores:

```text
garden_authorization_id
garden_workspace_id
garden_user_id
decide_customer_id or decide_team_id
allowed_purchase_type
maximum_amount
currency
recurring_payment_allowed
automatic_top_up_allowed
approved_by
approved_at
expires_at
status
```

Valid authorization states are `active`, `consumed`, `revoked`, and `expired`.
A one-time authorization becomes `consumed` after Garden creates the Checkout
Session successfully.

### 7.2 Purchase event

Garden stores:

```text
garden_purchase_event_id
garden_authorization_id
garden_partner_id
garden_workspace_id
garden_user_id
decide_customer_id or decide_team_id
purchase_type
amount
currency
attribution_route
created_at
handoff_expires_at
status
```

Valid purchase states are:

```text
created -> approved -> checkout_created -> paid
                                   |-> failed
                                   |-> expired
paid -> partially_refunded | refunded | chargeback
```

### 7.3 Payment and commission entry

Garden stores one entry for each Decide transaction:

```text
decide_transaction_id
garden_purchase_event_id or garden_referral_event_id
decide_customer_id or decide_team_id
decide_invoice_id
decide_subscription_id
purchase_type
amount_collected
discount_amount
currency
tax_amount
refund_amount
chargeback_amount
net_revenue
commission_rate
commission_amount
paid_at
payment_status
```

`decide_transaction_id` is unique. This prevents the same payment from earning
two commissions.

## 8. Proposed Decide API

The exact paths are subject to Decide approval. The request and response rules
are required even if Decide provides an SDK.

### 8.1 Create a referral

Decide must provide a tracked referral URL or an endpoint with the same result.
The proposed endpoint is:

```http
POST /partner/referrals
Idempotency-Key: <garden_referral_event_id>
```

Garden sends `garden_partner_id`, `garden_referral_event_id`, and a return URL.
Decide returns the referral URL. Decide must keep the referral event ID when it
creates the customer account.

### 8.2 List products

```http
GET /partner/products
```

Returns the current product ID, name, purchase type, price, currency, billing
period, and credit amount. Garden must not copy prices into code.

### 8.3 Create a Checkout Session

```http
POST /partner/checkout-sessions
Idempotency-Key: <garden_purchase_event_id>
```

Request:

```json
{
  "garden_partner_id": "garden",
  "garden_purchase_event_id": "gpe_123",
  "garden_authorization_id": "auth_123",
  "decide_customer_id": "customer_123",
  "decide_team_id": null,
  "product_id": "credits_500",
  "return_url": "https://garden.example/decide/purchase-complete"
}
```

Response:

```json
{
  "decide_checkout_id": "checkout_123",
  "stripe_checkout_session_id": "cs_123",
  "checkout_url": "https://checkout.stripe.com/...",
  "expires_at": "2026-10-20T13:00:00Z"
}
```

Decide must place `garden_purchase_event_id` in the Stripe Checkout Session's
`client_reference_id` or metadata. Decide must also keep the mapping in its own
database.

Repeating the request with the same idempotency key must return the same active
Checkout Session. It must not create another purchase.

### 8.4 Read checkout status

```http
GET /partner/checkout-sessions/{garden_purchase_event_id}
```

Garden uses this endpoint to recover when a payment event is delayed or missed.

## 9. Decide payment events

Decide sends signed server-to-server events to Garden. Garden verifies the
signature before it changes any record.

Required event types are:

```text
referral.recorded
payment.paid
payment.failed
payment.refunded
payment.chargeback
subscription.renewed
subscription.cancelled
checkout.expired
```

Example:

```json
{
  "event_id": "de_evt_123",
  "event_type": "payment.paid",
  "occurred_at": "2026-10-20T12:00:00Z",
  "garden_partner_id": "garden",
  "garden_referral_event_id": null,
  "garden_purchase_event_id": "gpe_123",
  "decide_customer_id": "customer_123",
  "decide_team_id": null,
  "decide_transaction_id": "txn_123",
  "decide_invoice_id": null,
  "decide_subscription_id": null,
  "purchase_type": "credit_purchase",
  "amount_collected": 5000,
  "tax_amount": 0,
  "currency": "USD",
  "payment_status": "paid"
}
```

Decide retries an event until Garden returns a successful response. Garden
stores `event_id` and ignores duplicate deliveries. Events may arrive late, so
Garden applies them using `occurred_at`, not delivery order.

## 10. Authentication and security

The teams must choose one server authentication method before implementation:

- OAuth client credentials; or
- a dedicated partner API key with rotation support.

Payment events must use a separate signing secret. The sender includes a
timestamp and signature. Garden rejects an invalid signature or an event that
is outside the agreed replay window.

Neither system sends card details, Stripe secrets, customer files, prompts, or
analysis results through the purchase API.

## 11. Attribution rules

### 11.1 Garden-referred customer

The route applies only when Decide records Garden as the referring partner and
the first qualifying payment occurs within 90 days of account creation. The
24-month period starts on that payment date.

### 11.2 Garden-originated transaction

The route applies only when Garden has a valid approval and a purchase event
that Decide links to the payment. Account connection, tool use, a conversation,
or a free analysis does not qualify.

This route covers the linked purchase only. It does not start a 24-month
referral period unless the customer also meets the Garden-referred customer
rules.

### 11.3 Both routes apply

The payment earns one commission. The Garden-referred route controls later
eligible payments during its 24-month period. A later Garden-originated
purchase does not restart or extend that period.

### 11.4 Competing partner claims

The commercial teams must agree the priority rule before launch. Engineering
will implement the agreed rule and keep the evidence used for each decision.

## 12. Commission calculation

```text
Net Revenue
= amount collected
- refund
- chargeback
- transaction tax

Garden commission = Net Revenue × 20%
```

Stripe processing fees and Decide operating costs do not reduce Net Revenue.
The amount collected is the amount after customer discounts. The calculation
does not subtract a discount twice.
Amounts use the currency's smallest unit in APIs and storage. For example,
`5000` means USD 50.00. Display values use normal decimal formatting.

Garden calculates an expected commission from payment events. Decide's monthly
statement states the amount payable. Garden flags any difference for review.

## 13. Monthly statement

Decide provides a CSV or JSON statement by the 10th day of each month. Each row
contains:

```text
statement_id
reporting_period
garden_partner_id
garden_purchase_event_id or garden_referral_event_id
decide_customer_id or decide_team_id
decide_transaction_id
decide_invoice_id
decide_subscription_id
attribution_route
purchase_type
payment_date
amount_collected
currency
discount_amount
tax_amount
refund_amount
chargeback_amount
net_revenue
commission_amount
adjustment_reason
original_transaction_id
```

Garden matches rows by `decide_transaction_id`. Refund and chargeback rows must
name the original transaction.

## 14. Failure ownership

| Failure | Owner | Required action |
| --- | --- | --- |
| Product or price is unavailable | Decide | Return a clear error; Garden does not open checkout |
| Customer approval is missing or expired | Garden | Stop and request approval |
| Checkout Session creation fails | Decide | Return a retryable or final error |
| Customer payment fails | Decide | Show the payment error and send the final status to Garden |
| Decide payment event is delayed | Decide | Retry delivery; Garden may read checkout status |
| Duplicate request or event | Both | Use idempotency keys and event IDs to avoid duplicate records |
| Refund or chargeback occurs | Decide | Send an event linked to the original transaction |
| Attribution records disagree | Both | Reconcile from stored events and payment records |

## 15. Test and launch requirements

Before launch, both teams must pass tests for:

- new customer referral and first payment;
- existing customer credit purchase;
- subscription start and renewal;
- team purchase, upgrade, and seat addition;
- failed, duplicate, expired, refunded, and charged-back payments; and
- missing or delayed payment events.

Each test must prove the customer or team ID, attribution route, purchase event,
Decide transaction, Net Revenue, and commission amount.

Testing starts in Stripe test mode. Production access starts only after both
teams approve the results and the final commercial agreement is signed.

## 16. Open decisions

| Decision | Owner |
| --- | --- |
| Decide API base URL and final endpoint paths | Decide Engineering |
| Server authentication method | Both engineering teams |
| Payment-event signature format and replay window | Both engineering teams |
| Canonical Decide transaction, invoice, and subscription IDs | Decide Engineering |
| Competing partner priority rule | Commercial teams |
| Foreign-exchange source and conversion date | Commercial and finance teams |
| Final statement claim period | Commercial and legal teams |
| Production launch date and support contacts | Both teams |

## 17. Sign-off

This specification becomes the launch contract after the final commercial
agreement is signed and both engineering teams approve the API, events, test
results, and operational contacts.

| Team | Name | Approval date |
| --- | --- | --- |
| Garden Engineering |  |  |
| Decide Engineering |  |  |
| Garden Commercial |  |  |
| Decide Commercial |  |  |
