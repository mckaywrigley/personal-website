import { stripe } from "../../../../lib/stripe"
import {
  manageSubscriptionStatusChange,
  updateStripeCustomer
} from "../../../../actions/stripe-actions"
import { headers } from "next/headers"
import Stripe from "stripe"

/**
 * Set of relevant Stripe events to handle.
 * @type {Set<string>}
 */
const relevantEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted"
])

/**
 * Handles POST requests for Stripe webhooks.
 * @async
 * @function POST
 * @param {Request} req - The incoming request object.
 * @returns {Promise<Response>} The response object.
 */
export async function POST(req: Request) {
  const body = await req.text()
  const sig = headers().get("Stripe-Signature") as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  let event: Stripe.Event

  try {
    if (!sig || !webhookSecret) {
      throw new Error("Webhook secret or signature missing")
    }

    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  if (relevantEvents.has(event.type)) {
    try {
      switch (event.type) {
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          const subscription = event.data.object as Stripe.Subscription
          const productId = subscription.items.data[0].price.product as string

          await manageSubscriptionStatusChange(
            subscription.id,
            subscription.customer as string,
            productId
          )

          break

        case "checkout.session.completed":
          const checkoutSession = event.data.object as Stripe.Checkout.Session
          if (checkoutSession.mode === "subscription") {
            const subscriptionId = checkoutSession.subscription

            await updateStripeCustomer(
              checkoutSession.client_reference_id as string,
              subscriptionId as string,
              checkoutSession.customer as string
            )

            const subscription = await stripe.subscriptions.retrieve(
              subscriptionId as string,
              {
                expand: ["default_payment_method"]
              }
            )

            const productId = subscription.items.data[0].price.product as string

            await manageSubscriptionStatusChange(
              subscription.id,
              subscription.customer as string,
              productId
            )
          }

          break

        default:
          throw new Error("Unhandled relevant event!")
      }
    } catch (error) {
      return new Response(
        "Webhook handler failed. View your nextjs function logs.",
        {
          status: 400
        }
      )
    }
  }

  return new Response(JSON.stringify({ received: true }))
}