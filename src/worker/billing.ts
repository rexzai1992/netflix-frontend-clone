import { Env, HttpError, audit, json, readJson } from "./lib";
import { SessionUser, getUser, requireCsrf } from "./auth";

export const PLANS = {
  monthly: { id: "monthly", name: "Premium Monthly", price_cents: 999, interval: "month", days: 31 },
  yearly: { id: "yearly", name: "Premium Yearly", price_cents: 9900, interval: "year", days: 366 },
} as const;

type PlanId = keyof typeof PLANS;

export type Subscription = {
  user_id: string;
  plan: string;
  status: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
};

function stripeConfigured(env: Env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export async function getSubscription(env: Env, userId: string): Promise<Subscription | null> {
  return env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .bind(userId)
    .first<Subscription>();
}

export function isEntitled(subscription: Subscription | null) {
  if (!subscription || subscription.status !== "active") return false;
  if (subscription.current_period_end == null) return true;
  return subscription.current_period_end > Math.floor(Date.now() / 1000);
}

export function publicSubscription(subscription: Subscription | null) {
  if (!subscription) return null;
  return {
    plan: subscription.plan,
    status: subscription.status,
    provider: subscription.provider,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    entitled: isEntitled(subscription),
  };
}

async function stripeRequest(env: Env, path: string, params: Record<string, string>) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok) {
    console.error("Stripe error", JSON.stringify(data.error || data));
    throw new HttpError("Payment provider request failed", 502);
  }
  return data;
}

async function upsertSubscription(env: Env, values: Subscription) {
  await env.DB.prepare(
    `INSERT INTO subscriptions
     (user_id, plan, status, provider, provider_customer_id, provider_subscription_id,
      current_period_end, cancel_at_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       plan = excluded.plan, status = excluded.status, provider = excluded.provider,
       provider_customer_id = COALESCE(excluded.provider_customer_id, subscriptions.provider_customer_id),
       provider_subscription_id = COALESCE(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      values.user_id,
      values.plan,
      values.status,
      values.provider,
      values.provider_customer_id,
      values.provider_subscription_id,
      values.current_period_end,
      values.cancel_at_period_end,
    )
    .run();
}

function planFromInput(value: unknown): PlanId {
  const plan = String(value || "");
  if (plan !== "monthly" && plan !== "yearly") throw new HttpError("Unknown plan");
  return plan;
}

async function verifyStripeSignature(env: Env, request: Request, payload: string) {
  const header = request.headers.get("stripe-signature") || "";
  const parts = new Map(
    header.split(",").map((piece) => {
      const [key, ...rest] = piece.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const timestamp = Number.parseInt(parts.get("t") || "", 10);
  const signature = parts.get("v1") || "";
  if (!Number.isFinite(timestamp) || !signature) throw new HttpError("Invalid webhook signature", 400);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) throw new HttpError("Webhook timestamp expired", 400);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected !== signature) throw new HttpError("Invalid webhook signature", 400);
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env)) throw new HttpError("Webhooks are not configured", 503);
  const payload = await request.text();
  await verifyStripeSignature(env, request, payload);
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, any> } };
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const userId = String(object.client_reference_id || "");
    if (userId) {
      const plan = String(object.metadata?.plan || "monthly");
      await upsertSubscription(env, {
        user_id: userId,
        plan,
        status: "active",
        provider: "stripe",
        provider_customer_id: object.customer ? String(object.customer) : null,
        provider_subscription_id: object.subscription ? String(object.subscription) : null,
        current_period_end: null,
        cancel_at_period_end: 0,
      });
      await audit(env, userId, "billing.checkout_completed", plan);
    }
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscriptionId = String(object.id || "");
    const row = await env.DB.prepare(
      "SELECT user_id, plan FROM subscriptions WHERE provider_subscription_id = ?",
    )
      .bind(subscriptionId)
      .first<{ user_id: string; plan: string }>();
    if (row) {
      const stripeStatus = String(object.status || "");
      const status =
        event.type === "customer.subscription.deleted" || stripeStatus === "canceled"
          ? "canceled"
          : stripeStatus === "past_due" || stripeStatus === "unpaid"
            ? "past_due"
            : "active";
      await upsertSubscription(env, {
        user_id: row.user_id,
        plan: row.plan,
        status,
        provider: "stripe",
        provider_customer_id: object.customer ? String(object.customer) : null,
        provider_subscription_id: subscriptionId,
        current_period_end: object.current_period_end ? Number(object.current_period_end) : null,
        cancel_at_period_end: object.cancel_at_period_end ? 1 : 0,
      });
    }
  }
  return json({ received: true });
}

export async function handleBilling(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/billing/webhook" && request.method === "POST") {
    return handleWebhook(request, env);
  }

  if (url.pathname === "/api/billing/plans" && request.method === "GET") {
    return json({ plans: Object.values(PLANS), mode: stripeConfigured(env) ? "stripe" : "dev" });
  }

  const user = await getUser(request, env);
  if (!user) throw new HttpError("Sign in required", 401);
  await requireCsrf(request, user.csrf);

  if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
    const plan = planFromInput((await readJson<{ plan?: string }>(request)).plan);
    if (stripeConfigured(env)) {
      const price = plan === "yearly" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
      if (!price) throw new HttpError("Stripe prices are not configured", 503);
      const session = await stripeRequest(env, "checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        client_reference_id: user.id,
        customer_email: user.email,
        "metadata[plan]": plan,
        success_url: `${url.origin}/account/?checkout=success`,
        cancel_url: `${url.origin}/account/?checkout=canceled`,
      });
      return json({ mode: "stripe", url: String(session.url) });
    }
    return json({ mode: "dev", plan });
  }

  if (url.pathname === "/api/billing/dev-activate" && request.method === "POST") {
    if (stripeConfigured(env)) throw new HttpError("Not available when Stripe is configured", 409);
    const plan = planFromInput((await readJson<{ plan?: string }>(request)).plan);
    await upsertSubscription(env, {
      user_id: user.id,
      plan,
      status: "active",
      provider: "dev",
      provider_customer_id: null,
      provider_subscription_id: null,
      current_period_end: Math.floor(Date.now() / 1000) + PLANS[plan].days * 86400,
      cancel_at_period_end: 0,
    });
    await audit(env, user.id, "billing.dev_activate", plan);
    return json({ ok: true, subscription: publicSubscription(await getSubscription(env, user.id)) });
  }

  if (url.pathname === "/api/billing/cancel" && request.method === "POST") {
    const subscription = await getSubscription(env, user.id);
    if (!subscription || subscription.status !== "active") {
      throw new HttpError("No active subscription", 409);
    }
    if (subscription.provider === "stripe" && subscription.provider_subscription_id) {
      await stripeRequest(env, `subscriptions/${subscription.provider_subscription_id}`, {
        cancel_at_period_end: "true",
      });
    }
    await env.DB.prepare(
      "UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
    )
      .bind(user.id)
      .run();
    await audit(env, user.id, "billing.cancel", subscription.plan);
    return json({ ok: true, subscription: publicSubscription(await getSubscription(env, user.id)) });
  }

  throw new HttpError("Not found", 404);
}
